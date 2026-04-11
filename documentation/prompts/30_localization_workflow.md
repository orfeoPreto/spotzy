# Session 30 — Localization Workflow (v2.x)

## LLM translation script · i18n linter · Legal docs structure linter · Git pre-push hook

> ⚠ **v2.x SCOPE** — Do not start until sessions 00–22, 26, 27, 28, 21b, and 29 are complete.
> Prerequisite sessions: 00–22, 26, 27, 28, 21b, 29.
>
> **This session is the workflow half of the localization mechanism.** Session 29 (Localization Runtime) is its companion and builds the runtime pieces (schema, next-intl integration, UGC translation Lambdas, SES templates). Session 30 builds the tooling the founder uses daily: the translation script that calls Claude API to fill in missing keys, the i18n linter that catches missing/malformed strings, the legal document structure linter that verifies parity across locales, and the git hooks that wire everything together.
>
> **Source of truth:** `spotzy_localization_v2.docx` — the Localization & Internationalization Specification. Every design decision in this prompt traces back to a specific section:
> - PART A (translation script) implements §8.3 and §8.4
> - PART B (i18n linter) implements §8.5
> - PART C (legal document structure linter) implements §11.5
> - PART D (git hooks) implements §8.4 (dual-mode operation)
> - PART E (documentation) documents the workflow for the founder and for non-technical reviewers via GitHub web UI

---

## What this session builds

This session implements four pieces of tooling that turn the localization runtime from Session 29 into an actually usable daily workflow:

1. **LLM translation script** — `frontend/scripts/i18n-translate.ts`. A Node.js script that reads the `en/*.yaml` source files, finds keys missing in `fr-BE/*.yaml` or `nl-BE/*.yaml`, calls the Claude API to produce translations with full glossary context, and writes the results back. Supports five invocation modes: all, namespace-scoped, key-scoped, full retranslation, and dry-run.

2. **Legal document translation script** — `frontend/scripts/i18n-translate-legal.ts`. A similar script but for legal documents (`frontend/public/legal/*.md`). Uses `claude-opus-4-6` (the highest-quality Claude 4.6 model) instead of `claude-sonnet-4-6` because legal content has a higher quality bar. Accepts the document name and target locale as arguments, produces a first draft for the founder to review.

