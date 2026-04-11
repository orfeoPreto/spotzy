import type { TieredPricing, DerivedRates, PriceQuote, PricingTier, CheaperAlternative } from './types';
import {
  HOURLY_PRICE_MIN_EUR,
  HOURLY_PRICE_MAX_EUR,
  DISCOUNT_VALUES,
  HOURLY_TIER_MAX_HOURS,
  DAILY_TIER_MAX_HOURS,
  WEEKLY_TIER_MAX_HOURS,
  HOURS_PER_DAY,
  HOURS_PER_WEEK,
  HOURS_PER_MONTH,
  CHEAPER_ALTERNATIVE_MIN_SAVINGS_EUR,
} from './constants';

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Computes the four derived tier rates from a TieredPricing configuration.
 */
export function deriveTierRates(pricing: TieredPricing): DerivedRates {
  const hourlyRateEur = pricing.pricePerHourEur;
  const dailyRateEur = round2(hourlyRateEur * HOURS_PER_DAY * pricing.dailyDiscountPct);
  const weeklyRateEur = round2(dailyRateEur * 7 * pricing.weeklyDiscountPct);
  const monthlyRateEur = round2(weeklyRateEur * 4 * pricing.monthlyDiscountPct);
  return { hourlyRateEur, dailyRateEur, weeklyRateEur, monthlyRateEur };
}

/**
 * Determines which billing tier applies for a given duration in hours.
 */
export function selectTier(durationHours: number): PricingTier {
  if (durationHours < HOURLY_TIER_MAX_HOURS) return 'HOURLY';
  if (durationHours < DAILY_TIER_MAX_HOURS) return 'DAILY';
  if (durationHours < WEEKLY_TIER_MAX_HOURS) return 'WEEKLY';
  return 'MONTHLY';
}

/**
 * Returns the tier unit size in hours for a given tier.
 */
function tierUnitHours(tier: PricingTier): number {
  switch (tier) {
    case 'HOURLY': return 1;
    case 'DAILY': return HOURS_PER_DAY;
    case 'WEEKLY': return HOURS_PER_WEEK;
    case 'MONTHLY': return HOURS_PER_MONTH;
  }
}

/**
 * Returns the rate for a given tier from derived rates.
 */
function tierRate(tier: PricingTier, rates: DerivedRates): number {
  switch (tier) {
    case 'HOURLY': return rates.hourlyRateEur;
    case 'DAILY': return rates.dailyRateEur;
    case 'WEEKLY': return rates.weeklyRateEur;
    case 'MONTHLY': return rates.monthlyRateEur;
  }
}

/**
 * Computes the strict-tier total for a given duration.
 */
export function computeStrictTierTotal(durationHours: number, pricing: TieredPricing): number {
  const tier = selectTier(durationHours);
  const rates = deriveTierRates(pricing);
  const rate = tierRate(tier, rates);
  const unitH = tierUnitHours(tier);
  const units = Math.ceil(durationHours / unitH);
  return round2(units * rate);
}

/**
 * Generates a full price quote for a duration including the cheaperAlternatives hint.
 */
export function generatePriceQuote(durationHours: number, pricing: TieredPricing): PriceQuote {
  const tier = selectTier(durationHours);
  const rates = deriveTierRates(pricing);
  const rate = tierRate(tier, rates);
  const unitH = tierUnitHours(tier);
  const units = Math.ceil(durationHours / unitH);
  const totalEur = round2(units * rate);

  const cheaperAlternatives: CheaperAlternative[] = [];

  // Search for SHORTER alternatives
  let bestShorter: CheaperAlternative | null = null;
  for (let delta = 1; delta <= 5; delta++) {
    const candidate = durationHours - delta;
    if (candidate < 1) break;
    const candidateTotal = computeStrictTierTotal(candidate, pricing);
    const savings = round2(totalEur - candidateTotal);
    if (savings >= CHEAPER_ALTERNATIVE_MIN_SAVINGS_EUR) {
      if (!bestShorter || savings > bestShorter.savingsEur) {
        bestShorter = {
          type: 'SHORTER',
          durationHours: candidate,
          totalEur: candidateTotal,
          savingsEur: savings,
          description: `Booking ${candidate} hours instead of ${durationHours} saves \u20AC${savings.toFixed(2)}`,
        };
      }
    }
  }

  // Search for LONGER alternatives
  let bestLonger: CheaperAlternative | null = null;
  for (let delta = 1; delta <= 5; delta++) {
    const candidate = durationHours + delta;
    const candidateTotal = computeStrictTierTotal(candidate, pricing);
    const savings = round2(totalEur - candidateTotal);
    if (savings >= CHEAPER_ALTERNATIVE_MIN_SAVINGS_EUR) {
      if (!bestLonger || savings > bestLonger.savingsEur) {
        bestLonger = {
          type: 'LONGER',
          durationHours: candidate,
          totalEur: candidateTotal,
          savingsEur: savings,
          description: `Booking ${candidate} hours instead of ${durationHours} saves \u20AC${savings.toFixed(2)}`,
        };
      }
    }
  }

  if (bestShorter) cheaperAlternatives.push(bestShorter);
  if (bestLonger) cheaperAlternatives.push(bestLonger);

  return {
    totalEur,
    appliedTier: tier,
    tierUnitsBilled: units,
    tierRateEur: rate,
    durationHours,
    cheaperAlternatives,
  };
}

/**
 * Validates a TieredPricing configuration.
 */
export function validateTieredPricing(pricing: Partial<TieredPricing>): { valid: boolean; error?: string } {
  if (pricing.pricePerHourEur === undefined || pricing.pricePerHourEur === null) {
    return { valid: false, error: 'PRICE_TOO_LOW' };
  }
  if (pricing.pricePerHourEur <= 0) {
    return { valid: false, error: 'PRICE_TOO_LOW' };
  }
  if (pricing.pricePerHourEur >= 1000) {
    return { valid: false, error: 'PRICE_TOO_HIGH' };
  }

  const discounts = [pricing.dailyDiscountPct, pricing.weeklyDiscountPct, pricing.monthlyDiscountPct];
  for (const d of discounts) {
    if (d === undefined || d === null) {
      return { valid: false, error: 'INVALID_DISCOUNT' };
    }
    if (!(DISCOUNT_VALUES as readonly number[]).includes(d)) {
      return { valid: false, error: 'INVALID_DISCOUNT' };
    }
  }

  return { valid: true };
}
