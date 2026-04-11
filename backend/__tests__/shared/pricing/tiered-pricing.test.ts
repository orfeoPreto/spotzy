import {
  deriveTierRates,
  selectTier,
  computeStrictTierTotal,
  generatePriceQuote,
  validateTieredPricing,
} from '../../../shared/pricing/tiered-pricing';
import type { TieredPricing } from '../../../shared/pricing/types';

const standardPricing: TieredPricing = {
  pricePerHourEur: 2.00,
  dailyDiscountPct: 0.60,
  weeklyDiscountPct: 0.60,
  monthlyDiscountPct: 0.60,
};

describe('deriveTierRates', () => {
  test('standard cascade with all 60% discounts', () => {
    const rates = deriveTierRates(standardPricing);
    expect(rates.hourlyRateEur).toBe(2.00);
    expect(rates.dailyRateEur).toBe(28.80);    // 2 x 24 x 0.6
    expect(rates.weeklyRateEur).toBe(120.96);  // 28.80 x 7 x 0.6
    expect(rates.monthlyRateEur).toBe(290.30); // 120.96 x 4 x 0.6 = 290.304 -> rounds to 290.30
  });

  test('cascade with 70% discounts (more aggressive)', () => {
    const pricing: TieredPricing = { ...standardPricing, dailyDiscountPct: 0.70, weeklyDiscountPct: 0.70, monthlyDiscountPct: 0.70 };
    const rates = deriveTierRates(pricing);
    expect(rates.hourlyRateEur).toBe(2.00);
    expect(rates.dailyRateEur).toBe(33.60);    // 2 x 24 x 0.7
    expect(rates.weeklyRateEur).toBe(164.64);  // 33.60 x 7 x 0.7
    expect(rates.monthlyRateEur).toBe(460.99); // 164.64 x 4 x 0.7 = 460.992 -> 460.99
  });

  test('cascade with 50% discounts (least aggressive)', () => {
    const pricing: TieredPricing = { ...standardPricing, dailyDiscountPct: 0.50, weeklyDiscountPct: 0.50, monthlyDiscountPct: 0.50 };
    const rates = deriveTierRates(pricing);
    expect(rates.hourlyRateEur).toBe(2.00);
    expect(rates.dailyRateEur).toBe(24.00);    // 2 x 24 x 0.5
    expect(rates.weeklyRateEur).toBe(84.00);   // 24 x 7 x 0.5
    expect(rates.monthlyRateEur).toBe(168.00); // 84 x 4 x 0.5
  });

  test('mixed discount percentages', () => {
    const pricing: TieredPricing = {
      pricePerHourEur: 5.00,
      dailyDiscountPct: 0.70,    // most aggressive at the daily level
      weeklyDiscountPct: 0.60,
      monthlyDiscountPct: 0.50,  // least aggressive at the monthly level
    };
    const rates = deriveTierRates(pricing);
    expect(rates.hourlyRateEur).toBe(5.00);
    expect(rates.dailyRateEur).toBe(84.00);    // 5 x 24 x 0.7
    expect(rates.weeklyRateEur).toBe(352.80);  // 84 x 7 x 0.6
    expect(rates.monthlyRateEur).toBe(705.60); // 352.80 x 4 x 0.5
  });

  test('per-hour ladder is monotonically decreasing regardless of discount choices', () => {
    // Try every combination of {0.5, 0.6, 0.7}^3 and verify the per-hour rate
    // is always strictly decreasing as you go down the tier ladder.
    for (const d of [0.50, 0.60, 0.70] as const) {
      for (const w of [0.50, 0.60, 0.70] as const) {
        for (const m of [0.50, 0.60, 0.70] as const) {
          const rates = deriveTierRates({ pricePerHourEur: 10, dailyDiscountPct: d, weeklyDiscountPct: w, monthlyDiscountPct: m });
          const hourly = rates.hourlyRateEur;
          const dailyPerHour = rates.dailyRateEur / 24;
          const weeklyPerHour = rates.weeklyRateEur / (24 * 7);
          const monthlyPerHour = rates.monthlyRateEur / (24 * 28);
          expect(dailyPerHour).toBeLessThan(hourly);
          expect(weeklyPerHour).toBeLessThan(dailyPerHour);
          expect(monthlyPerHour).toBeLessThan(weeklyPerHour);
        }
      }
    }
  });
});

describe('selectTier', () => {
  test('1 hour -> HOURLY', () => expect(selectTier(1)).toBe('HOURLY'));
  test('23 hours -> HOURLY', () => expect(selectTier(23)).toBe('HOURLY'));
  test('23.99 hours -> HOURLY', () => expect(selectTier(23.99)).toBe('HOURLY'));
  test('24 hours -> DAILY (lower bound inclusive)', () => expect(selectTier(24)).toBe('DAILY'));
  test('100 hours -> DAILY', () => expect(selectTier(100)).toBe('DAILY'));
  test('167.99 hours -> DAILY', () => expect(selectTier(167.99)).toBe('DAILY'));
  test('168 hours -> WEEKLY (lower bound inclusive)', () => expect(selectTier(168)).toBe('WEEKLY'));
  test('500 hours -> WEEKLY', () => expect(selectTier(500)).toBe('WEEKLY'));
  test('671.99 hours -> WEEKLY', () => expect(selectTier(671.99)).toBe('WEEKLY'));
  test('672 hours -> MONTHLY (lower bound inclusive)', () => expect(selectTier(672)).toBe('MONTHLY'));
  test('1000 hours -> MONTHLY', () => expect(selectTier(1000)).toBe('MONTHLY'));
});