3. **i18n linter** — `frontend/scripts/i18n-lint.ts`. A validation script that runs on every commit (via pre-commit hook) and every pull request (via GitHub Actions). Checks: missing keys, extra keys, YAML syntax, ICU MessageFormat syntax, parameter set mismatches between source and translations, glossary violations, HTML tag balance, and SMS length budgets. Error messages are framed for non-developers (the founder's wife editing YAML in the GitHub web UI).

4. **Legal document structure linter** — `frontend/scripts/lint-legal-docs.ts`. A smaller validation script that compares the section headings, numbered clauses, and link structure across locale versions of each legal document. Catches the case where the LLM accidentally merged or dropped a section during translation.

5. **Git pre-push hook installer** — `frontend/scripts/install-git-hooks.sh`. A one-time setup script that installs the pre-push hook into the developer's `.git/hooks/` directory. The hook runs the translation script in "only missing keys" mode before every push, amending the commit with any new translations. Opt-in — the founder installs it once on their machine and never thinks about it again.

6. **GitHub Actions workflow** — `.github/workflows/i18n.yml`. Runs the i18n linter and the legal docs linter on every pull request. Fails the PR with a friendly comment if anything is broken.

7. **README documentation** — `frontend/docs/i18n-workflow.md`. A short guide that explains the workflow for the founder (daily use) and for non-technical reviewers (GitHub web UI editing). Includes troubleshooting for common YAML errors.

---

## Prerequisites from Session 29

This session assumes Session 29 is complete and provides:

- The folder structure `frontend/src/locales/{en,fr-BE,nl-BE}/{namespace}.yaml` with all 23 namespaces populated in English
- The glossary file at `frontend/src/locales/_glossary.yaml`
- The `frontend/src/lib/yaml-loader.ts` YAML loading helper
- The `@anthropic-ai/sdk` npm package already installed (added in Session 29 PART C dependencies)
- The `yaml` npm package already installed (added in Session 29 PART A for the YAML loader)
- The `@formatjs/icu-messageformat-parser` npm package already installed (added in Session 29 PART A for ICU validation)

If any of these are missing, stop and verify Session 29 has been run correctly before continuing.

---

## Critical constants

```typescript
// frontend/scripts/lib/constants.ts — shared by all workflow scripts

export const SUPPORTED_LOCALES = ['en', 'fr-BE', 'nl-BE'] as const;
export const SOURCE_LOCALE = 'en';
export const TARGET_LOCALES = ['fr-BE', 'nl-BE'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export const LOCALES_DIR = 'frontend/src/locales';
export const LEGAL_DOCS_DIR = 'frontend/public/legal';
export const GLOSSARY_FILE = 'frontend/src/locales/_glossary.yaml';

export const NAMESPACES = [
  'common', 'auth', 'listings', 'pricing', 'availability', 'search',
  'booking', 'chat', 'reviews', 'disputes', 'profile', 'payments',
  'dashboard', 'notifications', 'gdpr', 'spot_manager', 'block_spotter',
  'magic_link', 'errors', 'validation', 'time_date', 'landing', 'footer',
] as const;
export type Namespace = typeof NAMESPACES[number];

// Namespaces whose strings end up as SMS templates and have the 160-char ASCII / 70-char Unicode budget
export const SMS_NAMESPACES: Namespace[] = [];   // set to actual SMS-using namespaces when they exist — empty for v2.x UI strings
export const SMS_ASCII_MAX = 160;
export const SMS_UNICODE_MAX = 70;

// Claude API configuration
export const CLAUDE_MODEL_SONNET = 'claude-sonnet-4-6';        // default for UI strings
export const CLAUDE_MODEL_OPUS = 'claude-opus-4-6';            // default for legal documents
export const CLAUDE_MODEL_HAIKU = 'claude-haiku-4-5-20251001'; // bulk retranslation

export const CLAUDE_API_DELAY_MS = 100;     // serial delay between API calls
export const CLAUDE_MAX_RETRIES = 3;
export const CLAUDE_INITIAL_BACKOFF_MS = 1000;

// Legal documents in scope
export const LEGAL_DOCUMENTS = [
  'terms-of-service',
  'privacy-policy',
  'cookie-policy',
  'spot-manager-tcs',
  'block-spotter-tcs',
] as const;
export type LegalDocument = typeof LEGAL_DOCUMENTS[number];
```

All scripts in this session import from this file. Hard-coding any of these inline is a code review failure.

---

## PART A — LLM translation script

### A1 — Main script file

Create `frontend/scripts/i18n-translate.ts`. This is the core workflow script the founder runs to fill in missing translations.

**Tests first:** `frontend/scripts/__tests__/i18n-translate.test.ts`

```typescript
import { translateMissingKeys, parseArgs } from '../i18n-translate';
import { mockClaudeClient, resetClaudeMock, getClaudeCalls } from './helpers/claude-mock';
import { setupTempLocalesDir, writeYaml, readYaml, cleanupTempLocalesDir } from './helpers/fs-helpers';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await setupTempLocalesDir();
  resetClaudeMock();
});

afterEach(async () => {
  await cleanupTempLocalesDir(tmpDir);
});

describe('translateMissingKeys — happy path', () => {
  test('translates a single missing key from en to fr-BE', async () => {
    await writeYaml(`${tmpDir}/en/common.yaml`, { buttons: { save: 'Save' } });
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, {});
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, { buttons: { save: 'Opslaan' } });

    mockClaudeClient({ response: 'Enregistrer' });

    await translateMissingKeys({ localesDir: tmpDir, namespaces: ['common'] });

    const frBe = await readYaml(`${tmpDir}/fr-BE/common.yaml`);
    expect(frBe.buttons.save).toBe('Enregistrer');

    // nl-BE unchanged
    const nlBe = await readYaml(`${tmpDir}/nl-BE/common.yaml`);
    expect(nlBe.buttons.save).toBe('Opslaan');

    // Claude was called exactly once
    expect(getClaudeCalls()).toHaveLength(1);
  });

  test('translates multiple missing keys across multiple namespaces', async () => {
    await writeYaml(`${tmpDir}/en/common.yaml`, { save: 'Save', cancel: 'Cancel' });
    await writeYaml(`${tmpDir}/en/listings.yaml`, { create: { title: 'Create a listing' } });
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, {});
    await writeYaml(`${tmpDir}/fr-BE/listings.yaml`, {});
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, {});
    await writeYaml(`${tmpDir}/nl-BE/listings.yaml`, {});

    mockClaudeClient({
      responses: [
        'Enregistrer', 'Annuler', 'Créer une annonce',      // fr-BE
        'Opslaan', 'Annuleren', 'Een advertentie aanmaken', // nl-BE
      ],
    });

    await translateMissingKeys({ localesDir: tmpDir, namespaces: ['common', 'listings'] });

    expect((await readYaml(`${tmpDir}/fr-BE/common.yaml`)).save).toBe('Enregistrer');
    expect((await readYaml(`${tmpDir}/fr-BE/common.yaml`)).cancel).toBe('Annuler');
    expect((await readYaml(`${tmpDir}/fr-BE/listings.yaml`)).create.title).toBe('Créer une annonce');
    expect((await readYaml(`${tmpDir}/nl-BE/common.yaml`)).save).toBe('Opslaan');
    expect(getClaudeCalls()).toHaveLength(6);
  });

  test('skips keys that already exist in target locale', async () => {
    await writeYaml(`${tmpDir}/en/common.yaml`, { save: 'Save', cancel: 'Cancel' });
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, { save: 'Enregistrer' });   // already has save
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, {});

    mockClaudeClient({ responses: ['Annuler', 'Opslaan', 'Annuleren'] });

    await translateMissingKeys({ localesDir: tmpDir, namespaces: ['common'] });

    // save in fr-BE NOT overwritten
    expect((await readYaml(`${tmpDir}/fr-BE/common.yaml`)).save).toBe('Enregistrer');
    // cancel in fr-BE added
    expect((await readYaml(`${tmpDir}/fr-BE/common.yaml`)).cancel).toBe('Annuler');
    // Only 3 calls (cancel→fr-BE, save→nl-BE, cancel→nl-BE)
    expect(getClaudeCalls()).toHaveLength(3);
  });

  test('preserves deeply nested structure', async () => {
    await writeYaml(`${tmpDir}/en/listings.yaml`, {
      create: { step: { address: { label: 'Address', placeholder: 'Street' } } },
    });
    await writeYaml(`${tmpDir}/fr-BE/listings.yaml`, {});
    await writeYaml(`${tmpDir}/nl-BE/listings.yaml`, {});

    mockClaudeClient({ responses: ['Adresse', 'Rue', 'Adres', 'Straat'] });

    await translateMissingKeys({ localesDir: tmpDir, namespaces: ['listings'] });

    const frBe = await readYaml(`${tmpDir}/fr-BE/listings.yaml`);
    expect(frBe.create.step.address.label).toBe('Adresse');
    expect(frBe.create.step.address.placeholder).toBe('Rue');
  });
});

describe('translateMissingKeys — ICU preservation', () => {
  test('preserves ICU parameters in translations', async () => {
    await writeYaml(`${tmpDir}/en/booking.yaml`, {
      greeting: 'Hello {name}!',
      count: '{count, plural, one {# booking} other {# bookings}}',
    });
    await writeYaml(`${tmpDir}/fr-BE/booking.yaml`, {});
    await writeYaml(`${tmpDir}/nl-BE/booking.yaml`, {});

    mockClaudeClient({
      responses: [
        'Bonjour {name} !',
        '{count, plural, one {# réservation} other {# réservations}}',
        'Hallo {name}!',
        '{count, plural, one {# reservering} other {# reserveringen}}',
      ],
    });

    await translateMissingKeys({ localesDir: tmpDir, namespaces: ['booking'] });

    const frBe = await readYaml(`${tmpDir}/fr-BE/booking.yaml`);
    expect(frBe.greeting).toBe('Bonjour {name} !');
    expect(frBe.count).toContain('{count, plural');
  });

  test('rejects translation that drops an ICU parameter', async () => {
    await writeYaml(`${tmpDir}/en/booking.yaml`, { greeting: 'Hello {name}!' });
    await writeYaml(`${tmpDir}/fr-BE/booking.yaml`, {});
    await writeYaml(`${tmpDir}/nl-BE/booking.yaml`, {});

    // Claude returns a translation missing the {name} parameter
    mockClaudeClient({ responses: ['Bonjour !', 'Hallo {name}!'] });

    await expect(
      translateMissingKeys({ localesDir: tmpDir, namespaces: ['booking'] })
    ).rejects.toThrow(/parameter mismatch.*name/i);
  });

  test('rejects translation with malformed ICU syntax', async () => {
    await writeYaml(`${tmpDir}/en/booking.yaml`, {
      count: '{count, plural, one {# booking} other {# bookings}}',
    });
    await writeYaml(`${tmpDir}/fr-BE/booking.yaml`, {});
    await writeYaml(`${tmpDir}/nl-BE/booking.yaml`, {});

    // Broken ICU syntax from Claude
    mockClaudeClient({ responses: ['{count, plural one # réservation}', '{count, plural, one {# reservering} other {# reserveringen}}'] });

    await expect(
      translateMissingKeys({ localesDir: tmpDir, namespaces: ['booking'] })
    ).rejects.toThrow(/ICU syntax/);
  });
});

describe('translateMissingKeys — glossary enforcement', () => {
  test('passes glossary to Claude in the prompt', async () => {
    await writeYaml(`${tmpDir}/_glossary.yaml`, {
      version: '1.0',
      terms: {
        'Spot Pool': { rule: 'translate', 'fr-BE': 'Pool de Stationnement', 'nl-BE': 'Parkeerpool', en: 'Spot Pool' },
        'Spotzy': { rule: 'never_translate', all_locales: 'Spotzy' },
      },
    });
    await writeYaml(`${tmpDir}/en/listings.yaml`, { title: 'Create a Spot Pool' });
    await writeYaml(`${tmpDir}/fr-BE/listings.yaml`, {});
    await writeYaml(`${tmpDir}/nl-BE/listings.yaml`, {});

    mockClaudeClient({ responses: ['Créer un Pool de Stationnement', 'Een Parkeerpool aanmaken'] });

    await translateMissingKeys({ localesDir: tmpDir, namespaces: ['listings'] });

    const calls = getClaudeCalls();
    expect(calls[0].prompt).toContain('Spot Pool');
    expect(calls[0].prompt).toContain('Pool de Stationnement');
    expect(calls[0].prompt).toContain('Spotzy');
    expect(calls[0].prompt).toContain('never_translate');
  });
});

describe('translateMissingKeys — retry and backoff', () => {
  test('retries on 429 with exponential backoff', async () => {
    await writeYaml(`${tmpDir}/en/common.yaml`, { save: 'Save' });
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, {});
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, { save: 'Opslaan' });

    mockClaudeClient({
      responses: [
        { error: { status: 429 } },
        { error: { status: 429 } },
        'Enregistrer',
      ],
    });

    await translateMissingKeys({ localesDir: tmpDir, namespaces: ['common'] });

    expect((await readYaml(`${tmpDir}/fr-BE/common.yaml`)).save).toBe('Enregistrer');
    expect(getClaudeCalls()).toHaveLength(3);
  });

  test('gives up after max retries and logs failure', async () => {
    await writeYaml(`${tmpDir}/en/common.yaml`, { save: 'Save' });
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, {});
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, { save: 'Opslaan' });

    mockClaudeClient({
      responses: [
        { error: { status: 500 } },
        { error: { status: 500 } },
        { error: { status: 500 } },
        { error: { status: 500 } },  // exceeds max retries
      ],
    });

    await translateMissingKeys({ localesDir: tmpDir, namespaces: ['common'] });

    // Key remains missing; failure logged to CSV
    const frBe = await readYaml(`${tmpDir}/fr-BE/common.yaml`);
    expect(frBe.save).toBeUndefined();
    // Failure log exists
    const failureLog = await readFailureLog(tmpDir);
    expect(failureLog).toContainEqual(expect.objectContaining({ key: 'save', locale: 'fr-BE' }));
  });
});

describe('translateMissingKeys — dry-run mode', () => {
  test('reports what would be translated without calling Claude', async () => {
    await writeYaml(`${tmpDir}/en/common.yaml`, { save: 'Save', cancel: 'Cancel' });
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, {});
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, {});

    const report = await translateMissingKeys({
      localesDir: tmpDir,
      namespaces: ['common'],
      dryRun: true,
    });

    expect(report.missingCount).toBe(4);  // 2 keys × 2 locales
    expect(report.estimatedCostUsd).toBeGreaterThan(0);
    expect(getClaudeCalls()).toHaveLength(0);

    // Files unchanged
    expect(await readYaml(`${tmpDir}/fr-BE/common.yaml`)).toEqual({});
  });
});

describe('parseArgs', () => {
  test('parses --namespace flag', () => {
    const args = parseArgs(['--namespace=listings']);
    expect(args.namespace).toBe('listings');
  });
  test('parses --key flag', () => {
    const args = parseArgs(['--key=listings.create.title']);
    expect(args.key).toBe('listings.create.title');
  });
  test('parses --dry-run flag', () => {
    const args = parseArgs(['--dry-run']);
    expect(args.dryRun).toBe(true);
  });
  test('parses --model flag', () => {
    const args = parseArgs(['--model=opus']);
    expect(args.model).toBe('claude-opus-4-6');
  });
  test('defaults to sonnet model', () => {
    const args = parseArgs([]);
    expect(args.model).toBe('claude-sonnet-4-6');
  });
});
```

Run the tests — they must fail (red). Then implement the script.

**Implementation — `frontend/scripts/i18n-translate.ts`:**

```typescript
#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { parse, stringify } from 'yaml';
import Anthropic from '@anthropic-ai/sdk';
import { parse as parseIcu } from '@formatjs/icu-messageformat-parser';
import {
  SUPPORTED_LOCALES, TARGET_LOCALES, NAMESPACES, LOCALES_DIR, GLOSSARY_FILE,
  CLAUDE_MODEL_SONNET, CLAUDE_MODEL_OPUS, CLAUDE_MODEL_HAIKU,
  CLAUDE_API_DELAY_MS, CLAUDE_MAX_RETRIES, CLAUDE_INITIAL_BACKOFF_MS,
  type SupportedLocale, type Namespace,
} from './lib/constants';

interface TranslateOptions {
  localesDir?: string;
  namespaces?: Namespace[];
  key?: string;
  dryRun?: boolean;
  model?: string;
  force?: boolean;   // true = retranslate all keys (not just missing)
  targetLocale?: SupportedLocale;   // if set, only translate to this locale
}

interface TranslationReport {
  missingCount: number;
  translatedCount: number;
  failedCount: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  failures: Array<{ namespace: string; key: string; locale: string; error: string }>;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function translateMissingKeys(options: TranslateOptions = {}): Promise<TranslationReport> {
  const localesDir = options.localesDir ?? LOCALES_DIR;
  const namespaces = options.namespaces ?? NAMESPACES;
  const model = options.model ?? CLAUDE_MODEL_SONNET;
  const targetLocales = options.targetLocale ? [options.targetLocale] : TARGET_LOCALES;

  const glossary = await loadGlossary(localesDir);
  const report: TranslationReport = {
    missingCount: 0, translatedCount: 0, failedCount: 0,
    estimatedCostUsd: 0, actualCostUsd: 0, failures: [],
  };

  for (const namespace of namespaces) {
    const sourcePath = join(localesDir, 'en', `${namespace}.yaml`);
    const source = parse(await readFile(sourcePath, 'utf-8')) ?? {};

    for (const targetLocale of targetLocales) {
      const targetPath = join(localesDir, targetLocale, `${namespace}.yaml`);
      const existing = parse(await readFile(targetPath, 'utf-8').catch(() => '')) ?? {};

      const missing = findMissingKeys(source, existing, options.key, options.force);
      report.missingCount += missing.length;

      if (options.dryRun) {
        report.estimatedCostUsd += estimateCost(missing, model);
        continue;
      }

      for (const { path, sourceValue } of missing) {
        try {
          const translated = await callClaudeWithRetry({
            sourceValue, sourceLocale: 'en', targetLocale, namespace,
            glossary, model, path,
          });
          validateIcuParity(sourceValue, translated, path);
          setDeepKey(existing, path, translated);
          report.translatedCount++;
          report.actualCostUsd += estimateCostSingle(sourceValue, translated, model);
          await sleep(CLAUDE_API_DELAY_MS);
        } catch (err: any) {
          report.failedCount++;
          report.failures.push({
            namespace, key: path.join('.'), locale: targetLocale, error: err.message,
          });
          await appendFailureLog(localesDir, { namespace, key: path.join('.'), locale: targetLocale, error: err.message });
        }
      }

      if (!options.dryRun && missing.length > 0) {
        await writeFile(targetPath, stringify(existing, { lineWidth: 100 }), 'utf-8');
      }
    }
  }

  return report;
}

async function loadGlossary(localesDir: string): Promise<any> {
  const glossaryPath = join(localesDir, '_glossary.yaml');
  const content = await readFile(glossaryPath, 'utf-8');
  return parse(content);
}

/**
 * Walks the source tree and finds keys that don't exist in the target tree.
 * Returns a list of { path: string[], sourceValue: string } for each missing leaf.
 * If `specificKey` is provided (e.g. 'listings.create.title'), only that key is returned if missing.
 * If `force` is true, ALL keys are returned (triggering full retranslation).
 */
function findMissingKeys(
  source: any, existing: any,
  specificKey: string | undefined, force: boolean | undefined,
): Array<{ path: string[]; sourceValue: string }> {
  const missing: Array<{ path: string[]; sourceValue: string }> = [];

  function walk(srcNode: any, existNode: any, currentPath: string[]) {
    for (const [key, value] of Object.entries(srcNode)) {
      const newPath = [...currentPath, key];
      const existValue = existNode?.[key];

      if (typeof value === 'string') {
        // Leaf node
        if (specificKey && newPath.join('.') !== specificKey) continue;
        if (force || existValue === undefined || existValue === '') {
          missing.push({ path: newPath, sourceValue: value });
        }
      } else if (typeof value === 'object' && value !== null) {
        walk(value, existValue ?? {}, newPath);
      }
    }
  }

  walk(source, existing, []);
  return missing;
}

function setDeepKey(obj: any, path: string[], value: string) {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (current[path[i]] === undefined) current[path[i]] = {};
    current = current[path[i]];
  }
  current[path[path.length - 1]] = value;
}

async function callClaudeWithRetry(args: {
  sourceValue: string; sourceLocale: string; targetLocale: string;
  namespace: string; glossary: any; model: string; path: string[];
}): Promise<string> {
  const prompt = buildTranslationPrompt(args);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < CLAUDE_MAX_RETRIES; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: args.model,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
        .trim();

      // Strip any markdown fences the model might add
      return text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    } catch (err: any) {
      lastError = err;
      const status = err.status ?? err.response?.status;
      if (status === 429 || (status >= 500 && status < 600)) {
        const backoff = CLAUDE_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error('Max retries exceeded');
}

function buildTranslationPrompt(args: {
  sourceValue: string; sourceLocale: string; targetLocale: string;
  namespace: string; glossary: any; path: string[];
}): string {
  const { sourceValue, targetLocale, namespace, glossary, path } = args;
  const targetLocaleDescription = {
    'fr-BE': 'French (Belgian conventions, formal "vous" address, avoid anglicisms where natural French terms exist)',
    'nl-BE': 'Dutch (Belgian/Flemish conventions, formal "u" address, use Belgian Dutch vocabulary not Netherlands Dutch where they differ)',
    'de-BE': 'German (Belgian German, formal "Sie" address)',
  }[targetLocale] ?? targetLocale;

  const glossaryLines: string[] = [];
  for (const [term, rules] of Object.entries(glossary.terms ?? {})) {
    const r = rules as any;
    if (r.rule === 'never_translate') {
      glossaryLines.push(`- "${term}" → NEVER TRANSLATE (always "${r.all_locales}")`);
    } else {
      glossaryLines.push(`- "${term}" → "${r[targetLocale] ?? term}"`);
    }
  }

  return `You are translating UI strings for Spotzy, a peer-to-peer parking marketplace operating in Belgium.

TARGET LOCALE: ${targetLocale} — ${targetLocaleDescription}

NAMESPACE: ${namespace}
KEY PATH: ${path.join('.')}

GLOSSARY (you MUST use these translations consistently):
${glossaryLines.join('\n')}

TONE: Warm, helpful, slightly informal, never condescending. Match the register of the source string.

ICU MESSAGEFORMAT RULES:
- The source string may contain parameters in curly braces, e.g. {name}, {count, plural, ...}.
- Preserve these EXACTLY — do not translate parameter names, do not change the ICU syntax.
- For plural rules, produce the correct plural categories for the target locale (French and Dutch use "one" and "other", plus "=0" for zero-special).

SOURCE STRING:
${sourceValue}

Translate the source string to ${targetLocale}. Output ONLY the translated string, with no quotes, no prose, no explanations, no markdown fences. Just the translation.`;
}

/**
 * Extracts all {paramName} identifiers from an ICU MessageFormat string
 * and compares source vs translation. Throws if the parameter set differs.
 * Also validates that the translation parses as valid ICU MessageFormat.
 */
function validateIcuParity(source: string, translation: string, path: string[]) {
  let sourceAst, translationAst;
  try {
    sourceAst = parseIcu(source);
  } catch (err: any) {
    throw new Error(`Source has invalid ICU syntax at ${path.join('.')}: ${err.message}`);
  }
  try {
    translationAst = parseIcu(translation);
  } catch (err: any) {
    throw new Error(`Translation has invalid ICU syntax at ${path.join('.')}: ${err.message}`);
  }

  const sourceParams = extractParamNames(sourceAst);
  const translationParams = extractParamNames(translationAst);

  const missingInTranslation = sourceParams.filter((p) => !translationParams.includes(p));
  if (missingInTranslation.length > 0) {
    throw new Error(
      `ICU parameter mismatch at ${path.join('.')}: source has ${missingInTranslation.join(', ')} but translation does not.`
    );
  }
}

function extractParamNames(ast: any[]): string[] {
  const names: string[] = [];
  function walk(nodes: any[]) {
    for (const node of nodes) {
      if (node.type === 1 /* argument */) names.push(node.value);
      else if (node.type === 5 /* plural */) {
        names.push(node.value);
        for (const option of Object.values(node.options ?? {})) {
          walk((option as any).value ?? []);
        }
      } else if (node.type === 6 /* select */) {
        names.push(node.value);
        for (const option of Object.values(node.options ?? {})) {
          walk((option as any).value ?? []);
        }
      }
    }
  }
  walk(ast);
  return [...new Set(names)];
}

function estimateCost(missing: Array<{ sourceValue: string }>, model: string): number {
  let total = 0;
  for (const { sourceValue } of missing) {
    total += estimateCostSingle(sourceValue, sourceValue, model);  // approximate: output ≈ input for short strings
  }
  return total;
}

function estimateCostSingle(source: string, translation: string, model: string): number {
  const inputTokens = Math.ceil(source.length / 4) + 600;  // +600 for prompt overhead
  const outputTokens = Math.ceil(translation.length / 4);
  const pricing = {
    [CLAUDE_MODEL_SONNET]: { input: 3 / 1_000_000, output: 15 / 1_000_000 },
    [CLAUDE_MODEL_OPUS]: { input: 15 / 1_000_000, output: 75 / 1_000_000 },
    [CLAUDE_MODEL_HAIKU]: { input: 1 / 1_000_000, output: 5 / 1_000_000 },
  }[model] ?? { input: 3 / 1_000_000, output: 15 / 1_000_000 };
  return inputTokens * pricing.input + outputTokens * pricing.output;
}

async function appendFailureLog(localesDir: string, entry: { namespace: string; key: string; locale: string; error: string }) {
  const csvPath = join(localesDir, '..', '..', 'i18n-translation-failures.csv');
  const line = `${new Date().toISOString()},${entry.namespace},${entry.key},${entry.locale},"${entry.error.replace(/"/g, '""')}"\n`;
  const { appendFile } = await import('fs/promises');
  await appendFile(csvPath, line, 'utf-8');
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ── CLI ──────────────────────────────────────────────────────────────────
export function parseArgs(argv: string[]): TranslateOptions & { model?: string } {
  const opts: TranslateOptions & { model?: string } = {};
  for (const arg of argv) {
    if (arg.startsWith('--namespace=')) {
      const ns = arg.split('=')[1] as Namespace;
      opts.namespaces = [ns];
    } else if (arg.startsWith('--key=')) {
      opts.key = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--force') {
      opts.force = true;
    } else if (arg.startsWith('--target=')) {
      opts.targetLocale = arg.split('=')[1] as SupportedLocale;
    } else if (arg.startsWith('--model=')) {
      const m = arg.split('=')[1];
      opts.model = m === 'opus' ? CLAUDE_MODEL_OPUS :
                   m === 'haiku' ? CLAUDE_MODEL_HAIKU :
                   CLAUDE_MODEL_SONNET;
    }
  }
  if (!opts.model) opts.model = CLAUDE_MODEL_SONNET;
  return opts;
}

