import { toTranslateLanguageCode } from '../../../shared/locales/translate-language-code';

describe('toTranslateLanguageCode', () => {
  test('en → en', () => {
    expect(toTranslateLanguageCode('en')).toBe('en');
  });

  test('fr-BE → fr', () => {
    expect(toTranslateLanguageCode('fr-BE')).toBe('fr');
  });

  test('nl-BE → nl', () => {
    expect(toTranslateLanguageCode('nl-BE')).toBe('nl');
  });
});
