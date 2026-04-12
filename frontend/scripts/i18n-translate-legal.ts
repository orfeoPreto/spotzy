#!/usr/bin/env npx tsx
/**
 * Legal document translation script — translates Markdown legal documents
 * from English to target locales using claude-opus-4-6.
 *
 * Usage:
 *   npm run i18n:translate-legal -- --document=terms-of-service
 *   npm run i18n:translate-legal -- --document=all
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
  TARGET_LOCALES,
  LEGAL_DOCS_DIR,
  GLOSSARY_FILE,
  CLAUDE_MODEL_OPUS,
  LEGAL_DOCUMENTS,
} from './lib/constants';
import { parse } from 'yaml';

const client = new Anthropic();

function loadGlossary(): string {
  const glossaryPath = join(process.cwd(), GLOSSARY_FILE);
  if (!existsSync(glossaryPath)) return '';
  const content = readFileSync(glossaryPath, 'utf-8');
  const glossary = parse(content) as any;
  if (!glossary?.terms) return '';

  const lines: string[] = ['GLOSSARY:'];
  for (const [term, def] of Object.entries(glossary.terms) as [string, any][]) {
    if (def.rule === 'never_translate') {
      lines.push(`  "${term}" → NEVER translate, keep as "${def.all_locales}"`);
    } else if (def.rule === 'translate') {
      lines.push(`  "${term}" → fr-BE: "${def['fr-BE']}", nl-BE: "${def['nl-BE']}"`);
    }
  }
  return lines.join('\n');
}

async function translateDocument(
  englishContent: string,
  targetLocale: string,
  documentName: string,
  glossaryContext: string,
): Promise<string> {
  const localeName = targetLocale === 'fr-BE' ? 'Belgian French' : 'Belgian Dutch';

  const response = await client.messages.create({
    model: CLAUDE_MODEL_OPUS,
    max_tokens: 16000,
    system: `You are translating a legal document from English to ${localeName} (${targetLocale}) for Spotzy, a Belgian peer-to-peer parking marketplace.

Belgian consumer law (Code de droit économique, Livre VI) requires that contracts with consumers be in the consumer's language.

TRANSLATION REQUIREMENTS:
- Preserve the exact legal meaning of every clause.
- Use Belgian legal terminology conventions, not French-French or Dutch-Dutch.
- Preserve all numbered references, section headings, and cross-references.
- Preserve all Markdown formatting (headers, lists, bold, links).
- Do NOT add or remove clauses.
- Do NOT soften or sharpen the legal language — match the tone exactly.
- Where Spotzy-specific terms appear, use the glossary translations.

${glossaryContext}

OUTPUT: The translated Markdown document, preserving all formatting and structure.`,
    messages: [
      { role: 'user', content: `Translate this ${documentName} from English to ${localeName}:\n\n${englishContent}` },
    ],
  });

  const text = response.content[0];
  return text.type === 'text' ? text.text : englishContent;
}

async function main() {
  const args = process.argv.slice(2);
  const docArg = args.find(a => a.startsWith('--document='))?.split('=')[1];

  if (!docArg) {
    console.error('Usage: npm run i18n:translate-legal -- --document=<name|all>');
    process.exit(1);
  }

  const docsToTranslate = docArg === 'all'
    ? [...LEGAL_DOCUMENTS]
    : LEGAL_DOCUMENTS.filter(d => d === docArg);

  if (docsToTranslate.length === 0) {
    console.error(`Unknown document: ${docArg}. Valid: ${LEGAL_DOCUMENTS.join(', ')}, all`);
    process.exit(1);
  }

  const glossaryContext = loadGlossary();

  for (const doc of docsToTranslate) {
    const englishPath = join(process.cwd(), LEGAL_DOCS_DIR, `${doc}.en.md`);
    if (!existsSync(englishPath)) {
      console.warn(`[SKIP] ${doc}: English source not found at ${englishPath}`);
      continue;
    }

    const englishContent = readFileSync(englishPath, 'utf-8');
    console.log(`Translating ${doc} (${englishContent.length} chars)...`);

    for (const targetLocale of TARGET_LOCALES) {
      console.log(`  → ${targetLocale}...`);
      const translated = await translateDocument(englishContent, targetLocale, doc, glossaryContext);

      const now = new Date().toISOString();
      const output = `---
source: ${CLAUDE_MODEL_OPUS}
generated: ${now}
reviewed: false
---

${translated}`;

      const outputPath = join(process.cwd(), LEGAL_DOCS_DIR, `${doc}.${targetLocale}.md`);
      writeFileSync(outputPath, output, 'utf-8');
      console.log(`  Wrote ${outputPath}`);
    }
  }

  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
