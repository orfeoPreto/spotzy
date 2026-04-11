import {
  validateInsurer,
  validatePolicyNumber,
  validateExpiryDate,
  validateRCDocument,
  validateChecklistAcceptance,
  validateBayCount,
  generateBayLabel,
} from '../../../shared/spot-manager/validation';

describe('validateInsurer', () => {
  test('accepts AXA Belgium', () => expect(validateInsurer('AXA Belgium')).toBe(true));
  test('accepts Ethias', () => expect(validateInsurer('Ethias')).toBe(true));
  test('accepts the Other option', () => expect(validateInsurer('Other (please specify in policy number field)')).toBe(true));
  test('rejects unknown insurer', () => expect(validateInsurer('Acme Insurance')).toBe(false));
});

describe('validatePolicyNumber', () => {
  test('accepts standard policy number', () => expect(validatePolicyNumber('POL-12345').valid).toBe(true));
  test('rejects empty', () => expect(validatePolicyNumber('').error).toBe('POLICY_NUMBER_REQUIRED'));
  test('rejects too long', () => expect(validatePolicyNumber('x'.repeat(101)).error).toBe('POLICY_NUMBER_TOO_LONG'));
});

describe('validateExpiryDate', () => {
  const now = new Date('2026-04-10T12:00:00Z');

  test('accepts date 60 days in the future', () => {
    expect(validateExpiryDate('2026-06-09', now).valid).toBe(true);
  });

  test('warns on date 20 days in the future', () => {
    const result = validateExpiryDate('2026-04-30', now);
    expect(result.valid).toBe(true);
    expect(result.warning).toBe('POLICY_NEAR_EXPIRY');
  });

  test('rejects date in the past', () => {
    expect(validateExpiryDate('2026-04-05', now).error).toBe('EXPIRY_DATE_IN_PAST');
  });

  test('rejects malformed date', () => {
    expect(validateExpiryDate('not-a-date', now).error).toBe('INVALID_DATE_FORMAT');
  });
});

describe('validateRCDocument', () => {
  test('accepts PDF under 10MB', () => {
    expect(validateRCDocument('application/pdf', 5 * 1024 * 1024).valid).toBe(true);
  });
  test('accepts JPEG', () => {
    expect(validateRCDocument('image/jpeg', 1024).valid).toBe(true);
  });
  test('rejects EXE', () => {
    expect(validateRCDocument('application/octet-stream', 1024).error).toBe('INVALID_MIME_TYPE');
  });
  test('rejects file over 10MB', () => {
    expect(validateRCDocument('application/pdf', 11 * 1024 * 1024).error).toBe('FILE_TOO_LARGE');
  });
  test('rejects empty file', () => {
    expect(validateRCDocument('application/pdf', 0).error).toBe('EMPTY_FILE');
  });
});

describe('validateChecklistAcceptance', () => {
  test('accepts when all four checked', () => {
    const checklist = {
      reliableAccess: true,
      stableInstructions: true,
      chatResponseCommitment: true,
      suspensionAcknowledged: true,
    };
    expect(validateChecklistAcceptance(checklist).valid).toBe(true);
  });

  test('rejects when one box is unchecked', () => {
    const checklist = {
      reliableAccess: true,
      stableInstructions: false,
      chatResponseCommitment: true,
      suspensionAcknowledged: true,
    };
    expect(validateChecklistAcceptance(checklist).error).toBe('CHECKLIST_INCOMPLETE');
  });
});

describe('validateBayCount', () => {
  test('accepts 2', () => expect(validateBayCount(2).valid).toBe(true));
  test('rejects 1', () => expect(validateBayCount(1).error).toBe('BAY_COUNT_TOO_LOW'));
  test('accepts 200', () => expect(validateBayCount(200).valid).toBe(true));
  test('rejects 201', () => expect(validateBayCount(201).error).toBe('BAY_COUNT_TOO_HIGH'));
  test('rejects 2.5', () => expect(validateBayCount(2.5).error).toBe('BAY_COUNT_NOT_INTEGER'));
});

describe('generateBayLabel', () => {
  test('index 0 → "Bay 1"', () => expect(generateBayLabel(0)).toBe('Bay 1'));
  test('index 4 → "Bay 5"', () => expect(generateBayLabel(4)).toBe('Bay 5'));
});
