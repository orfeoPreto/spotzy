import {
  validateWindow,
  validateBayCount,
  validateBelgianVAT,
  validateGuestEmail,
  validateGuestPhone,
  validateGuestRow,
} from '../../../shared/block-reservations/validation';

describe('validateWindow', () => {
  const now = new Date('2026-04-10T12:00:00Z');

  test('valid window 3 days from now lasting 5 days', () => {
    const result = validateWindow('2026-04-13T09:00:00Z', '2026-04-18T18:00:00Z', now);
    expect(result.valid).toBe(true);
  });

  test('rejects endsAt before startsAt', () => {
    const result = validateWindow('2026-04-18T09:00:00Z', '2026-04-13T18:00:00Z', now);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('WINDOW_TOO_SHORT');
  });

  test('rejects startsAt less than 24h in the future', () => {
    const result = validateWindow('2026-04-10T20:00:00Z', '2026-04-12T20:00:00Z', now);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_LEAD_TIME');
  });

  test('rejects window exceeding 7 days', () => {
    const result = validateWindow('2026-04-15T00:00:00Z', '2026-04-23T00:00:00Z', now);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('WINDOW_EXCEEDS_7_DAYS');
  });

  test('accepts exactly 7-day window', () => {
    const result = validateWindow('2026-04-15T00:00:00Z', '2026-04-22T00:00:00Z', now);
    expect(result.valid).toBe(true);
  });
});

describe('validateBayCount', () => {
  test('accepts 2 bays', () => {
    expect(validateBayCount(2).valid).toBe(true);
  });
  test('rejects 1 bay', () => {
    expect(validateBayCount(1).error).toBe('BAY_COUNT_TOO_LOW');
  });
  test('accepts 500 bays', () => {
    expect(validateBayCount(500).valid).toBe(true);
  });
  test('rejects 501 bays', () => {
    expect(validateBayCount(501).error).toBe('BAY_COUNT_TOO_HIGH');
  });
});

describe('validateBelgianVAT', () => {
  test('accepts valid Belgian VAT', () => {
    expect(validateBelgianVAT('BE0123456789').valid).toBe(true);
  });
  test('rejects missing BE prefix', () => {
    expect(validateBelgianVAT('0123456789').valid).toBe(false);
  });
  test('rejects too few digits', () => {
    expect(validateBelgianVAT('BE012345678').valid).toBe(false);
  });
  test('rejects letters in number', () => {
    expect(validateBelgianVAT('BE0ABCDEFGHI').valid).toBe(false);
  });
});

describe('validateGuestEmail', () => {
  test('accepts standard email', () => {
    expect(validateGuestEmail('jane.doe@example.com')).toBe(true);
  });
  test('rejects missing @', () => {
    expect(validateGuestEmail('jane.doe.example.com')).toBe(false);
  });
});

describe('validateGuestPhone', () => {
  test('accepts E.164 format', () => {
    expect(validateGuestPhone('+32475123456')).toBe(true);
  });
  test('accepts no plus', () => {
    expect(validateGuestPhone('32475123456')).toBe(true);
  });
  test('rejects too short', () => {
    expect(validateGuestPhone('1234')).toBe(false);
  });
});

describe('validateGuestRow', () => {
  test('valid row passes', () => {
    const result = validateGuestRow({ name: 'Alice', email: 'alice@test.com', phone: '+32475111222' });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('invalid email is caught', () => {
    const result = validateGuestRow({ name: 'Alice', email: 'not-email', phone: '+32475111222' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('INVALID_GUEST_EMAIL');
  });

  test('empty name is caught', () => {
    const result = validateGuestRow({ name: '', email: 'a@b.com', phone: '+32475111222' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('GUEST_NAME_REQUIRED');
  });
});
