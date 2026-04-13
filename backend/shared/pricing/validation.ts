import { VAT_NUMBER_REGEX_BE } from './vat-constants';

export interface VATValidationResult {
  valid: boolean;
  error?: 'VAT_NUMBER_INVALID_FORMAT' | 'VAT_NUMBER_INVALID_CHECKSUM';
}

/**
 * Validates a Belgian VAT number using format check + Mod-97 checksum.
 *
 * Belgian VAT numbers are "BE0" + 9 digits. The first 7 digits form a base,
 * and the last 2 digits are a check: 97 - (base mod 97) == check.
 *
 * Example: BE0123456749
 *   base = 0123456  (first 7 digits after BE)
 *   check = 49
 *   97 - (123456 % 97) = 97 - 48 = 49 ✓
 */
export function validateBelgianVATNumber(vatNumber: string): VATValidationResult {
  if (!VAT_NUMBER_REGEX_BE.test(vatNumber)) {
    return { valid: false, error: 'VAT_NUMBER_INVALID_FORMAT' };
  }

  // Extract the 10 digits after "BE": "0XXXXXXXXX"
  // Mod-97 check: 97 - (first 8 digits % 97) == last 2 digits
  const digits = vatNumber.slice(2);
  const base = parseInt(digits.slice(0, 8), 10);
  const check = parseInt(digits.slice(8, 10), 10);

  const expected = 97 - (base % 97);
  if (check !== expected) {
    return { valid: false, error: 'VAT_NUMBER_INVALID_CHECKSUM' };
  }

  return { valid: true };
}
