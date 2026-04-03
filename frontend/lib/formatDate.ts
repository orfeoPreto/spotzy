const TZ = 'Europe/Brussels';

/** Ensure bare datetime strings (no timezone) are treated as UTC */
function toUTC(iso: string): Date {
  if (/[Zz]|[+-]\d{2}:\d{2}$/.test(iso)) return new Date(iso);
  return new Date(iso + 'Z');
}

export function formatDateTime(iso: string): string {
  if (!iso) return '';
  const d = toUTC(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ })
    + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function formatDateTimeShort(iso: string): string {
  if (!iso) return '';
  const d = toUTC(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function formatDateOnly(iso: string): string {
  if (!iso) return '';
  return toUTC(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: TZ });
}
