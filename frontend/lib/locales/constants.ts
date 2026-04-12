// Spotzy localization constants — frontend mirror of backend/shared/locales/constants.ts.
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