if (require.main === module) {
  (async () => {
    const opts = parseArgs(process.argv.slice(2));
    const report = await translateMissingKeys(opts);
    console.log(`Translation report:`);
    console.log(`  Missing keys found:  ${report.missingCount}`);
    console.log(`  Translated:           ${report.translatedCount}`);
    console.log(`  Failed:               ${report.failedCount}`);
    if (opts.dryRun) {
      console.log(`  Estimated cost:       $${report.estimatedCostUsd.toFixed(4)}`);
    } else {
      console.log(`  Actual cost:          $${report.actualCostUsd.toFixed(4)}`);
    }
    if (report.failures.length > 0) {
      console.error(`\nFailures:`);
      for (const f of report.failures) {
        console.error(`  [${f.locale}] ${f.namespace}.${f.key}: ${f.error}`);
      }
      process.exit(1);
    }
  })();
}
```

### A2 — Package.json script entries

Add to `frontend/package.json`:

```json
{
  "scripts": {
    "i18n:translate": "ts-node scripts/i18n-translate.ts",
    "i18n:translate:dry-run": "ts-node scripts/i18n-translate.ts --dry-run",
    "i18n:retranslate": "ts-node scripts/i18n-translate.ts --force"
  }
}
```

---

## PART B — Legal document translation script

### B1 — Main script file

Create `frontend/scripts/i18n-translate-legal.ts`. Shares most of PART A's plumbing but operates on Markdown files in `frontend/public/legal/` rather than YAML namespaces, uses `claude-opus-4-6` by default, and uses a legal-document-specific prompt (§11.3 of the spec).

**Tests first:** `frontend/scripts/__tests__/i18n-translate-legal.test.ts` covers:

- Happy path — reads English Markdown, calls Claude with opus model and legal prompt, writes to target locale Markdown file with correct front matter
- Preserves Markdown structure — headings, numbered lists, bold, links all survive translation
- Updates the front matter: `source: claude-opus-4-6`, `generated: {timestamp}`, `reviewed: false`, new `version` bumped
- Side-by-side diff output mode — prints the source and translated sections next to each other
- Rejects input without front matter — requires the English source to have `version:` and other required fields
- Document name validation — only accepts names from the `LEGAL_DOCUMENTS` constant
- Translation output retains all Markdown heading levels in the same order (checked by comparing `#` heading counts)

