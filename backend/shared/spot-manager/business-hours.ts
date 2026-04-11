import { BUSINESS_DAY_START_HOUR, BUSINESS_DAY_END_HOUR, BUSINESS_TIMEZONE } from './constants';

export const BELGIAN_PUBLIC_HOLIDAYS_2026: string[] = [
  '2026-01-01', // New Year's Day
  '2026-04-06', // Easter Monday
  '2026-05-01', // Labour Day
  '2026-05-14', // Ascension Day
  '2026-05-25', // Whit Monday
  '2026-07-21', // Belgian National Day
  '2026-08-15', // Assumption
  '2026-11-01', // All Saints' Day
  '2026-11-11', // Armistice Day
  '2026-12-25', // Christmas
];

export const BELGIAN_PUBLIC_HOLIDAYS_2027: string[] = [
  '2027-01-01',
  '2027-03-29',
  '2027-05-01',
  '2027-05-06',
  '2027-05-17',
  '2027-07-21',
  '2027-08-15',
  '2027-11-01',
  '2027-11-11',
  '2027-12-25',
];

export const BELGIAN_PUBLIC_HOLIDAYS = new Set([
  ...BELGIAN_PUBLIC_HOLIDAYS_2026,
  ...BELGIAN_PUBLIC_HOLIDAYS_2027,
]);

const HOURS_PER_BUSINESS_DAY = BUSINESS_DAY_END_HOUR - BUSINESS_DAY_START_HOUR; // 8

function toBrusselsDate(iso: string): Date {
  // Convert ISO string to a Date object, then extract Brussels local components
  const d = new Date(iso);
  // Use Intl to get Brussels components
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)!.value, 10);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') } as any;
}

interface BrusselsTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getBrusselsTime(iso: string): BrusselsTime {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)!.value, 10);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function getBrusselsDateString(iso: string): string {
  const bt = getBrusselsTime(iso);
  const m = String(bt.month).padStart(2, '0');
  const d = String(bt.day).padStart(2, '0');
  return `${bt.year}-${m}-${d}`;
}

function getDayOfWeek(iso: string): number {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    weekday: 'short',
  });
  const weekday = fmt.format(d);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  return map[weekday] ?? 0;
}

function isWeekday(iso: string): boolean {
  const dow = getDayOfWeek(iso);
  return dow >= 1 && dow <= 5;
}

export function isBelgianPublicHoliday(isoDate: string): boolean {
  return BELGIAN_PUBLIC_HOLIDAYS.has(isoDate);
}

function isBusinessDay(iso: string): boolean {
  const dateStr = getBrusselsDateString(iso);
  return isWeekday(iso) && !isBelgianPublicHoliday(dateStr);
}

export function isBusinessHour(iso: string): boolean {
  if (!isBusinessDay(iso)) return false;
  const bt = getBrusselsTime(iso);
  return bt.hour >= BUSINESS_DAY_START_HOUR && bt.hour < BUSINESS_DAY_END_HOUR;
}

export function businessHoursBetween(startIso: string, endIso: string): number {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (endMs <= startMs) return 0;

  let totalHours = 0;
  // Walk hour by hour
  let currentMs = startMs;

  while (currentMs < endMs) {
    const currentIso = new Date(currentMs).toISOString();
    const bt = getBrusselsTime(currentIso);

    if (!isBusinessDay(currentIso)) {
      // Skip to next day 00:00 Brussels
      currentMs += 3600_000;
      continue;
    }

    if (bt.hour < BUSINESS_DAY_START_HOUR) {
      // Skip to start of business
      const skipHours = BUSINESS_DAY_START_HOUR - bt.hour;
      currentMs += skipHours * 3600_000;
      continue;
    }

    if (bt.hour >= BUSINESS_DAY_END_HOUR) {
      // Skip to next day
      currentMs += 3600_000;
      continue;
    }

    // We're in a business hour — count it
    const nextHourMs = currentMs + 3600_000;
    if (nextHourMs <= endMs) {
      totalHours += 1;
    } else {
      // Partial hour at end — count as fraction but spec uses whole hours
      const fraction = (endMs - currentMs) / 3600_000;
      totalHours += fraction;
    }
    currentMs = nextHourMs;
  }

  return Math.floor(totalHours);
}

export function addBusinessHours(startIso: string, hours: number): string {
  let remainingHours = hours;
  let currentMs = new Date(startIso).getTime();

  while (remainingHours > 0) {
    const currentIso = new Date(currentMs).toISOString();
    const bt = getBrusselsTime(currentIso);

    if (!isBusinessDay(currentIso)) {
      currentMs += 3600_000;
      continue;
    }

    if (bt.hour < BUSINESS_DAY_START_HOUR) {
      const skipHours = BUSINESS_DAY_START_HOUR - bt.hour;
      currentMs += skipHours * 3600_000;
      continue;
    }

    if (bt.hour >= BUSINESS_DAY_END_HOUR) {
      currentMs += 3600_000;
      continue;
    }

    // In a business hour — consume it
    remainingHours -= 1;
    currentMs += 3600_000;
    if (remainingHours <= 0) {
      break;
    }
  }

  return new Date(currentMs).toISOString();
}
