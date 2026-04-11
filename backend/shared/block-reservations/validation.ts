import {
  MAX_WINDOW_DAYS,
  MIN_LEAD_TIME_HOURS,
  MIN_BAY_COUNT,
  MAX_BAY_COUNT,
} from './constants';

export function validateWindow(
  startsAt: string,
  endsAt: string,
  now: Date
): { valid: boolean; error?: string } {
  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(endsAt).getTime();

  if (endMs <= startMs) {
    return { valid: false, error: 'WINDOW_TOO_SHORT' };
  }

  const minStartMs = now.getTime() + MIN_LEAD_TIME_HOURS * 3600_000;
  if (startMs < minStartMs) {
    return { valid: false, error: 'INSUFFICIENT_LEAD_TIME' };
  }

  const maxWindowMs = MAX_WINDOW_DAYS * 24 * 3600_000;
  if (endMs - startMs > maxWindowMs) {
    return { valid: false, error: 'WINDOW_EXCEEDS_7_DAYS' };
  }

  return { valid: true };
}

export function validateBayCount(bayCount: number): { valid: boolean; error?: string } {
  if (bayCount < MIN_BAY_COUNT) {
    return { valid: false, error: 'BAY_COUNT_TOO_LOW' };
  }
  if (bayCount > MAX_BAY_COUNT) {
    return { valid: false, error: 'BAY_COUNT_TOO_HIGH' };
  }
  return { valid: true };
}

export function validateBelgianVAT(vatNumber: string): { valid: boolean; error?: string } {
  if (!/^BE0\d{9}$/.test(vatNumber)) {
    return { valid: false, error: 'INVALID_VAT_NUMBER' };
  }
  return { valid: true };
}

export function validateGuestEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateGuestPhone(phone: string): boolean {
  return /^\+?\d{8,15}$/.test(phone);
}

export function validateGuestRow(row: {
  name: string;
  email: string;
  phone: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!row.name || row.name.trim().length === 0) {
    errors.push('GUEST_NAME_REQUIRED');
  }
  if (row.name && row.name.trim().length > 200) {
    errors.push('GUEST_NAME_TOO_LONG');
  }
  if (!validateGuestEmail(row.email)) {
    errors.push('INVALID_GUEST_EMAIL');
  }
  if (!validateGuestPhone(row.phone)) {
    errors.push('INVALID_GUEST_PHONE');
  }

  return { valid: errors.length === 0, errors };
}