**Implementation highlights:**

```typescript
#!/usr/bin/env node
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import matter from 'gray-matter';                 // front-matter parser
import Anthropic from '@anthropic-ai/sdk';
import { LEGAL_DOCUMENTS, LEGAL_DOCS_DIR, TARGET_LOCALES, CLAUDE_MODEL_OPUS, type LegalDocument, type SupportedLocale } from './lib/constants';

const LEGAL_PROMPT_TEMPLATE = `You are translating a legal document from English to {TARGET_LOCALE} for Spotzy,
a Belgian peer-to-peer parking marketplace.

This document is a {DOCUMENT_TYPE} that will be presented to consumers in Belgium.
Belgian consumer law (Code de droit économique, Livre VI) requires that contracts
with consumers be in the consumer's language.

TRANSLATION REQUIREMENTS:
- Preserve the exact legal meaning of every clause.
- Use Belgian legal terminology conventions, not French-French or Dutch-Dutch.
- Preserve all numbered references, section headings, and cross-references.
- Preserve all Markdown formatting (headers, lists, bold, italics, links).
- Do NOT add or remove sections or clauses.
- Do NOT soften or sharpen the legal language — match the tone exactly.
- Where Spotzy-specific terms appear, use the glossary translations (below).
- Where standard legal phrases have established Belgian translations, use them.

GLOSSARY:
{GLOSSARY}

ADDITIONAL LEGAL TERMINOLOGY REFERENCE:
- "Terms of Service" → "Conditions générales d'utilisation" (fr-BE) / "Algemene voorwaarden" (nl-BE)
- "Privacy Policy" → "Politique de confidentialité" (fr-BE) / "Privacybeleid" (nl-BE)
- "liability" → "responsabilité" (fr-BE) / "aansprakelijkheid" (nl-BE)
- "indemnity" → "indemnisation" (fr-BE) / "vrijwaring" (nl-BE)
- "force majeure" → "force majeure" (fr-BE) / "overmacht" (nl-BE)
- "as-is basis" → "tel quel" (fr-BE) / "zoals het is" (nl-BE)
- "governing law" → "droit applicable" (fr-BE) / "toepasselijk recht" (nl-BE)
- "jurisdiction" → "juridiction" (fr-BE) / "rechtsbevoegdheid" (nl-BE)

SOURCE DOCUMENT (Markdown):
{SOURCE_BODY}

OUTPUT: The translated Markdown document body, preserving all formatting and structure exactly. Do not include front matter — only the body starting with the first heading. Do not wrap the output in markdown fences. Output only the translated Markdown.`;

export async function translateLegalDocument(
  document: LegalDocument, targetLocale: SupportedLocale,
): Promise<void> {
  const sourcePath = join(LEGAL_DOCS_DIR, `${document}.en.md`);
  const raw = await readFile(sourcePath, 'utf-8');
  const { data: frontMatter, content: body } = matter(raw);

  if (!frontMatter.version) {
    throw new Error(`Source document ${sourcePath} is missing front matter 'version' field`);
  }

  const prompt = LEGAL_PROMPT_TEMPLATE
    .replace('{TARGET_LOCALE}', targetLocale)
    .replace('{DOCUMENT_TYPE}', friendlyDocumentName(document))
    .replace('{GLOSSARY}', await loadAndFormatGlossary(targetLocale))
    .replace('{SOURCE_BODY}', body);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL_OPUS,
    max_tokens: 16_000,    // legal docs can be long
    messages: [{ role: 'user', content: prompt }],
  });

  const translatedBody = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();

  validateStructuralParity(body, translatedBody, document, targetLocale);

  const newFrontMatter = {
    ...frontMatter,
    source: CLAUDE_MODEL_OPUS,
    generated: new Date().toISOString(),
    reviewed: false,
    reviewedBy: null,
    reviewedAt: null,
  };

  const output = matter.stringify(translatedBody, newFrontMatter);
  const targetPath = join(LEGAL_DOCS_DIR, `${document}.${targetLocale}.md`);
  await writeFile(targetPath, output, 'utf-8');
}

function friendlyDocumentName(doc: LegalDocument): string {
  return {
    'terms-of-service': 'Terms of Service',
    'privacy-policy': 'Privacy Policy',
    'cookie-policy': 'Cookie Policy',
    'spot-manager-tcs': 'Spot Manager Terms and Conditions',
    'block-spotter-tcs': 'Block Spotter Terms and Conditions',
  }[doc];
}

function validateStructuralParity(source: string, translation: string, doc: string, locale: string) {
  const sourceHeadings = (source.match(/^#+\s/gm) ?? []).length;
  const translationHeadings = (translation.match(/^#+\s/gm) ?? []).length;
  if (sourceHeadings !== translationHeadings) {
    throw new Error(
      `Structural parity check failed for ${doc} (${locale}): source has ${sourceHeadings} headings, translation has ${translationHeadings}. The LLM may have dropped or merged sections.`
    );
  }
}

async function loadAndFormatGlossary(targetLocale: SupportedLocale): Promise<string> {
  // Same glossary loading as PART A, formatted for prompt injection
  // ... implementation omitted for brevity (reuses PART A helper)
  return '';
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const docArg = args.find((a) => a.startsWith('--document='))?.split('=')[1] as LegalDocument;
    const targetArg = args.find((a) => a.startsWith('--target='))?.split('=')[1] as SupportedLocale;

    if (!docArg || !LEGAL_DOCUMENTS.includes(docArg)) {
      console.error(`Usage: i18n-translate-legal --document=<name> --target=<locale>`);
      console.error(`Valid documents: ${LEGAL_DOCUMENTS.join(', ')}`);
      process.exit(1);
    }

    const targets = targetArg ? [targetArg] : TARGET_LOCALES;
    for (const target of targets) {
      console.log(`Translating ${docArg} to ${target}...`);
      await translateLegalDocument(docArg, target);
      console.log(`  → written to public/legal/${docArg}.${target}.md (reviewed: false)`);
    }
  })();
}
```

