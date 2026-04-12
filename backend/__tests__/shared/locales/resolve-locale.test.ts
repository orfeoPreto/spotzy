import { resolveLocale } from '../../../shared/locales/resolve-locale';

describe('resolveLocale', () => {
  describe('URL prefix wins (priority 1)', () => {
    test('URL fr-BE wins over everything else', () => {
      expect(
        resolveLocale({
          urlPathPrefix: 'fr-BE',
          userProfileLocale: 'nl-BE',
          localeCookie: 'en',
          acceptLanguageHeader: 'de',
        }),
      ).toEqual({ locale: 'fr-BE', source: 'url' });
    });

    test('invalid URL prefix falls through to next priority', () => {
      expect(
        resolveLocale({ urlPathPrefix: 'pt-BR', userProfileLocale: 'nl-BE' }),
      ).toEqual({ locale: 'nl-BE', source: 'profile' });
    });
  });

  describe('user profile (priority 2)', () => {
    test('profile locale wins over cookie and Accept-Language', () => {
      expect(
        resolveLocale({
          userProfileLocale: 'nl-BE',
          localeCookie: 'en',
          acceptLanguageHeader: 'fr;q=0.9',
        }),
      ).toEqual({ locale: 'nl-BE', source: 'profile' });
    });

    test('invalid profile locale falls through', () => {
      expect(
        resolveLocale({ userProfileLocale: 'pt-BR', localeCookie: 'en' }),
      ).toEqual({ locale: 'en', source: 'cookie' });
    });
  });

  describe('cookie (priority 3)', () => {
    test('cookie wins over Accept-Language', () => {
      expect(
        resolveLocale({ localeCookie: 'en', acceptLanguageHeader: 'fr;q=0.9' }),
      ).toEqual({ locale: 'en', source: 'cookie' });
    });
  });

  describe('Accept-Language (priority 4)', () => {
    test('exact match wins', () => {
      expect(
        resolveLocale({ acceptLanguageHeader: 'fr-BE,en;q=0.8' }),
      ).toEqual({ locale: 'fr-BE', source: 'accept_language' });
    });

    test('language family match: "fr" → "fr-BE"', () => {
      expect(
        resolveLocale({ acceptLanguageHeader: 'fr;q=0.9,en;q=0.8' }),
      ).toEqual({ locale: 'fr-BE', source: 'accept_language' });
    });

    test('language family match: "nl" → "nl-BE"', () => {
      expect(
        resolveLocale({ acceptLanguageHeader: 'nl;q=0.9' }),
      ).toEqual({ locale: 'nl-BE', source: 'accept_language' });
    });

    test('quality values respected: highest q wins', () => {
      expect(
        resolveLocale({ acceptLanguageHeader: 'en;q=0.5,fr;q=0.9' }),
      ).toEqual({ locale: 'fr-BE', source: 'accept_language' });
    });

    test('unsupported language: "de" → falls through to fallback', () => {
      expect(
        resolveLocale({ acceptLanguageHeader: 'de;q=0.9' }),
      ).toEqual({ locale: 'fr-BE', source: 'fallback' });
    });

    test('mixed supported and unsupported: picks highest-q supported', () => {
      expect(
        resolveLocale({ acceptLanguageHeader: 'de;q=0.95,nl;q=0.9' }),
      ).toEqual({ locale: 'nl-BE', source: 'accept_language' });
    });
  });

  describe('fallback (priority 5)', () => {
    test('no inputs → fr-BE fallback', () => {
      expect(resolveLocale({})).toEqual({ locale: 'fr-BE', source: 'fallback' });
    });

    test('all inputs invalid → fr-BE fallback', () => {
      expect(
        resolveLocale({
          urlPathPrefix: 'invalid',
          userProfileLocale: 'invalid',
          localeCookie: 'invalid',
          acceptLanguageHeader: 'pt;q=0.9',
        }),
      ).toEqual({ locale: 'fr-BE', source: 'fallback' });
    });
  });
});
