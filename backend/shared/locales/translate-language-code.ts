import { TRANSLATE_LANGUAGE_CODE_MAP } from './constants';
import type { SupportedLocale } from './constants';

/** Converts a Spotzy locale (BCP 47) to the ISO 639-1 code Amazon Translate expects. */
export function toTranslateLanguageCode(locale: SupportedLocale): string {
  return TRANSLATE_LANGUAGE_CODE_MAP[locale];
}