### B2 — Package.json entries

```json
{
  "scripts": {
    "i18n:translate-legal": "ts-node scripts/i18n-translate-legal.ts"
  }
}
```

Example usage:

```bash
npm run i18n:translate-legal -- --document=terms-of-service
npm run i18n:translate-legal -- --document=privacy-policy --target=fr-BE
```

---

## PART C — i18n linter

### C1 — Main linter script

Create `frontend/scripts/i18n-lint.ts`. Runs the 8 checks from §8.5 of the spec.

**Tests first:** `frontend/scripts/__tests__/i18n-lint.test.ts`

```typescript
describe('i18n-lint — missing keys check', () => {
  test('passes when fr-BE and nl-BE have all keys from en', async () => {
    await writeYaml(`${tmpDir}/en/common.yaml`, { save: 'Save' });
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, { save: 'Enregistrer' });
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, { save: 'Opslaan' });
    const result = await runLinter({ localesDir: tmpDir });
    expect(result.errors).toHaveLength(0);
  });

  test('fails when fr-BE is missing a key', async () => {
    await writeYaml(`${tmpDir}/en/common.yaml`, { save: 'Save', cancel: 'Cancel' });
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, { save: 'Enregistrer' });
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, { save: 'Opslaan', cancel: 'Annuleren' });
    const result = await runLinter({ localesDir: tmpDir });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('MISSING_KEY');
    expect(result.errors[0].locale).toBe('fr-BE');
    expect(result.errors[0].key).toBe('cancel');
  });

  test('fails with nested path in error', async () => {
    await writeYaml(`${tmpDir}/en/listings.yaml`, { create: { step: { address: 'Address' } } });
    await writeYaml(`${tmpDir}/fr-BE/listings.yaml`, { create: { step: {} } });
    await writeYaml(`${tmpDir}/nl-BE/listings.yaml`, { create: { step: { address: 'Adres' } } });
    const result = await runLinter({ localesDir: tmpDir });
    expect(result.errors[0].key).toBe('create.step.address');
  });
});

describe('i18n-lint — extra keys warning', () => {
  test('warns when fr-BE has a key not in en (no longer needed)', async () => {
    await writeYaml(`${tmpDir}/en/common.yaml`, { save: 'Save' });
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, { save: 'Enregistrer', oldKey: 'Old' });
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, { save: 'Opslaan' });
    const result = await runLinter({ localesDir: tmpDir });
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe('EXTRA_KEY');
  });
});

describe('i18n-lint — YAML syntax', () => {
  test('fails on malformed YAML', async () => {
    await writeRaw(`${tmpDir}/en/common.yaml`, 'save: "unclosed quote\n');
    const result = await runLinter({ localesDir: tmpDir });
    expect(result.errors[0].code).toBe('YAML_SYNTAX');
    expect(result.errors[0].file).toContain('en/common.yaml');
    expect(result.errors[0].message).toMatch(/line/i);
  });

  test('fails on value with curly braces missing quotes', async () => {
    // YAML parses this but with potentially wrong semantics
    await writeRaw(`${tmpDir}/fr-BE/common.yaml`, 'greeting: Hello {name}!\n');
    await writeYaml(`${tmpDir}/en/common.yaml`, { greeting: 'Hello {name}!' });
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, { greeting: 'Hallo {name}!' });
    const result = await runLinter({ localesDir: tmpDir });
    // The linter should catch this as QUOTING_REQUIRED even if YAML didn't reject it
    expect(result.warnings.some((w) => w.code === 'QUOTING_REQUIRED')).toBe(true);
  });
});

describe('i18n-lint — ICU parse', () => {
  test('fails on malformed ICU MessageFormat', async () => {
    await writeYaml(`${tmpDir}/en/common.yaml`, { greeting: 'Hello {name' });  // unclosed brace
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, { greeting: 'Bonjour {name}' });
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, { greeting: 'Hallo {name}' });
    const result = await runLinter({ localesDir: tmpDir });
    expect(result.errors[0].code).toBe('ICU_SYNTAX');
    expect(result.errors[0].locale).toBe('en');
  });
});

describe('i18n-lint — parameter mismatch', () => {
  test('fails when fr-BE translation is missing an ICU parameter', async () => {
    await writeYaml(`${tmpDir}/en/common.yaml`, { greeting: 'Hello {name}!' });
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, { greeting: 'Bonjour !' });   // missing {name}
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, { greeting: 'Hallo {name}!' });
    const result = await runLinter({ localesDir: tmpDir });
    expect(result.errors[0].code).toBe('PARAM_MISMATCH');
    expect(result.errors[0].locale).toBe('fr-BE');
    expect(result.errors[0].details).toContain('name');
  });
});

describe('i18n-lint — glossary violation', () => {
  test('flags when fr-BE translation contains source-language term where glossary specifies a translation', async () => {
    await writeYaml(`${tmpDir}/_glossary.yaml`, {
      terms: { 'Spot Pool': { rule: 'translate', 'fr-BE': 'Pool de Stationnement' } },
    });
    await writeYaml(`${tmpDir}/en/common.yaml`, { label: 'Your Spot Pool' });
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, { label: 'Votre Spot Pool' });   // should be "Pool de Stationnement"
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, { label: 'Uw Parkeerpool' });
    const result = await runLinter({ localesDir: tmpDir });
    expect(result.errors.some((e) => e.code === 'GLOSSARY_VIOLATION' && e.locale === 'fr-BE')).toBe(true);
  });
});

describe('i18n-lint — HTML balance', () => {
  test('fails when translation has unbalanced tags', async () => {
    await writeYaml(`${tmpDir}/en/common.yaml`, { note: 'Click <a>here</a>' });
    await writeYaml(`${tmpDir}/fr-BE/common.yaml`, { note: 'Cliquez <a>ici' });   // missing </a>
    await writeYaml(`${tmpDir}/nl-BE/common.yaml`, { note: 'Klik <a>hier</a>' });
    const result = await runLinter({ localesDir: tmpDir });
    expect(result.errors.some((e) => e.code === 'HTML_UNBALANCED')).toBe(true);
  });
});

describe('i18n-lint — friendly error messages', () => {
  test('error message includes file, line hint, and fix suggestion', async () => {
    await writeRaw(`${tmpDir}/fr-BE/common.yaml`, 'greeting: "unclosed\n');
    const result = await runLinter({ localesDir: tmpDir });
    const err = result.errors[0];
    expect(err.friendlyMessage).toContain('fr-BE/common.yaml');
    expect(err.friendlyMessage).toContain('line');
    expect(err.friendlyMessage.toLowerCase()).toMatch(/fix|add|remove/);
  });
});
```

**Implementation — `frontend/scripts/i18n-lint.ts`:**

