// Spotzy localization constants — shared across all backend Lambdas.
// The frontend has a hand-mirrored copy at frontend/lib/locales/constants.ts.
// A sync test ensures both files stay identical.

export const SUPPORTED_LOCALES = ['en', 'fr-BE', 'nl-BE'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Final fallback when no other signal resolves (Belgian French — primary market) */
export const DEFAULT_LOCALE: SupportedLocale = 'fr-BE';

/** Source locale for development — the canonical reference for translation files */
export const SOURCE_LOCALE: SupportedLocale = 'en';

/** Cookie name used by the frontend to persist locale preference */
export const LOCALE_COOKIE_NAME = 'spotzy_locale';
export const LOCALE_COOKIE_MAX_AGE_DAYS = 365;

/** HTTP header for diagnostic locale propagation (set by frontend, read by backend for logs) */
export const ACTIVE_LOCALE_HEADER = 'Spotzy-Active-Locale';

/** Translation cache TTL for read-time chat/review translations */
export const TRANSLATION_CACHE_TTL_DAYS = 30;
export const DISPUTE_TRANSLATION_CACHE_TTL_DAYS = 90;

/** Amazon Translate language code mapping (BCP 47 → ISO 639-1) */
export const TRANSLATE_LANGUAGE_CODE_MAP: Record<SupportedLocale, string> = {
  en: 'en',
  'fr-BE': 'fr',
  'nl-BE': 'nl',
};

/** EventBridge event type for listing translation triggers */
export const LISTING_TRANSLATION_EVENT_TYPE = 'listing.translation_required';
