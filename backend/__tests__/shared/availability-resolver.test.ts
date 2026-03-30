import {
  isWithinAvailabilityRules,
  findNextAvailableSlot,
  computeFreeSlots,
} from '../../shared/availability/resolver';
import { AvailabilityRule, AvailabilityBlock } from '../../shared/types/availability';

const alwaysRule: AvailabilityRule = {
  ruleId: 'r1', listingId: 'l1', type: 'ALWAYS',
  daysOfWeek: [], startTime: '', endTime: '',
  createdAt: '', updatedAt: '',
};

const weekdayRule: AvailabilityRule = {
  ruleId: 'r1', listingId: 'l1', type: 'WEEKLY',
  daysOfWeek: [1, 2, 3, 4, 5], // Mon=1 … Fri=5
  startTime: '08:00', endTime: '18:00',
  createdAt: '', updatedAt: '',
};

// ---------------------------------------------------------------------------
// isWithinAvailabilityRules
// ---------------------------------------------------------------------------
describe('isWithinAvailabilityRules', () => {

  describe('ALWAYS rule', () => {
    test('covers any period', () => {
      const result = isWithinAvailabilityRules(
        [alwaysRule],
        new Date('2026-04-14T10:00:00Z'),
        new Date('2026-04-14T12:00:00Z'),
      );
      expect(result.covered).toBe(true);
      expect(result.uncoveredPeriods).toHaveLength(0);
    });

    test('covers multi-day period', () => {
      const result = isWithinAvailabilityRules(
        [alwaysRule],
        new Date('2026-04-14T10:00:00Z'),
        new Date('2026-04-16T10:00:00Z'),
      );
      expect(result.covered).toBe(true);
    });
  });

  describe('WEEKLY rule — Mon–Fri 08:00–18:00', () => {
    // 2026-04-14 is a Tuesday
    test('Tuesday 10:00–12:00 is covered', () => {
      const result = isWithinAvailabilityRules(
        [weekdayRule],
        new Date('2026-04-14T10:00:00Z'),
        new Date('2026-04-14T12:00:00Z'),
      );
      expect(result.covered).toBe(true);
    });

    test('Saturday 10:00–12:00 is NOT covered', () => {
      // 2026-04-18 is Saturday
      const result = isWithinAvailabilityRules(
        [weekdayRule],
        new Date('2026-04-18T10:00:00Z'),
        new Date('2026-04-18T12:00:00Z'),
      );
      expect(result.covered).toBe(false);
      expect(result.uncoveredPeriods).toHaveLength(1);
    });

    test('period starting before rule start (07:00–10:00) is NOT covered', () => {
      const result = isWithinAvailabilityRules(
        [weekdayRule],
        new Date('2026-04-14T07:00:00Z'),
        new Date('2026-04-14T10:00:00Z'),
      );
      expect(result.covered).toBe(false);
    });

    test('period ending after rule end (16:00–19:00) is NOT covered', () => {
      const result = isWithinAvailabilityRules(
        [weekdayRule],
        new Date('2026-04-14T16:00:00Z'),
        new Date('2026-04-14T19:00:00Z'),
      );
      expect(result.covered).toBe(false);
    });

    test('period spanning Mon–Wed is NOT fully covered (overnight gaps)', () => {
      const result = isWithinAvailabilityRules(
        [weekdayRule],
        new Date('2026-04-13T09:00:00Z'),  // Monday
        new Date('2026-04-15T17:00:00Z'),  // Wednesday
      );
      expect(result.covered).toBe(false);
      expect(result.uncoveredPeriods.length).toBeGreaterThan(0);
    });

    test('period spanning Fri–Mon is NOT fully covered (weekend not covered)', () => {
      const result = isWithinAvailabilityRules(
        [weekdayRule],
        new Date('2026-04-17T09:00:00Z'),  // Friday
        new Date('2026-04-20T17:00:00Z'),  // Monday
      );
      expect(result.covered).toBe(false);
      expect(result.uncoveredPeriods.length).toBeGreaterThan(0);
    });
  });

  describe('multiple WEEKLY rules', () => {
    const morningRule: AvailabilityRule = {
      ruleId: 'r1', listingId: 'l1', type: 'WEEKLY',
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '07:00', endTime: '12:00',
      createdAt: '', updatedAt: '',
    };
    const afternoonRule: AvailabilityRule = {
      ruleId: 'r2', listingId: 'l1', type: 'WEEKLY',
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '14:00', endTime: '20:00',
      createdAt: '', updatedAt: '',
    };

    test('Tuesday 09:00–11:00 covered by morning rule', () => {
      const result = isWithinAvailabilityRules([morningRule, afternoonRule],
        new Date('2026-04-14T09:00:00Z'), new Date('2026-04-14T11:00:00Z'));
      expect(result.covered).toBe(true);
    });

    test('Tuesday 15:00–18:00 covered by afternoon rule', () => {
      const result = isWithinAvailabilityRules([morningRule, afternoonRule],
        new Date('2026-04-14T15:00:00Z'), new Date('2026-04-14T18:00:00Z'));
      expect(result.covered).toBe(true);
    });

    test('Tuesday 11:00–15:00 spans the gap — NOT covered', () => {
      const result = isWithinAvailabilityRules([morningRule, afternoonRule],
        new Date('2026-04-14T11:00:00Z'), new Date('2026-04-14T15:00:00Z'));
      expect(result.covered).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('empty rules array → not covered', () => {
      const result = isWithinAvailabilityRules([],
        new Date('2026-04-14T10:00:00Z'), new Date('2026-04-14T12:00:00Z'));
      expect(result.covered).toBe(false);
    });

    test('startTime === endTime → not covered (zero-length period)', () => {
      const result = isWithinAvailabilityRules([alwaysRule],
        new Date('2026-04-14T10:00:00Z'), new Date('2026-04-14T10:00:00Z'));
      expect(result.covered).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// findNextAvailableSlot
// ---------------------------------------------------------------------------
describe('findNextAvailableSlot', () => {
  test('no blocks → returns slot at or after fromDate', () => {
    const from = new Date('2026-04-14T09:30:00Z');
    const slot = findNextAvailableSlot([alwaysRule], [], from, 30);
    expect(slot).not.toBeNull();
    expect(slot!.getTime()).toBeGreaterThanOrEqual(from.getTime());
  });

  test('all next 30 days blocked → returns null', () => {
    const from = new Date('2026-04-14T00:00:00Z');
    const blocks: AvailabilityBlock[] = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(from);
      d.setUTCDate(d.getUTCDate() + i);
      const dayStart = new Date(d);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(d);
      dayEnd.setUTCHours(23, 59, 59, 0);
      return {
        listingId: 'l1', bookingId: `b${i}`,
        date: d.toISOString().split('T')[0],
        startTime: dayStart.toISOString(),
        endTime: dayEnd.toISOString(),
        status: 'CONFIRMED' as const,
      };
    });
    const slot = findNextAvailableSlot([alwaysRule], blocks, from, 30);
    expect(slot).toBeNull();
  });

  test('WEEKLY rule with gap — finds next available day within look-ahead', () => {
    // fromDate is a Saturday (no availability until Monday)
    const from = new Date('2026-04-18T10:00:00Z'); // Saturday
    const slot = findNextAvailableSlot([weekdayRule], [], from, 30);
    expect(slot).not.toBeNull();
    expect(slot!.getUTCDay()).toBe(1); // Should be Monday
  });

  test('PENDING_PAYMENT blocks count (not just CONFIRMED)', () => {
    const blocks: AvailabilityBlock[] = [{
      listingId: 'l1', bookingId: 'b1',
      date: '2026-04-14',
      startTime: '2026-04-14T00:00:00Z',
      endTime: '2026-04-14T23:59:59Z',
      status: 'PENDING_PAYMENT',
    }];
    const from = new Date('2026-04-14T00:00:00Z');
    const slot = findNextAvailableSlot([alwaysRule], blocks, from, 2);
    // Should find slot on April 15
    expect(slot?.toISOString().startsWith('2026-04-15')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeFreeSlots
// ---------------------------------------------------------------------------
describe('computeFreeSlots', () => {
  test('ALWAYS rule, no blocks → returns continuous 1-hour slots for the full day', () => {
    const slots = computeFreeSlots(
      [alwaysRule], [],
      new Date('2026-04-14T00:00:00Z'),
      new Date('2026-04-15T00:00:00Z'),
      1,
    );
    expect(slots.length).toBe(24);
  });

  test('block in the middle of the day splits available slots', () => {
    const blocks: AvailabilityBlock[] = [{
      listingId: 'l1', bookingId: 'b1',
      date: '2026-04-14',
      startTime: '2026-04-14T10:00:00Z',
      endTime: '2026-04-14T12:00:00Z',
      status: 'CONFIRMED',
    }];
    const slots = computeFreeSlots(
      [alwaysRule], blocks,
      new Date('2026-04-14T08:00:00Z'),
      new Date('2026-04-14T14:00:00Z'),
      1,
    );
    // Should have slots 08-10 and 12-14 but NOT 10-12
    const blockedSlot = slots.find(s =>
      s.start.getUTCHours() === 10 && s.end.getUTCHours() === 11,
    );
    expect(blockedSlot).toBeUndefined();
    expect(slots.length).toBe(4); // 08, 09, 12, 13
  });

  test('WEEKLY rule — only returns slots on matching days', () => {
    // Request covers Mon–Sun
    const slots = computeFreeSlots(
      [weekdayRule], [],
      new Date('2026-04-13T00:00:00Z'), // Monday
      new Date('2026-04-19T23:59:59Z'), // Sunday
      1,
    );
    // Only Mon–Fri 08–18 = 5 days × 10 slots = 50 slots
    expect(slots.length).toBe(50);
    // No Saturday or Sunday slots
    const weekendSlot = slots.find(s => s.start.getUTCDay() === 0 || s.start.getUTCDay() === 6);
    expect(weekendSlot).toBeUndefined();
  });
});