```typescript
#!/usr/bin/env node
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { parse as parseYaml, parseDocument } from 'yaml';
import { parse as parseIcu } from '@formatjs/icu-messageformat-parser';
import {
  SUPPORTED_LOCALES, TARGET_LOCALES, NAMESPACES, LOCALES_DIR, GLOSSARY_FILE,
  SMS_NAMESPACES, SMS_ASCII_MAX, SMS_UNICODE_MAX,
  type SupportedLocale, type Namespace,
} from './lib/constants';

interface LinterIssue {
  severity: 'error' | 'warning';
  code: string;          // MISSING_KEY, EXTRA_KEY, YAML_SYNTAX, ICU_SYNTAX, PARAM_MISMATCH, GLOSSARY_VIOLATION, HTML_UNBALANCED, SMS_TOO_LONG, QUOTING_REQUIRED
  file: string;
  locale?: SupportedLocale;
  namespace?: string;
  key?: string;
  message: string;
  friendlyMessage: string;
  details?: string;
}

interface LinterResult {
  errors: LinterIssue[];
  warnings: LinterIssue[];
}

export async function runLinter(options: { localesDir?: string } = {}): Promise<LinterResult> {
  const localesDir = options.localesDir ?? LOCALES_DIR;
  const errors: LinterIssue[] = [];
  const warnings: LinterIssue[] = [];

  const glossary = await loadGlossary(localesDir).catch(() => ({ terms: {} }));

  for (const namespace of NAMESPACES) {
    const sourcePath = join(localesDir, 'en', `${namespace}.yaml`);
    const sourceContent = await readFile(sourcePath, 'utf-8').catch(() => null);
    if (sourceContent === null) {
      errors.push(makeIssue('error', 'MISSING_FILE', sourcePath, undefined, namespace, undefined,
        `Source file missing: ${sourcePath}`,
        `The English source file for namespace "${namespace}" is missing. Create ${sourcePath}.`));
      continue;
    }

    let source: any;
    try {
      source = parseYaml(sourceContent) ?? {};
    } catch (err: any) {
      errors.push(makeYamlSyntaxIssue(sourcePath, 'en', namespace, err));
      continue;
    }

    // Check ICU syntax of source strings
    validateIcuInTree(source, [], 'en', namespace, sourcePath, errors);

    for (const targetLocale of TARGET_LOCALES) {
      const targetPath = join(localesDir, targetLocale, `${namespace}.yaml`);
      const targetContent = await readFile(targetPath, 'utf-8').catch(() => null);
      if (targetContent === null) {
        errors.push(makeIssue('error', 'MISSING_FILE', targetPath, targetLocale, namespace, undefined,
          `Target file missing: ${targetPath}`,
          `The ${targetLocale} file for namespace "${namespace}" is missing. Create ${targetPath}.`));
        continue;
      }

      let target: any;
      try {
        target = parseYaml(targetContent) ?? {};
      } catch (err: any) {
        errors.push(makeYamlSyntaxIssue(targetPath, targetLocale, namespace, err));
        continue;
      }

      // Check for quoting issues in raw text
      checkQuotingIssues(targetContent, targetPath, targetLocale, namespace, warnings);

      // Check missing keys (source → target)
      checkMissingKeys(source, target, [], targetLocale, namespace, targetPath, errors);

      // Check extra keys (target → source)
      checkExtraKeys(source, target, [], targetLocale, namespace, targetPath, warnings);

      // Check ICU syntax + param parity for each translated string
      checkIcuParity(source, target, [], targetLocale, namespace, targetPath, errors);

      // Check glossary violations
      checkGlossaryViolations(target, [], targetLocale, namespace, targetPath, glossary, errors);

      // Check HTML tag balance
      checkHtmlBalance(source, target, [], targetLocale, namespace, targetPath, errors);

      // Check SMS length budgets (if namespace is in SMS_NAMESPACES)
      if (SMS_NAMESPACES.includes(namespace as any)) {
        checkSmsLength(target, [], targetLocale, namespace, targetPath, errors);
      }
    }
  }

  return { errors, warnings };
}

// Helper: walk tree and collect issues
function checkMissingKeys(source: any, target: any, path: string[], locale: SupportedLocale, namespace: string, file: string, errors: LinterIssue[]) {
  for (const [key, value] of Object.entries(source)) {
    const newPath = [...path, key];
    if (typeof value === 'string') {
      if (target?.[key] === undefined) {
        errors.push(makeIssue('error', 'MISSING_KEY', file, locale, namespace, newPath.join('.'),
          `Missing key "${newPath.join('.')}" in ${locale}/${namespace}.yaml`,
          `The key "${newPath.join('.')}" exists in en/${namespace}.yaml but is missing from ${locale}/${namespace}.yaml.\n  Fix: Run \`npm run i18n:translate\` to auto-fill missing keys, or add the translation manually.`));
      }
    } else if (typeof value === 'object' && value !== null) {
      checkMissingKeys(value, target?.[key] ?? {}, newPath, locale, namespace, file, errors);
    }
  }
}

function checkExtraKeys(source: any, target: any, path: string[], locale: SupportedLocale, namespace: string, file: string, warnings: LinterIssue[]) {
  if (typeof target !== 'object' || target === null) return;
  for (const [key, value] of Object.entries(target)) {
    const newPath = [...path, key];
    if (source?.[key] === undefined) {
      warnings.push(makeIssue('warning', 'EXTRA_KEY', file, locale, namespace, newPath.join('.'),
        `Extra key "${newPath.join('.')}" in ${locale}/${namespace}.yaml`,
        `The key "${newPath.join('.')}" exists in ${locale}/${namespace}.yaml but NOT in en/${namespace}.yaml. It may be a stale translation that should be removed.`));
    } else if (typeof value === 'object' && value !== null) {
      checkExtraKeys(source[key], value, newPath, locale, namespace, file, warnings);
    }
  }
}

// ... (other checker functions, each ~20 lines, implementing the remaining 6 checks)

function makeIssue(severity: 'error' | 'warning', code: string, file: string, locale: SupportedLocale | undefined, namespace: string | undefined, key: string | undefined, message: string, friendlyMessage: string, details?: string): LinterIssue {
  return { severity, code, file, locale, namespace, key, message, friendlyMessage, details };
}

function makeYamlSyntaxIssue(file: string, locale: SupportedLocale, namespace: string, err: any): LinterIssue {
  const lineMatch = err.message?.match(/line (\d+)/i);
  const line = lineMatch?.[1];
  return {
    severity: 'error', code: 'YAML_SYNTAX', file, locale, namespace,
    message: err.message,
    friendlyMessage: `❌ ${locale}/${namespace}.yaml${line ? `, line ${line}` : ''}\n   YAML parse error: ${err.message}\n   Fix: Check the indicated line. Common causes include missing quotes around values with special characters like { } : # or unbalanced indentation.`,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    const result = await runLinter();

    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log('✓ i18n lint passed. All locale files are in sync.');
      process.exit(0);
    }

    if (result.warnings.length > 0) {
      console.log(`\n⚠ ${result.warnings.length} warning(s):\n`);
      for (const w of result.warnings) {
        console.log(w.friendlyMessage);
        console.log();
      }
    }

    if (result.errors.length > 0) {
      console.log(`\n❌ ${result.errors.length} error(s):\n`);
      for (const e of result.errors) {
        console.log(e.friendlyMessage);
        console.log();
      }
      process.exit(1);
    }

    process.exit(0);
  })();
}
```

### C2 — Friendly error message convention

Every error produced by the linter has a `friendlyMessage` field that is written for a non-developer reviewer using the GitHub web UI. The format:

```
❌ <locale>/<namespace>.yaml, line <N>
   <short description of the problem>

   <fix suggestion with a concrete example>
```

Example outputs:

```
❌ fr-BE/listings.yaml, line 42
   The value contains curly braces {name} but is not wrapped in quotes.
   YAML needs quotes around values with special characters.

   Wrong:  greeting: Hello {name}!
   Right:  greeting: "Hello {name}!"

   Fix: Add double quotes around the value on line 42.

❌ nl-BE/common.yaml
   Missing key "buttons.save"
   The key exists in en/common.yaml but is missing from nl-BE/common.yaml.

   Fix: Run `npm run i18n:translate` to auto-fill missing keys,
        or add the translation manually in nl-BE/common.yaml.

⚠ fr-BE/listings.yaml
   Extra key "oldField" not found in the English source.
   This may be a stale translation that should be removed.

   Fix: Either remove "oldField" from fr-BE/listings.yaml,
        or add it to en/listings.yaml if it's intentional.
```

### C3 — Package.json entries

```json
{
  "scripts": {
    "lint:i18n": "ts-node scripts/i18n-lint.ts"
  }
}
```

---

## PART D — Legal document structure linter

### D1 — Main linter

Create `frontend/scripts/lint-legal-docs.ts`. Compares the structural shape (headings, numbered clauses, link count) of each legal document across its locale versions. Catches the case where the LLM dropped or merged a section.

**Tests first:** `frontend/scripts/__tests__/lint-legal-docs.test.ts`

```typescript
describe('lint-legal-docs', () => {
  test('passes when all locales have matching heading structure', async () => {
    const content = `---
version: 2026-04-v1
---
# Title
## Section 1
## Section 2
### Subsection 2.1
## Section 3
`;
    await writeRaw(`${tmpDir}/terms-of-service.en.md`, content);
    await writeRaw(`${tmpDir}/terms-of-service.fr-BE.md`, content);
    await writeRaw(`${tmpDir}/terms-of-service.nl-BE.md`, content);
    const result = await lintLegalDocs({ legalDir: tmpDir });
    expect(result.errors).toHaveLength(0);
  });

  test('fails when fr-BE has fewer sections than en', async () => {
    const enContent = `---
version: 2026-04-v1
---
# Title
## Section 1
## Section 2
## Section 3
`;
    const frContent = `---
version: 2026-04-v1
---
# Title
## Section 1
## Section 2
`;
    await writeRaw(`${tmpDir}/terms-of-service.en.md`, enContent);
    await writeRaw(`${tmpDir}/terms-of-service.fr-BE.md`, frContent);
    await writeRaw(`${tmpDir}/terms-of-service.nl-BE.md`, enContent);
    const result = await lintLegalDocs({ legalDir: tmpDir });
    expect(result.errors[0].code).toBe('HEADING_COUNT_MISMATCH');
    expect(result.errors[0].locale).toBe('fr-BE');
    expect(result.errors[0].details).toContain('expected 4');
    expect(result.errors[0].details).toContain('found 3');
  });

  test('fails when heading levels differ', async () => {
    // en has ## at a position where fr-BE has ###
    // catches level-promotion or level-demotion bugs
    const enContent = `# T\n## A\n## B`;
    const frContent = `# T\n## A\n### B`;
    // ... setup
    const result = await lintLegalDocs({ legalDir: tmpDir });
    expect(result.errors.some((e) => e.code === 'HEADING_LEVEL_MISMATCH')).toBe(true);
  });

  test('fails on missing locale file', async () => {
    await writeRaw(`${tmpDir}/terms-of-service.en.md`, '# T\n');
    // fr-BE missing
    await writeRaw(`${tmpDir}/terms-of-service.nl-BE.md`, '# T\n');
    const result = await lintLegalDocs({ legalDir: tmpDir });
    expect(result.errors[0].code).toBe('MISSING_LOCALE_FILE');
    expect(result.errors[0].locale).toBe('fr-BE');
  });

  test('warns when version identifiers differ across locales', async () => {
    const enContent = `---\nversion: 2026-04-v2\n---\n# T\n`;
    const frContent = `---\nversion: 2026-04-v1\n---\n# T\n`;   // stale
    const nlContent = `---\nversion: 2026-04-v2\n---\n# T\n`;
    // ... setup
    const result = await lintLegalDocs({ legalDir: tmpDir });
    expect(result.warnings.some((w) => w.code === 'VERSION_MISMATCH')).toBe(true);
  });
});
```

**Implementation:**

```typescript
import { readFile } from 'fs/promises';
import { join } from 'path';
import matter from 'gray-matter';
import { LEGAL_DOCUMENTS, LEGAL_DOCS_DIR, SUPPORTED_LOCALES, type LegalDocument, type SupportedLocale } from './lib/constants';

