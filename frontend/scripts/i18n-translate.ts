#!/usr/bin/env npx tsx
/**
 * LLM translation script — fills missing keys in target locale YAML files
 * by calling the Claude API with glossary context.
 *
 * Usage:
 *   npm run i18n:translate                     # translate all missing keys
 *   npm run i18n:translate -- --namespace=common  # only one namespace
 *   npm run i18n:translate -- --dry-run         # preview without writing
 *   npm run i18n:translate -- --retranslate     # retranslate all keys (override existing)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse, stringify } from 'yaml';
import { config } from 'dotenv';

// Load .env.local for the ANTHROPIC_API_KEY
config({ path: join(process.cwd(), '.env.local') });

import Anthropic from '@anthropic-ai/sdk';
import {
  SOURCE_LOCALE,
  TARGET_LOCALES,
  LOCALES_DIR,
  GLOSSARY_FILE,
  NAMESPACES,
  CLAUDE_MODEL_SONNET,
  CLAUDE_API_DELAY_MS,
  CLAUDE_MAX_RETRIES,
} from './lib/constants';

const client = new Anthropic();

interface TranslateOptions {
  namespace?: string;
  dryRun?: boolean;
  retranslate?: boolean;
}

function parseArgs(): TranslateOptions {
  const args = process.argv.slice(2);
  const opts: TranslateOptions = {};
  for (const arg of args) {
    if (arg.startsWith('--namespace=')) opts.namespace = arg.split('=')[1];
    if (arg === '--dry-run') opts.dryRun = true;
    if (arg === '--retranslate') opts.retranslate = true;
  }
  return opts;
}

function loadYaml(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf-8');
  return parse(content) ?? {};
}

function flattenKeys(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenKeys(value as Record<string, unknown>, fullKey));
    } else if (typeof value === 'string') {
      result[fullKey] = value;
    }
  }
  return result;
}

function setNestedKey(obj: Record<string, unknown>, key: string, value: string): void {
  const parts = key.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function loadGlossary(): string {
  const glossaryPath = join(process.cwd(), GLOSSARY_FILE);
  if (!existsSync(glossaryPath)) return '';
  const glossary = loadYaml(glossaryPath) as any;
  if (!glossary?.terms) return '';

  const lines: string[] = ['GLOSSARY:'];
  for (const [term, def] of Object.entries(glossary.terms) as [string, any][]) {
    if (def.rule === 'never_translate') {
      lines.push(`  "${term}" → NEVER translate, keep as "${def.all_locales}" in all locales`);
    } else if (def.rule === 'translate') {
      lines.push(`  "${term}" → fr-BE: "${def['fr-BE']}", nl-BE: "${def['nl-BE']}"`);
    }
  }
  return lines.join('\n');
}

async function translateString(
  sourceText: string,
  targetLocale: string,
  namespace: string,
  key: string,
  glossaryContext: string,
): Promise<string> {
  const systemPrompt = `You are translating UI strings for Spotzy, a Belgian peer-to-peer parking marketplace.
Target locale: ${targetLocale}
${targetLocale === 'fr-BE' ? 'Use Belgian French. Address the user with "vous". Avoid Parisian slang.' : ''}
${targetLocale === 'nl-BE' ? 'Use Belgian Dutch. Avoid Holland-specific phrasing.' : ''}

${glossaryContext}

RULES:
- Preserve ICU MessageFormat syntax exactly (e.g., {count, plural, one {# item} other {# items}})
- Preserve all HTML tags, Markdown, and interpolation variables (e.g., {name}, {amount})
- Keep Spotzy-specific terms per the glossary
- Match the tone: warm, helpful, slightly informal, never condescending
- Output ONLY the translated string, no explanation`;

  for (let attempt = 0; attempt < CLAUDE_MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: CLAUDE_MODEL_SONNET,
        max_tokens: 500,
        system: systemPrompt,
        messages: [
          { role: 'user', content: `Translate this UI string (namespace: ${namespace}, key: ${key}):\n\n${sourceText}` },
        ],
      });
      const text = response.content[0];
      if (text.type === 'text') return text.text.trim();
      return sourceText;
    } catch (err: any) {
      if (err.status === 429 && attempt < CLAUDE_MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      console.error(`  [ERROR] Failed to translate ${key}: ${err.message}`);
      return sourceText;
    }
  }
  return sourceText;
}

async function main() {
  const opts = parseArgs();
  const glossaryContext = loadGlossary();
  const namespacesToProcess = opts.namespace
    ? NAMESPACES.filter(ns => ns === opts.namespace)
    : [...NAMESPACES];

  if (namespacesToProcess.length === 0) {
    console.error(`Unknown namespace: ${opts.namespace}`);
    process.exit(1);
  }

  let totalTranslated = 0;
  let totalSkipped = 0;

  for (const ns of namespacesToProcess) {
    const sourcePath = join(process.cwd(), LOCALES_DIR, SOURCE_LOCALE, `${ns}.yaml`);
    const sourceData = loadYaml(sourcePath);
    const sourceKeys = flattenKeys(sourceData);

    if (Object.keys(sourceKeys).length === 0) {
      continue; // Skip empty namespaces
    }

    for (const targetLocale of TARGET_LOCALES) {
      const targetPath = join(process.cwd(), LOCALES_DIR, targetLocale, `${ns}.yaml`);
      const targetData = loadYaml(targetPath);
      const targetKeys = flattenKeys(targetData);

      const missingKeys = Object.entries(sourceKeys).filter(
        ([key]) => opts.retranslate || !targetKeys[key],
      );

      if (missingKeys.length === 0) {
        continue;
      }

      console.log(`[${ns}] ${targetLocale}: ${missingKeys.length} keys to translate`);

      for (const [key, sourceText] of missingKeys) {
        if (opts.dryRun) {
          console.log(`  [DRY-RUN] Would translate: ${key}`);
          totalSkipped++;
          continue;
        }

        const translated = await translateString(sourceText, targetLocale, ns, key, glossaryContext);
        setNestedKey(targetData, key, translated);
        totalTranslated++;
        process.stdout.write('.');

        // Throttle API calls
        await new Promise(r => setTimeout(r, CLAUDE_API_DELAY_MS));
      }

      if (!opts.dryRun && missingKeys.length > 0) {
        writeFileSync(targetPath, stringify(targetData, { lineWidth: 0 }), 'utf-8');
        console.log(`\n  Wrote ${missingKeys.length} translations to ${targetPath}`);
      }
    }
  }

  console.log(`\nDone. Translated: ${totalTranslated}, Skipped: ${totalSkipped}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
