import { computeFullPriceBreakdown } from '../../../shared/pricing/tiered-pricing';
import type { TieredPricing, FullPriceBreakdownInput } from '../../../shared/pricing/types';
import { BELGIAN_STANDARD_VAT_RATE } from '../../../shared/pricing/vat-constants';

const basePricing: TieredPricing = {
  hostNetPricePerHourEur: 2.0,
  dailyDiscountPct: 0.60,
  weeklyDiscountPct: 0.60,
  monthlyDiscountPct: 0.60,
};

function makeInput(overrides?: Partial<FullPriceBreakdownInput>): FullPriceBreakdownInput {
  return {
    pricing: basePricing,
    durationHours: 3,
    hostVatStatus: 'EXEMPT_FRANCHISE',
    platformFeePct: 0.15,
    vatRate: BELGIAN_STANDARD_VAT_RATE,
    ...overrides,
  };
}

describe('computeFullPriceBreakdown', () => {
  describe('EXEMPT_FRANCHISE host (no host VAT)', () => {
    test('3 hours at €2/h: host net = €6, host VAT = €0, host gross = €6', () => {
      const bd = computeFullPriceBreakdown(makeInput());
      expect(bd.hostNetTotalEur).toBe(6.0);
      expect(bd.hostVatRate).toBe(0);
      expect(bd.hostVatEur).toBe(0);
      expect(bd.hostGrossTotalEur).toBe(6.0);
    });

    test('platform fee is grossed up from host gross', () => {
      const bd = computeFullPriceBreakdown(makeInput());
      // fee = 6 × (0.15 / 0.85) = 6 × 0.17647... ≈ 1.06
      expect(bd.platformFeeEur).toBeCloseTo(1.06, 2);
      expect(bd.platformFeePct).toBe(0.15);
    });

    test('platform fee VAT is 21% of fee', () => {
      const bd = computeFullPriceBreakdown(makeInput());
      expect(bd.platformFeeVatRate).toBe(0.21);
      expect(bd.platformFeeVatEur).toBeCloseTo(bd.platformFeeEur * 0.21, 2);
    });

    test('spotter gross = host gross + fee + fee VAT', () => {
      const bd = computeFullPriceBreakdown(makeInput());
      const expected = bd.hostGrossTotalEur + bd.platformFeeEur + bd.platformFeeVatEur;
      expect(bd.spotterGrossTotalEur).toBeCloseTo(expected, 2);
    });
  });

  describe('VAT_REGISTERED host (21% host VAT)', () => {
    test('3 hours at €2/h: host net = €6, host VAT = €1.26, host gross = €7.26', () => {
      const bd = computeFullPriceBreakdown(makeInput({ hostVatStatus: 'VAT_REGISTERED' }));
      expect(bd.hostNetTotalEur).toBe(6.0);
      expect(bd.hostVatRate).toBe(0.21);
      expect(bd.hostVatEur).toBe(1.26);
      expect(bd.hostGrossTotalEur).toBe(7.26);
    });

    test('platform fee is higher because host gross is higher', () => {
      const bdExempt = computeFullPriceBreakdown(makeInput());
      const bdReg = computeFullPriceBreakdown(makeInput({ hostVatStatus: 'VAT_REGISTERED' }));
      expect(bdReg.platformFeeEur).toBeGreaterThan(bdExempt.platformFeeEur);
    });

    test('spotter pays more than with exempt host', () => {
      const bdExempt = computeFullPriceBreakdown(makeInput());
      const bdReg = computeFullPriceBreakdown(makeInput({ hostVatStatus: 'VAT_REGISTERED' }));
      expect(bdReg.spotterGrossTotalEur).toBeGreaterThan(bdExempt.spotterGrossTotalEur);
    });
  });

  describe('tier metadata', () => {
    test('3 hours → HOURLY tier, 3 units billed', () => {
      const bd = computeFullPriceBreakdown(makeInput({ durationHours: 3 }));
      expect(bd.appliedTier).toBe('HOURLY');
      expect(bd.tierUnitsBilled).toBe(3);
      expect(bd.durationHours).toBe(3);
    });

    test('25 hours → DAILY tier', () => {
      const bd = computeFullPriceBreakdown(makeInput({ durationHours: 25 }));
      expect(bd.appliedTier).toBe('DAILY');
    });

    test('200 hours → WEEKLY tier', () => {
      const bd = computeFullPriceBreakdown(makeInput({ durationHours: 200 }));
      expect(bd.appliedTier).toBe('WEEKLY');
    });
  });

  describe('edge cases', () => {
    test('1 hour minimum', () => {
      const bd = computeFullPriceBreakdown(makeInput({ durationHours: 1 }));
      expect(bd.hostNetTotalEur).toBe(2.0);
      expect(bd.spotterGrossTotalEur).toBeGreaterThan(2.0);
    });

    test('all amounts have at most 2 decimal places', () => {
      const bd = computeFullPriceBreakdown(makeInput({ durationHours: 7 }));
      const check = (v: number) => expect(Math.round(v * 100) / 100).toBe(v);
      check(bd.hostNetTotalEur);
      check(bd.hostVatEur);
      check(bd.hostGrossTotalEur);
      check(bd.platformFeeEur);
      check(bd.platformFeeVatEur);
      check(bd.spotterGrossTotalEur);
    });

    test('currency is always EUR', () => {
      const bd = computeFullPriceBreakdown(makeInput());
      expect(bd.currency).toBe('EUR');
    });

    test('breakdownComputedAt is an ISO timestamp', () => {
      const bd = computeFullPriceBreakdown(makeInput());
      expect(new Date(bd.breakdownComputedAt).toISOString()).toBe(bd.breakdownComputedAt);
    });

    test('backward compat: pricing with pricePerHourEur (deprecated) still works', () => {
      const oldPricing = {
        hostNetPricePerHourEur: 0,
        pricePerHourEur: 3.0,
        dailyDiscountPct: 0.60 as const,
        weeklyDiscountPct: 0.60 as const,
        monthlyDiscountPct: 0.60 as const,
      };
      const bd = computeFullPriceBreakdown(makeInput({ pricing: oldPricing }));
      // Should use pricePerHourEur fallback since hostNet is 0
      expect(bd.hostNetTotalEur).toBe(9.0); // 3 × 3h
    });
  });
});