interface LegalLintIssue {
  severity: 'error' | 'warning';
  code: string;
  document: LegalDocument;
  locale?: SupportedLocale;
  message: string;
  details?: string;
}

export async function lintLegalDocs(options: { legalDir?: string } = {}): Promise<{ errors: LegalLintIssue[]; warnings: LegalLintIssue[] }> {
  const legalDir = options.legalDir ?? LEGAL_DOCS_DIR;
  const errors: LegalLintIssue[] = [];
  const warnings: LegalLintIssue[] = [];

  for (const doc of LEGAL_DOCUMENTS) {
    // Load English source
    const enPath = join(legalDir, `${doc}.en.md`);
    const enContent = await readFile(enPath, 'utf-8').catch(() => null);
    if (enContent === null) {
      errors.push({ severity: 'error', code: 'MISSING_SOURCE', document: doc, message: `English source missing: ${enPath}` });
      continue;
    }

    const { data: enFrontMatter, content: enBody } = matter(enContent);
    const enHeadings = extractHeadings(enBody);

    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'en') continue;
      const localePath = join(legalDir, `${doc}.${locale}.md`);
      const localeContent = await readFile(localePath, 'utf-8').catch(() => null);
      if (localeContent === null) {
        errors.push({
          severity: 'error', code: 'MISSING_LOCALE_FILE', document: doc, locale,
          message: `Missing locale file: ${localePath}`,
          details: `Run \`npm run i18n:translate-legal -- --document=${doc} --target=${locale}\` to generate a first draft.`,
        });
        continue;
      }

      const { data: localeFrontMatter, content: localeBody } = matter(localeContent);
      const localeHeadings = extractHeadings(localeBody);

      if (enHeadings.length !== localeHeadings.length) {
        errors.push({
          severity: 'error', code: 'HEADING_COUNT_MISMATCH', document: doc, locale,
          message: `${doc}.${locale}.md has a different number of headings from the English source`,
          details: `English expected ${enHeadings.length} headings, ${locale} found ${localeHeadings.length}. The LLM may have dropped or merged a section. Compare the two files side by side and restore any missing sections.`,
        });
      } else {
        for (let i = 0; i < enHeadings.length; i++) {
          if (enHeadings[i].level !== localeHeadings[i].level) {
            errors.push({
              severity: 'error', code: 'HEADING_LEVEL_MISMATCH', document: doc, locale,
              message: `Heading level mismatch at position ${i + 1}`,
              details: `English has level ${enHeadings[i].level} ("${enHeadings[i].text}"), ${locale} has level ${localeHeadings[i].level} ("${localeHeadings[i].text}").`,
            });
          }
        }
      }

      // Version check
      if (enFrontMatter.version !== localeFrontMatter.version) {
        warnings.push({
          severity: 'warning', code: 'VERSION_MISMATCH', document: doc, locale,
          message: `Version mismatch: en is "${enFrontMatter.version}", ${locale} is "${localeFrontMatter.version}"`,
          details: `When the English source is updated, re-run the translation script and review the output.`,
        });
      }

      // Reviewed flag check (warning only — informational)
      if (localeFrontMatter.reviewed === false) {
        warnings.push({
          severity: 'warning', code: 'NOT_REVIEWED', document: doc, locale,
          message: `${doc}.${locale}.md has reviewed: false — founder review still pending`,
        });
      }
    }
  }

  return { errors, warnings };
}

function extractHeadings(markdown: string): Array<{ level: number; text: string }> {
  const headings: Array<{ level: number; text: string }> = [];
  const lines = markdown.split('\n');
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2].trim() });
    }
  }
  return headings;
}

if (require.main === module) {
  (async () => {
    const result = await lintLegalDocs();
    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log('✓ Legal documents are structurally consistent across all locales.');
      process.exit(0);
    }
    for (const e of result.errors) {
      console.error(`❌ ${e.document} (${e.locale ?? 'en'}): ${e.message}`);
      if (e.details) console.error(`   ${e.details}`);
    }
    for (const w of result.warnings) {
      console.warn(`⚠ ${w.document} (${w.locale ?? 'en'}): ${w.message}`);
      if (w.details) console.warn(`   ${w.details}`);
    }
    if (result.errors.length > 0) process.exit(1);
  })();
}
```

### D2 — Package.json entry

```json
{
  "scripts": {
    "lint:legal-docs": "ts-node scripts/lint-legal-docs.ts"
  }
}
```

---

## PART E — Git pre-push hook

### E1 — Hook script

Create `frontend/scripts/git-hooks/pre-push`. A bash script that runs before every `git push`, translates any new keys added to `en/` in the commits being pushed, and amends the push with the translations.

```bash
#!/usr/bin/env bash
# frontend/scripts/git-hooks/pre-push
# Spotzy i18n pre-push hook
# Installed by: npm run i18n:install-hooks

set -e

# Only run if commits being pushed touched en/ files
REMOTE="$1"
URL="$2"

# Read the list of refs being pushed from stdin
while read LOCAL_REF LOCAL_SHA REMOTE_REF REMOTE_SHA; do
  if [ "$LOCAL_SHA" = "0000000000000000000000000000000000000000" ]; then
    # Branch being deleted; skip
    continue
  fi

  if [ "$REMOTE_SHA" = "0000000000000000000000000000000000000000" ]; then
    # New branch; check all commits vs main
    RANGE="main..$LOCAL_SHA"
  else
    RANGE="$REMOTE_SHA..$LOCAL_SHA"
  fi

  if git diff --name-only "$RANGE" | grep -q 'frontend/src/locales/en/'; then
    echo "[i18n] Detected changes in en/ — running translation script"
    cd frontend
    npm run i18n:translate --silent || {
      echo "[i18n] Translation script failed (API error?). Push will proceed but locale files may be out of sync. Run 'npm run i18n:translate' manually after the push completes."
      cd ..
      exit 0
    }

    if ! git diff --quiet src/locales/; then
      echo "[i18n] New translations generated. Amending the last commit with them."
      git add src/locales/
      git commit --amend --no-edit
    else
      echo "[i18n] No new keys to translate."
    fi
    cd ..
  fi
done

exit 0
```

### E2 — Installer script

Create `frontend/scripts/install-git-hooks.sh`. A one-time setup script the founder runs after cloning the repo.

```bash
#!/usr/bin/env bash
# frontend/scripts/install-git-hooks.sh
set -e

HOOK_SOURCE="frontend/scripts/git-hooks/pre-push"
HOOK_DEST=".git/hooks/pre-push"

if [ ! -f "$HOOK_SOURCE" ]; then
  echo "❌ Hook source not found at $HOOK_SOURCE. Run from repo root."
  exit 1
fi

if [ -f "$HOOK_DEST" ]; then
  echo "⚠ $HOOK_DEST already exists. Backing up to $HOOK_DEST.backup"
  mv "$HOOK_DEST" "$HOOK_DEST.backup"
fi

cp "$HOOK_SOURCE" "$HOOK_DEST"
chmod +x "$HOOK_DEST"

echo "✓ Git pre-push hook installed."
echo "  The hook will automatically translate new en/ keys to fr-BE and nl-BE before every push."
echo "  To uninstall: rm .git/hooks/pre-push"
```

### E3 — Package.json entry

```json
{
  "scripts": {
    "i18n:install-hooks": "bash scripts/install-git-hooks.sh"
  }
}
```

Usage: `cd <repo-root> && npm run i18n:install-hooks` once after cloning.

---

## PART F — GitHub Actions workflow

### F1 — CI workflow file

Create `.github/workflows/i18n.yml`. Runs the i18n linter and the legal docs linter on every pull request that touches translation files.

```yaml
name: i18n

