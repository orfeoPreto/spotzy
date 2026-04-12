/**
 * Converts a backend error response into a human-readable localized string.
 *
 * For now, looks up error codes from the en/errors.yaml translations loaded
 * at build time. When next-intl is fully wired, this will use useTranslations.
 *
 * Fallback: returns the raw error code if no translation is found.
 */
export interface ApiErrorResponse {
  error: string;
  details?: Record<string, unknown>;
}

// Simple lookup from the English errors.yaml (loaded by the yaml-loader at runtime)
// This is a placeholder until next-intl translations are populated.
// Components can import and use this to display localized error messages.
let _errorMessages: Record<string, string> | null = null;

async function loadErrorMessages(): Promise<Record<string, string>> {
  if (_errorMessages) return _errorMessages;
  try {
    const yaml = await import('yaml');
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.join(process.cwd(), 'src/locales/en/errors.yaml');
    const content = fs.readFileSync(filePath, 'utf-8');
    _errorMessages = yaml.parse(content) as Record<string, string>;
    return _errorMessages;
  } catch {
    _errorMessages = {};
    return _errorMessages;
  }
}

/**
 * Client-side error localizer. For use in client components.
 * Looks up the error code and interpolates details into the message.
 */
export function localizeError(response: ApiErrorResponse): string {
  // For now, return a simple formatted string
  // Full i18n integration comes when next-intl useTranslations is wired
  const code = response.error;
  const details = response.details;

  // Basic interpolation of details into a readable fallback
  if (details && Object.keys(details).length > 0) {
    const detailStr = Object.entries(details)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    return `${code} (${detailStr})`;
  }

  return code;
}
