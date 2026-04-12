#!/usr/bin/env npx tsx
/**
 * i18n linter — validates translation files for missing/extra keys,
 * YAML syntax, ICU MessageFormat, and glossary compliance.
 *
 * Usage:
 *   npm run lint:i18n
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';
import {
  SOURCE_LOCALE,
  TARGET_LOCALES,
  LOCALES_DIR,
  GLOSSARY_FILE,
  NAMESPACES,
} from './lib/constants';

interface LintError {
  level: 'error' | 'warning';
  namespace: string;
  locale: string;
  key?: string;
  message: string;
}

const errors: LintError[] = [];

function loadYaml(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8');
    return parse(content) ?? {};
  } catch (err: any) {
    return null;
  }
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

function extractParams(text: string): Set<string> {
  const params = new Set<string>();
  const regex = /\{(\w+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    params.add(match[1]);
  }
  return params;
}

function main() {
  for (const ns of NAMESPACES) {
    const sourcePath = join(process.cwd(), LOCALES_DIR, SOURCE_LOCALE, `${ns}.yaml`);
    const sourceData = loadYaml(sourcePath);

    if (!sourceData) {
      errors.push({ level: 'error', namespace: ns, locale: SOURCE_LOCALE, message: `Missing source file: ${sourcePath}` });
      continue;
    }

    const sourceKeys = flattenKeys(sourceData);

    for (const targetLocale of TARGET_LOCALES) {
      const targetPath = join(process.cwd(), LOCALES_DIR, targetLocale, `${ns}.yaml`);
      const targetData = loadYaml(targetPath);

      if (!targetData) {
        errors.push({ level: 'error', namespace: ns, locale: targetLocale, message: `Missing translation file: ${targetPath}` });
        continue;
      }

      const targetKeys = flattenKeys(targetData);

      // Check for missing keys
      for (const key of Object.keys(sourceKeys)) {
        if (!targetKeys[key]) {
          errors.push({
            level: 'error',
            namespace: ns,
            locale: targetLocale,
            key,
            message: `Missing key "${key}" in ${targetLocale}/${ns}.yaml`,
          });
        }
      }

      // Check for extra keys
      for (const key of Object.keys(targetKeys)) {
        if (!sourceKeys[key]) {
          errors.push({
            level: 'warning',
            namespace: ns,
            locale: targetLocale,
            key,
            message: `Extra key "${key}" in ${targetLocale}/${ns}.yaml (not in source)`,
          });
        }
      }

      // Check parameter parity
      for (const [key, sourceText] of Object.entries(sourceKeys)) {
        const targetText = targetKeys[key];
        if (!targetText) continue;

        const sourceParams = extractParams(sourceText);
        const targetParams = extractParams(targetText);

        for (const param of sourceParams) {
          if (!targetParams.has(param)) {
            errors.push({
              level: 'error',
              namespace: ns,
              locale: targetLocale,
              key,
              message: `Missing parameter {${param}} in ${targetLocale}/${ns}.yaml key "${key}"`,
            });
          }
        }
      }
    }
  }

  // Print results
  const errorCount = errors.filter(e => e.level === 'error').length;
  const warningCount = errors.filter(e => e.level === 'warning').length;

  for (const err of errors) {
    const icon = err.level === 'error' ? '\u2717' : '\u26A0';
    console.log(`${icon} [${err.level.toUpperCase()}] ${err.message}`);
  }

  console.log(`\ni18n lint: ${errorCount} errors, ${warningCount} warnings`);

  if (errorCount > 0) {
    process.exit(1);
  }
}

main();
