#!/usr/bin/env npx tsx
/**
 * Bundles all YAML translation files into per-locale JSON files
 * in public/_translations/ for client-side consumption.
 *
 * Run: npx tsx scripts/build-translations.ts
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

const LOCALES_DIR = join(process.cwd(), 'src/locales');
const OUTPUT_DIR = join(process.cwd(), 'public/_translations');

const SUPPORTED_LOCALES = ['en', 'fr-BE', 'nl-BE'];

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const locale of SUPPORTED_LOCALES) {
  const localeDir = join(LOCALES_DIR, locale);
  if (!existsSync(localeDir)) continue;

  const messages: Record<string, unknown> = {};
  const files = readdirSync(localeDir).filter(f => f.endsWith('.yaml'));

  for (const file of files) {
    const ns = file.replace('.yaml', '');
    const content = readFileSync(join(localeDir, file), 'utf-8');
    const parsed = parse(content);
    if (parsed && typeof parsed === 'object') {
      messages[ns] = parsed;
    }
  }

  const outputPath = join(OUTPUT_DIR, `${locale}.json`);
  writeFileSync(outputPath, JSON.stringify(messages, null, 2), 'utf-8');
  console.log(`Wrote ${outputPath} (${Object.keys(messages).length} namespaces)`);
}

console.log('Done.');