describe('computeStrictTierTotal', () => {
  test('25-hour booking on 2EUR/hour with 60% daily -> 57.60 (canonical example from FS)', () => {
    // Tier = DAILY
    // tierRate = 2 x 24 x 0.6 = 28.80
    // units = ceil(25/24) = 2
    // total = 2 x 28.80 = 57.60
    expect(computeStrictTierTotal(25, standardPricing)).toBe(57.60);
  });

  test('1-hour booking on 2EUR/hour -> 2 (HOURLY tier, 1 unit)', () => {
    expect(computeStrictTierTotal(1, standardPricing)).toBe(2.00);
  });

  test('5-hour booking on 2EUR/hour -> 10', () => {
    expect(computeStrictTierTotal(5, standardPricing)).toBe(10.00);
  });

  test('exactly 24-hour booking on 2EUR/hour -> 28.80 (1 daily unit)', () => {
    expect(computeStrictTierTotal(24, standardPricing)).toBe(28.80);
  });

  test('48-hour booking on 2EUR/hour -> 57.60 (2 daily units)', () => {
    expect(computeStrictTierTotal(48, standardPricing)).toBe(57.60);
  });

  test('168-hour booking on 2EUR/hour -> 120.96 (1 weekly unit)', () => {
    expect(computeStrictTierTotal(168, standardPricing)).toBe(120.96);
  });

  test('200-hour booking on 2EUR/hour -> 241.92 (2 weekly units, ceil)', () => {
    expect(computeStrictTierTotal(200, standardPricing)).toBe(241.92);
  });

  test('672-hour booking on 2EUR/hour -> 290.30 (1 monthly unit)', () => {
    expect(computeStrictTierTotal(672, standardPricing)).toBe(290.30);
  });
});

describe('generatePriceQuote', () => {
  test('25-hour booking suggests SHORTER 24h alternative with 28.80 savings', () => {
    const quote = generatePriceQuote(25, standardPricing);
    expect(quote.totalEur).toBe(57.60);
    expect(quote.appliedTier).toBe('DAILY');
    expect(quote.tierUnitsBilled).toBe(2);
    expect(quote.tierRateEur).toBe(28.80);

    const shorter = quote.cheaperAlternatives.find((a) => a.type === 'SHORTER');
    expect(shorter).toBeDefined();
    expect(shorter!.durationHours).toBe(24);
    expect(shorter!.totalEur).toBe(28.80);
    expect(shorter!.savingsEur).toBe(28.80);
  });

  test('23-hour booking suggests LONGER 24h alternative with 17.20 savings', () => {
    const quote = generatePriceQuote(23, standardPricing);
    expect(quote.totalEur).toBe(46.00);
    expect(quote.appliedTier).toBe('HOURLY');
    expect(quote.tierUnitsBilled).toBe(23);

    const longer = quote.cheaperAlternatives.find((a) => a.type === 'LONGER');
    expect(longer).toBeDefined();
    expect(longer!.durationHours).toBe(24);
    expect(longer!.totalEur).toBe(28.80);
    expect(longer!.savingsEur).toBe(17.20);
  });

  test('exactly 24 hours has no SHORTER alternative (already at the boundary)', () => {
    const quote = generatePriceQuote(24, standardPricing);
    const shorter = quote.cheaperAlternatives.find((a) => a.type === 'SHORTER');
    // 23h is 46.00, current 24h is 28.80 -> SHORTER would COST MORE, not save money. Excluded.
    expect(shorter).toBeUndefined();
  });

  test('1-hour booking has no useful alternatives', () => {
    const quote = generatePriceQuote(1, standardPricing);
    expect(quote.cheaperAlternatives).toEqual([]);
  });

  test('167-hour booking suggests LONGER 168h (1 week) for big savings', () => {
    // 167h hourly tier: selectTier(167) = DAILY -> ceil(167/24)=7 units x 28.80 = 201.60
    // 168h weekly tier = 1 x 120.96 = 120.96
    // savings = 201.60 - 120.96 = 80.64
    const quote = generatePriceQuote(167, standardPricing);
    const longer = quote.cheaperAlternatives.find((a) => a.type === 'LONGER');
    expect(longer).toBeDefined();
    expect(longer!.durationHours).toBe(168);
    expect(longer!.totalEur).toBe(120.96);
  });

  test('alternatives are excluded when savings < 1 EUR', () => {
    const cheap: TieredPricing = { ...standardPricing, pricePerHourEur: 0.10 };
    const quote = generatePriceQuote(5, cheap);
    expect(quote.cheaperAlternatives).toEqual([]);
  });
});

describe('validateTieredPricing', () => {
  test('valid pricing passes', () => {
    expect(validateTieredPricing(standardPricing).valid).toBe(true);
  });

  test('rejects pricePerHourEur of 0', () => {
    expect(validateTieredPricing({ ...standardPricing, pricePerHourEur: 0 }).error).toBe('PRICE_TOO_LOW');
  });

  test('rejects pricePerHourEur of -5', () => {
    expect(validateTieredPricing({ ...standardPricing, pricePerHourEur: -5 }).error).toBe('PRICE_TOO_LOW');
  });

  test('rejects pricePerHourEur of 1000', () => {
    expect(validateTieredPricing({ ...standardPricing, pricePerHourEur: 1000 }).error).toBe('PRICE_TOO_HIGH');
  });

  test('rejects discount of 0.55 (not in allowed set)', () => {
    expect(validateTieredPricing({ ...standardPricing, dailyDiscountPct: 0.55 as any }).error).toBe('INVALID_DISCOUNT');
  });

  test('rejects missing pricePerHourEur', () => {
    const bad = { dailyDiscountPct: 0.60 as const, weeklyDiscountPct: 0.60 as const, monthlyDiscountPct: 0.60 as const };
    expect(validateTieredPricing(bad).valid).toBe(false);
  });
});
