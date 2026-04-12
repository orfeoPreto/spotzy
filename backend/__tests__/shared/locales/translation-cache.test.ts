import { buildCacheKey } from '../../../shared/locales/translation-cache';

describe('buildCacheKey', () => {
  test('is deterministic', () => {
    const a = buildCacheKey('hello', 'en', 'fr-BE');
    const b = buildCacheKey('hello', 'en', 'fr-BE');
    expect(a).toBe(b);
  });

  test('different source text → different hash', () => {
    const a = buildCacheKey('hello', 'en', 'fr-BE');
    const b = buildCacheKey('goodbye', 'en', 'fr-BE');
    expect(a).not.toBe(b);
  });

  test('different source locale → different hash', () => {
    const a = buildCacheKey('hello', 'en', 'fr-BE');
    const b = buildCacheKey('hello', 'fr-BE', 'fr-BE');
    expect(a).not.toBe(b);
  });

  test('different target locale → different hash', () => {
    const a = buildCacheKey('hello', 'en', 'fr-BE');
    const b = buildCacheKey('hello', 'en', 'nl-BE');
    expect(a).not.toBe(b);
  });

  test('returns a 64-char hex string (sha256)', () => {
    const key = buildCacheKey('hello', 'en', 'fr-BE');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });
});
