import { vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

// Load all English YAML files into a flat message map for tests
function loadEnglishMessages(): Record<string, any> {
  const localeDir = join(process.cwd(), 'src/locales/en');
  const messages: Record<string, any> = {};
  try {
    const files = readdirSync(localeDir).filter(f => f.endsWith('.yaml'));
    for (const file of files) {
      const ns = file.replace('.yaml', '');
      const content = readFileSync(join(localeDir, file), 'utf-8');
      const parsed = parse(content);
      if (parsed && typeof parsed === 'object') {
        messages[ns] = parsed;
      }
    }
  } catch {
    // If locales dir doesn't exist, return empty
  }
  return messages;
}

const englishMessages = loadEnglishMessages();

function getNestedValue(obj: any, path: string): string | undefined {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

vi.mock('../lib/locales/TranslationProvider', () => ({
  useTranslation: (namespace?: string) => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      const value = getNestedValue(englishMessages, fullKey);
      if (value && params) {
        return value.replace(/\{(\w+)\}/g, (_: string, k: string) =>
          params[k] !== undefined ? String(params[k]) : `{${k}}`
        );
      }
      return value ?? key.split('.').pop() ?? key;
    },
    locale: 'en',
  }),
}));
