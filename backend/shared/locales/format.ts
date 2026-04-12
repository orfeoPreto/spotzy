import type { SupportedLocale } from './constants';

export function formatDateForLocale(date: Date | string, locale: SupportedLocale): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(d);
}

export function formatCurrencyForLocale(amount: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(amount);
}

export function formatTimeForLocale(date: Date | string, locale: SupportedLocale): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(d);
}
