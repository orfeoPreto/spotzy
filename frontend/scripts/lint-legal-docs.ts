#!/usr/bin/env npx tsx
/**
 * Legal document structure linter — verifies that all locale versions
 * of each legal document have matching section structures.
 *
 * Usage:
 *   npm run lint:legal-docs
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { SUPPORTED_LOCALES, LEGAL_DOCUMENTS, LEGAL_DOCS_DIR } from './lib/constants';

interface LintResult {
  document: string;
  ok: boolean;
  details: string;
}

function extractSections(content: string): string[] {
  return content
    .split('\n')
    .filter(line => line.startsWith('#'))
    .map(line => line.replace(/^#+\s*/, '').trim());
}

function main() {
  const results: LintResult[] = [];
  let hasError = false;

  for (const doc of LEGAL_DOCUMENTS) {
    const sectionsByLocale: Record<string, string[]> = {};
    let allPresent = true;

    for (const locale of SUPPORTED_LOCALES) {
      const filePath = join(process.cwd(), LEGAL_DOCS_DIR, `${doc}.${locale}.md`);
      if (!existsSync(filePath)) {
        allPresent = false;
        continue;
      }
      const content = readFileSync(filePath, 'utf-8');
      sectionsByLocale[locale] = extractSections(content);
    }

    if (!allPresent || Object.keys(sectionsByLocale).length < SUPPORTED_LOCALES.length) {
      const missing = SUPPORTED_LOCALES.filter(l => !sectionsByLocale[l]);
      results.push({
        document: doc,
        ok: false,
        details: `Missing locale files: ${missing.join(', ')}`,
      });
      hasError = true;
      continue;
    }

    // Compare section counts
    const counts = SUPPORTED_LOCALES.map(l => `${l} (${sectionsByLocale[l].length} sections)`);
    const allSame = SUPPORTED_LOCALES.every(
      l => sectionsByLocale[l].length === sectionsByLocale[SUPPORTED_LOCALES[0]].length,
    );

    if (allSame) {
      results.push({
        document: doc,
        ok: true,
        details: counts.join(', ') + ' \u2014 structural match',
      });
    } else {
      results.push({
        document: doc,
        ok: false,
        details: counts.join(', ') + ' \u2014 MISMATCH',
      });
      hasError = true;
    }
  }

  for (const r of results) {
    const icon = r.ok ? '\u2713' : '\u2717';
    console.log(`${icon} ${r.document}: ${r.details}`);
  }

  if (hasError) {
    console.log('\nLegal docs lint: FAILED');
    process.exit(1);
  } else {
    console.log('\nLegal docs lint: PASSED');
  }
}

main();
