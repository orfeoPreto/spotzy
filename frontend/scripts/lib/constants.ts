export const SUPPORTED_LOCALES = ['en', 'fr-BE', 'nl-BE'] as const;
export const SOURCE_LOCALE = 'en';
export const TARGET_LOCALES = ['fr-BE', 'nl-BE'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALES_DIR = 'src/locales';
export const LEGAL_DOCS_DIR = 'public/legal';
export const GLOSSARY_FILE = 'src/locales/_glossary.yaml';

export const NAMESPACES = [
  'common', 'auth', 'listings', 'pricing', 'availability', 'search',
  'booking', 'chat', 'reviews', 'disputes', 'profile', 'payments',
  'dashboard', 'notifications', 'gdpr', 'spot_manager', 'block_spotter',
  'magic_link', 'errors', 'validation', 'time_date', 'landing', 'footer',
  'vat_settings',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const CLAUDE_MODEL_SONNET = 'claude-sonnet-4-6';
export const CLAUDE_MODEL_OPUS = 'claude-opus-4-6';
export const CLAUDE_API_DELAY_MS = 100;
export const CLAUDE_MAX_RETRIES = 3;

export const LEGAL_DOCUMENTS = [
  'terms-of-service',
  'privacy-policy',
  'cookie-policy',
  'spot-manager-tcs',
  'block-spotter-tcs',
] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];
