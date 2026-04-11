import {
  businessHoursBetween,
  isBusinessHour,
  isBelgianPublicHoliday,
  addBusinessHours,
} from '../../../shared/spot-manager/business-hours';

describe('isBusinessHour', () => {
  test('Tuesday 10:00 Brussels → true', () => {
    expect(isBusinessHour('2026-04-14T08:00:00Z')).toBe(true);  // 10:00 CEST
  });

  test('Saturday 10:00 Brussels → false', () => {
    expect(isBusinessHour('2026-04-11T08:00:00Z')).toBe(false);
  });

  test('Tuesday 06:00 Brussels (before 09:00) → false', () => {
    expect(isBusinessHour('2026-04-14T04:00:00Z')).toBe(false);  // 06:00 CEST
  });

  test('Tuesday 18:00 Brussels (after 17:00) → false', () => {
    expect(isBusinessHour('2026-04-14T16:00:00Z')).toBe(false);  // 18:00 CEST
  });

  test('Belgian public holiday Monday → false even at 10:00', () => {
    expect(isBusinessHour('2026-04-06T08:00:00Z')).toBe(false);  // Easter Monday 2026
  });
});

describe('isBelgianPublicHoliday', () => {
  test('2026-04-06 (Easter Monday) is a holiday', () => {
    expect(isBelgianPublicHoliday('2026-04-06')).toBe(true);
  });

  test('2026-04-07 is not a holiday', () => {
    expect(isBelgianPublicHoliday('2026-04-07')).toBe(false);
  });
});

describe('businessHoursBetween', () => {
  test('Tuesday 10:00 to Tuesday 16:00 same day → 6 business hours', () => {
    const start = '2026-04-14T08:00:00Z';  // 10:00 CEST
    const end = '2026-04-14T14:00:00Z';    // 16:00 CEST
    expect(businessHoursBetween(start, end)).toBe(6);
  });

  test('Friday 16:00 to Monday 10:00 → 2 business hours (1 Friday + 1 Monday)', () => {
    const start = '2026-04-17T14:00:00Z';  // Fri 16:00 CEST
    const end = '2026-04-20T08:00:00Z';    // Mon 10:00 CEST
    expect(businessHoursBetween(start, end)).toBe(2);
  });

  test('Submission Friday 16:00 to Wednesday 10:00 → 18 business hours', () => {
    const start = '2026-04-17T14:00:00Z';  // Fri 16:00 CEST
    const end = '2026-04-22T08:00:00Z';    // Wed 10:00 CEST
    expect(businessHoursBetween(start, end)).toBe(18);
  });

  test('skips Belgian public holidays', () => {
    const start = '2026-04-05T08:00:00Z';  // Sun 10:00 CEST
    const end = '2026-04-07T14:00:00Z';    // Tue 16:00 CEST
    // Sunday: 0h, Monday April 6: holiday 0h, Tuesday: 09:00 → 16:00 = 7h
    expect(businessHoursBetween(start, end)).toBe(7);
  });
});

describe('addBusinessHours', () => {
  test('Mon 10:00 + 8 business hours = Tue 10:00', () => {
    const start = '2026-04-13T08:00:00Z';   // Mon 10:00 CEST
    const result = addBusinessHours(start, 8);
    expect(result).toBe('2026-04-14T08:00:00.000Z');
  });

  test('Mon 10:00 + 72 business hours = Fri Apr 24 10:00', () => {
    const start = '2026-04-13T08:00:00Z';   // Mon 10:00 CEST
    const result = addBusinessHours(start, 72);
    expect(result).toBe('2026-04-24T08:00:00.000Z');
  });

  test('respects Belgian public holidays', () => {
    const start = '2026-04-03T08:00:00Z';  // Fri 10:00 CEST
    const result = addBusinessHours(start, 8);
    // Fri: 10-17 = 7h, Sat/Sun: 0, Mon Apr 6: holiday 0h, Tue: 9-10 = 1h
    expect(result).toBe('2026-04-07T08:00:00.000Z');
  });
});
