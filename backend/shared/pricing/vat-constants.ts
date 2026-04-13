export type VATStatus = 'NONE' | 'EXEMPT_FRANCHISE' | 'VAT_REGISTERED';

/** New accounts default to EXEMPT_FRANCHISE (Belgian small enterprise threshold) */
export const VAT_STATUS_DEFAULT: VATStatus = 'EXEMPT_FRANCHISE';

export const BELGIAN_SMALL_ENTERPRISE_THRESHOLD_EUR = 25_000;

/** Belgian standard VAT rate (21%) — applied to parking rentals */
export const BELGIAN_STANDARD_VAT_RATE = 0.21;

/** Spotzy's own VAT rate on its platform fee (always 21%, Spotzy is VAT-registered) */
export const SPOTZY_VAT_RATE = 0.21;

/** Belgian VAT number format: BE0 followed by exactly 9 digits */
export const VAT_NUMBER_REGEX_BE = /^BE0\d{9}$/;

export const PRICE_DISPLAY_DECIMAL_PLACES = 2;
export const PRICE_DISPLAY_CURRENCY = 'EUR';
