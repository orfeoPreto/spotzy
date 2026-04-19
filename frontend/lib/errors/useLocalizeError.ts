'use client';

import { useTranslation } from '../locales/TranslationProvider';

/**
 * Client-side hook that translates API error codes into user-friendly messages.
 * Looks up error codes from the `errors` translation namespace (errors.yaml).
 * Falls back to the raw code if no translation is found.
 */
export function useLocalizeError() {
  const { t } = useTranslation('errors');

  return (errorResponse: { error?: string; message?: string; details?: Record<string, unknown> } | null | undefined): string => {
    if (!errorResponse) return '';

    const code = errorResponse.error;
    if (!code) return errorResponse.message ?? '';

    // Look up the code in the errors translation namespace
    const translated = t(code, (errorResponse.details ?? {}) as Record<string, string>);

    // If the translation system returned the raw key (no translation found),
    // fall back to the message field or a generic error
    if (translated === code) {
      return errorResponse.message ?? code;
    }

    return translated;
  };
}
