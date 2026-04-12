import type { SupportedLocale } from './constants';

export interface LocaleResolutionInput {
  urlPathPrefix?: string;
  userProfileLocale?: string;
  localeCookie?: string;
  acceptLanguageHeader?: string;
}

export interface LocaleResolutionResult {
  locale: SupportedLocale;
  source: 'url' | 'profile' | 'cookie' | 'accept_language' | 'fallback';
}

export interface TranslationCacheKey {
  sourceText: string;
  sourceLocale: SupportedLocale;
  targetLocale: SupportedLocale;
}
