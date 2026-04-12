import { describe, test, expect } from 'vitest';
import { resolveLocale } from '../../../../lib/locales/resolve-locale';

describe('resolveLocale (frontend)', () => {
  test('URL prefix wins over all other signals', () => {
    expect(
      resolveLocale({
        urlPathPrefix: 'fr-BE',
        userProfileLocale: 'nl-BE',
        localeCookie: 'en',
        acceptLanguageHeader: 'de',
      }),
    ).toEqual({ locale: 'fr-BE', source: 'url' });
  });

  test('profile wins over cookie and Accept-Language', () => {
    expect(
      resolveLocale({ userProfileLocale: 'nl-BE', localeCookie: 'en' }),
    ).toEqual({ locale: 'nl-BE', source: 'profile' });
  });

  test('cookie wins over Accept-Language', () => {
    expect(
      resolveLocale({ localeCookie: 'en', acceptLanguageHeader: 'fr;q=0.9' }),
    ).toEqual({ locale: 'en', source: 'cookie' });
  });

  test('Accept-Language family match: "fr" → "fr-BE"', () => {
    expect(
      resolveLocale({ acceptLanguageHeader: 'fr;q=0.9' }),
    ).toEqual({ locale: 'fr-BE', source: 'accept_language' });
  });

  test('no inputs → fr-BE fallback', () => {
    expect(resolveLocale({})).toEqual({ locale: 'fr-BE', source: 'fallback' });
  });
});
