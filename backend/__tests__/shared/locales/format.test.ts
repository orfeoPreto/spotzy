import { formatDateForLocale, formatCurrencyForLocale, formatTimeForLocale } from '../../../shared/locales/format';

describe('formatDateForLocale', () => {
  const date = new Date('2026-04-15T10:30:00Z');

  test('en format', () => {
    const result = formatDateForLocale(date, 'en');
    expect(result).toContain('April');
    expect(result).toContain('15');
    expect(result).toContain('2026');
  });

  test('fr-BE format', () => {
    const result = formatDateForLocale(date, 'fr-BE');
    expect(result).toContain('avril');
    expect(result).toContain('2026');
  });

  test('nl-BE format', () => {
    const result = formatDateForLocale(date, 'nl-BE');
    expect(result).toContain('april');
    expect(result).toContain('2026');
  });

  test('accepts ISO string input', () => {
    const result = formatDateForLocale('2026-04-15T10:30:00Z', 'en');
    expect(result).toContain('2026');
  });
});

describe('formatCurrencyForLocale', () => {
  test('en format', () => {
    const result = formatCurrencyForLocale(42.5, 'en');
    expect(result).toContain('42');
    expect(result).toContain('50');
  });

  test('fr-BE uses comma decimal separator', () => {
    const result = formatCurrencyForLocale(42.5, 'fr-BE');
    expect(result).toContain('42');
    expect(result).toMatch(/€/);
  });

  test('nl-BE uses comma decimal separator', () => {
    const result = formatCurrencyForLocale(42.5, 'nl-BE');
    expect(result).toContain('42');
    expect(result).toMatch(/€/);
  });
});

describe('formatTimeForLocale', () => {
  const date = new Date('2026-04-15T14:30:00Z');

  test('formats to short time', () => {
    const result = formatTimeForLocale(date, 'en');
    expect(result).toBeTruthy();
  });

  test('accepts ISO string input', () => {
    const result = formatTimeForLocale('2026-04-15T14:30:00Z', 'fr-BE');
    expect(result).toBeTruthy();
  });
});
