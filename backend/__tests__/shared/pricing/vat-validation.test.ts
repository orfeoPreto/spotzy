import { validateBelgianVATNumber } from '../../../shared/pricing/validation';

describe('validateBelgianVATNumber', () => {
  test('valid number: BE0123456749', () => {
    // base = 0123456 = 123456, check = 49, 97 - (123456 % 97) = 97 - 48 = 49
    expect(validateBelgianVATNumber('BE0123456749')).toEqual({ valid: true });
  });

  test('valid number: BE0000000097', () => {
    // base = 0000000 = 0, check = 97, 97 - (0 % 97) = 97
    expect(validateBelgianVATNumber('BE0000000097')).toEqual({ valid: true });
  });

  test('invalid format: missing BE prefix', () => {
    expect(validateBelgianVATNumber('0123456749')).toEqual({
      valid: false,
      error: 'VAT_NUMBER_INVALID_FORMAT',
    });
  });

  test('invalid format: too short', () => {
    expect(validateBelgianVATNumber('BE012345')).toEqual({
      valid: false,
      error: 'VAT_NUMBER_INVALID_FORMAT',
    });
  });

  test('invalid format: too long', () => {
    expect(validateBelgianVATNumber('BE01234567890')).toEqual({
      valid: false,
      error: 'VAT_NUMBER_INVALID_FORMAT',
    });
  });

  test('invalid format: letters in digits', () => {
    expect(validateBelgianVATNumber('BE0123ABC749')).toEqual({
      valid: false,
      error: 'VAT_NUMBER_INVALID_FORMAT',
    });
  });

  test('invalid format: does not start with BE0', () => {
    expect(validateBelgianVATNumber('BE1234567890')).toEqual({
      valid: false,
      error: 'VAT_NUMBER_INVALID_FORMAT',
    });
  });

  test('invalid checksum: one digit off', () => {
    // Valid is BE0123456749, change last digit
    expect(validateBelgianVATNumber('BE0123456748')).toEqual({
      valid: false,
      error: 'VAT_NUMBER_INVALID_CHECKSUM',
    });
  });

  test('invalid checksum: transposed digits', () => {
    expect(validateBelgianVATNumber('BE0123465749')).toEqual({
      valid: false,
      error: 'VAT_NUMBER_INVALID_CHECKSUM',
    });
  });
});
