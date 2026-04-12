import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('frontend/backend locale constants are in sync', () => {
  test('SUPPORTED_LOCALES, DEFAULT_LOCALE, SOURCE_LOCALE, LOCALE_COOKIE_NAME match', () => {
    const backendPath = join(__dirname, '../../../../../backend/shared/locales/constants.ts');
    const frontendPath = join(__dirname, '../../../../lib/locales/constants.ts');

    const backend = readFileSync(backendPath, 'utf-8');
    const frontend = readFileSync(frontendPath, 'utf-8');

    const extract = (source: string, name: string) => {
      const match = source.match(new RegExp(`export const ${name}\\s*[=:]\\s*([^;]+);`));
      return match?.[1].trim();
    };

    for (const constant of [
      'SUPPORTED_LOCALES',
      'DEFAULT_LOCALE',
      'SOURCE_LOCALE',
      'LOCALE_COOKIE_NAME',
      'LOCALE_COOKIE_MAX_AGE_DAYS',
      'ACTIVE_LOCALE_HEADER',
    ]) {
      expect(extract(frontend, constant)).toBe(extract(backend, constant));
    }
  });
});