on:
  pull_request:
    paths:
      - 'frontend/src/locales/**'
      - 'frontend/public/legal/**'
      - 'frontend/scripts/i18n-*.ts'
      - 'frontend/scripts/lint-legal-docs.ts'

jobs:
  lint:
    name: i18n linter
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - name: Install dependencies
        working-directory: frontend
        run: npm ci
      - name: Run i18n linter
        working-directory: frontend
        run: npm run lint:i18n
      - name: Run legal docs linter
        working-directory: frontend
        run: npm run lint:legal-docs

  comment-errors:
    name: Post friendly errors as PR comment
    runs-on: ubuntu-latest
    needs: lint
    if: failure()
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Run linters and capture output
        working-directory: frontend
        continue-on-error: true
        run: |
          npm ci
          npm run lint:i18n 2>&1 | tee /tmp/i18n-errors.txt
          npm run lint:legal-docs 2>&1 | tee -a /tmp/i18n-errors.txt
      - name: Post comment on PR
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const errors = fs.readFileSync('/tmp/i18n-errors.txt', 'utf-8');
            const body = `## ❌ i18n lint failed\n\nThe localization linter found issues in this pull request:\n\n\`\`\`\n${errors}\n\`\`\`\n\nFix the errors shown above and push a new commit. If you're editing in the GitHub web UI, click the pencil icon on the affected file and fix the specific lines mentioned.`;
            await github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body,
            });
```

The second job (`comment-errors`) runs only on failure and posts the friendly error messages as a PR comment, so the founder's wife can see exactly what's wrong without leaving the GitHub web UI.

---

## PART G — README documentation

### G1 — i18n workflow guide

Create `frontend/docs/i18n-workflow.md`. The in-repo guide that the founder and the non-technical reviewer both read.

**Content outline:**

```markdown
# Spotzy i18n workflow guide

## For the founder (daily use)

### Adding a new UI string
1. Add the English source to the appropriate `en/*.yaml` file
2. Either:
   - Let the pre-push hook translate on push (if installed via `npm run i18n:install-hooks`)
   - OR run `npm run i18n:translate` manually to fill in fr-BE and nl-BE
3. Review the generated translations
4. Commit everything

### Adding a new namespace
1. Create `en/{namespace}.yaml` with initial English strings
2. Create empty `fr-BE/{namespace}.yaml` and `nl-BE/{namespace}.yaml` (just `{}` content)
3. Run `npm run i18n:translate`
4. Add the namespace to `NAMESPACES` in `frontend/scripts/lib/constants.ts`
5. Update the i18n loader in `frontend/src/i18n.ts` to include it

### Updating the glossary
1. Edit `frontend/src/locales/_glossary.yaml`
2. Run `npm run i18n:retranslate --namespace={affected namespace}` to regenerate translations that used the changed terms
3. Review the diffs and commit

### Updating a legal document
1. Edit the English source (`terms-of-service.en.md`, etc.)
2. Bump the version in the front matter (e.g. `v1` → `v2`)
3. Run `npm run i18n:translate-legal -- --document={name}`
4. Review the fr-BE and nl-BE outputs line by line
5. Optionally escalate uncertain passages to a legal adviser
6. Once satisfied, manually set `reviewed: true` in each locale's front matter
7. Commit all three files together

### Running the linters manually
- `npm run lint:i18n` — checks all UI translation files
- `npm run lint:legal-docs` — checks legal document structure
- Both run in CI on every PR; running them locally is for fast feedback

## For non-technical reviewers (e.g. via GitHub web UI)

### Editing a translation via GitHub web UI
1. Navigate to `github.com/spotzy/spotzy/tree/main/frontend/src/locales/fr-BE/`
2. Click the file you want to edit (e.g. `listings.yaml`)
3. Click the pencil icon ("Edit this file")
4. Make your edits in the browser editor
5. At the bottom, add a commit message (e.g. "Fix awkward wording in listing creation")
6. Select "Create a new branch for this commit and start a pull request"
7. Click "Propose changes"
8. GitHub opens a pull request. CI runs the linter automatically.
9. If the linter fails, read the error message it posts on the PR and fix the specific line it points to.
10. Once CI passes, the founder reviews and merges.

### Common YAML errors and fixes

**Error: "The value contains curly braces {name} but is not wrapped in quotes"**

Wrong:
```yaml
greeting: Hello {name}!
```

Right:
```yaml
greeting: "Hello {name}!"
```

Always use double quotes when the value contains `{`, `}`, `:`, `#`, `[`, `]`, or starts with `-`.

**Error: "Extra key "oldField" not found in the English source"**

This is a warning, not a blocking error. It means you have a key in the translation file that doesn't exist in English. Either remove it, or add it to `en/` first if it's supposed to exist.

**Error: "ICU parameter mismatch at listings.create.greeting"**

The English version has a parameter like `{name}` that's missing from your translation. Look at the English version and make sure every `{parameter}` appears in the translation too.

### What NOT to edit
- Files in `en/` — the founder maintains the source strings
- The `_glossary.yaml` file — terminology changes go through the founder
- Anything under `public/legal/` — legal documents go through the founder and legal review
```

### G2 — Link from main README

Add a one-line reference in the root `README.md` pointing to `frontend/docs/i18n-workflow.md` for anyone looking for localization info.

---

## PART H — Acceptance criteria

A successful Claude Code run produces:

1. **LLM translation script** (`frontend/scripts/i18n-translate.ts`) with passing tests for all invocation modes, ICU parity validation, retry logic, glossary injection, and dry-run reporting.
2. **Legal document translation script** (`frontend/scripts/i18n-translate-legal.ts`) that uses `claude-opus-4-6`, preserves Markdown structure, updates front matter with `reviewed: false` flag.
3. **i18n linter** (`frontend/scripts/i18n-lint.ts`) with all 8 checks implemented and friendly error messages.
4. **Legal docs structure linter** (`frontend/scripts/lint-legal-docs.ts`) checking heading count, heading levels, missing files, and version parity.
5. **Git pre-push hook** (`frontend/scripts/git-hooks/pre-push`) and installer (`frontend/scripts/install-git-hooks.sh`).
6. **GitHub Actions workflow** (`.github/workflows/i18n.yml`) running both linters on PRs with friendly PR comments on failure.
7. **Package.json** has all 7 new script entries: `i18n:translate`, `i18n:translate:dry-run`, `i18n:retranslate`, `i18n:translate-legal`, `lint:i18n`, `lint:legal-docs`, `i18n:install-hooks`.
8. **Documentation** (`frontend/docs/i18n-workflow.md`) covering both founder and non-technical reviewer workflows.
9. **Tests pass** end-to-end — the translation script can take an empty `fr-BE/common.yaml` and an `en/common.yaml` with 10 strings, call the mocked Claude API, and produce a valid populated `fr-BE/common.yaml` with all 10 translations validated by the linter in the same run.

### Open questions to resolve at implementation time

1. **Claude API key storage in CI.** The GitHub Actions workflow doesn't need the API key — it only runs the linters, not the translation script. This keeps the key scoped to the founder's local environment only. Store it in `.env.local` (git-ignored). Document this in `frontend/docs/i18n-workflow.md`.

2. **Parallel Claude API calls.** The script currently runs calls serially with a 100ms delay. Parallel calls with a concurrency limit of 5 would speed up full-catalog translation by ~5x but complicates retry logic. Out of scope for v2.x — serial is fast enough for incremental updates (< 10 seconds for a typical feature addition).

3. **Translation cache at the script level.** If the founder runs `npm run i18n:retranslate` twice in a row, the script calls Claude a second time with the same inputs, getting slightly different outputs. A local SHA-based cache (keyed on source string + glossary version + model) would avoid duplicate work. Out of scope — cost is trivial and the second run is a rare edge case.

4. **Interactive review mode.** A `--interactive` flag could show each translation side-by-side with the source and ask the founder to approve/edit/regenerate before writing. Useful for the initial v2.x translation pass. Deferred to v3+.

5. **Handling namespace file creation.** When the founder adds a new namespace, they currently have to manually create the empty target-locale files. A `--create-namespace` mode could automate this. Minor UX improvement, deferred.

---

## Reading order for Claude Code

Recommended sequence:

1. **PART A** — the translation script. This is the centerpiece. Red-green-refactor through every test.
2. **PART C** — the i18n linter. Red-green-refactor through each check individually, not all at once.
3. **PART D** — the legal docs structure linter. Smaller, faster.
4. **PART B** — the legal document translation script. Similar to PART A but for Markdown.
5. **PART E** — the git hook and installer. Simple but verify the shell script actually runs on macOS and Linux.
6. **PART F** — the GitHub Actions workflow. Deploy to a test branch first and verify the linter fails correctly on a broken translation file, then fix and verify it passes.
7. **PART G** — the documentation. Write this last, drawing on the actual script behavior observed during implementation.

The most common implementation mistake is getting the nested YAML key walk wrong in `findMissingKeys` — make sure the recursive walk handles 3+ levels of nesting correctly, not just flat structures. The tests in PART A explicitly cover this with `listings.create.step.address.label`.

The second most common mistake is forgetting to escape special characters in the Claude prompt. If a source string contains backticks, curly braces, or Markdown formatting, they can confuse the prompt parser. Use template literals with explicit escaping and never use `eval` or `Function` constructors.
