import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from './constants';
import type { SupportedLocale } from './constants';
import type { LocaleResolutionInput, LocaleResolutionResult } from './types';

/**
 * Resolves the active locale using the 5-priority algorithm (spec §2.2):
 *
 * 1. URL path prefix    (always wins if present and supported)
 * 2. User profile       (if authenticated)
 * 3. Locale cookie      (if set)
 * 4. Accept-Language    (parsed by quality value)
 * 5. Fallback           (DEFAULT_LOCALE = fr-BE)
 */
export function resolveLocale(input: LocaleResolutionInput): LocaleResolutionResult {
  if (input.urlPathPrefix && isSupported(input.urlPathPrefix)) {
    return { locale: input.urlPathPrefix as SupportedLocale, source: 'url' };
  }

  if (input.userProfileLocale && isSupported(input.userProfileLocale)) {
    return { locale: input.userProfileLocale as SupportedLocale, source: 'profile' };
  }

  if (input.localeCookie && isSupported(input.localeCookie)) {
    return { locale: input.localeCookie as SupportedLocale, source: 'cookie' };
  }

  if (input.acceptLanguageHeader) {
    const fromHeader = matchAcceptLanguage(input.acceptLanguageHeader);
    if (fromHeader) {
      return { locale: fromHeader, source: 'accept_language' };
    }
  }

  return { locale: DEFAULT_LOCALE, source: 'fallback' };
}

function isSupported(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Parses an Accept-Language header and returns the best supported locale match.
 *   "fr;q=0.9,en;q=0.8" → "fr-BE"
 *   "de;q=0.9,en;q=0.8" → "en"
 *   "pt-BR" → null
 */
function matchAcceptLanguage(header: string): SupportedLocale | null {
  const entries = header
    .split(',')
    .map((entry) => {
      const [lang, ...params] = entry.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1.0;
      return { lang: lang.trim().toLowerCase(), q };
    })
    .sort((a, b) => b.q - a.q);

  for (const entry of entries) {
    // Exact match: "fr-be" → "fr-BE"
    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === entry.lang);
    if (exact) return exact;

    // Language family match: "fr" → "fr-BE", "nl" → "nl-BE", "en" → "en"
    const familyMatch =
      SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(entry.lang + '-')) ??
      SUPPORTED_LOCALES.find((l) => l.toLowerCase() === entry.lang);
    if (familyMatch) return familyMatch;
  }

  return null;
}
