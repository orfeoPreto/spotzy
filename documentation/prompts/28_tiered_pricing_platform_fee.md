# Session 28 — Tiered Pricing + Configurable Platform Fee

## Single-shot listing pricing migration · CONFIG#PLATFORM_FEE singleton · cheaperAlternatives quote helper · Spot Pool listing search badge

> ⚠ **v2.x SCOPE** — Do not start until sessions 00–22 and 26 (Spot Manager v2.x) are complete.
> Prerequisite sessions: 00–22, 26.
>
> **This session is a prerequisite for Session 27 (Block Spotter v2.x).** Session 27 reads the `singleShotPct` and `blockReservationPct` from the `CONFIG#PLATFORM_FEE` singleton at settlement time, and uses the tiered pricing function to compute the per-bay-night cost for block allocation pricing. Session 27 will hard-fail if this session has not been deployed first.
>
> **This session updates existing Lambdas from Session 02 (listings) and Session 04 (payments).** It is a delta session — most of the work is targeted edits to existing files rather than greenfield code. Run AFTER all the original sessions have been validated against the existing data.

---

## What this session builds

This session closes three small but interconnected gaps in the v2.x specification:

1. **Tiered pricing migration for single-shot listings** — replaces the flat-rate `pricePerHour` / `pricePerDay` / `pricePerMonth` model from Session 02 with the cascading tiered model documented in functional specs v21 §6 (UC-H01 step 5). The new model uses one mandatory `pricePerHourEur` plus three percentage discounts (`dailyDiscountPct`, `weeklyDiscountPct`, `monthlyDiscountPct`), each picked from `{0.50, 0.60, 0.70}` with default `0.60`. The four tier rates (hourly, daily, weekly, monthly) are derived deterministically by cascading multiplication.
2. **Configurable platform fee singleton** — adds `CONFIG#PLATFORM_FEE METADATA` as a single DynamoDB record that admins can edit through the backoffice. Two fields: `singleShotPct` (applied to individual bookings) and `blockReservationPct` (applied to block reservation settlements). Both default to `0.15`, both bounded `[0.00, 0.30]`. The current value is snapshotted onto every settlement record at settlement time so future fee changes never affect historical settlements.
3. **Surgical updates to existing Lambdas** to consume the new pricing function and platform fee config: `listing-create` and `listing-update` accept the new fields and reject the old ones, `booking-create` uses the new tiered pricing function for quote generation, `booking-quote` returns the `cheaperAlternatives` hint when adjacent durations would be materially cheaper, `booking-confirmed` (the existing Session 03/04 settlement Lambda) snapshots `singleShotPct` onto the BOOKING# row, and `listing-search` returns Spot Pool listings with the `availableBayCount` / `totalBayCount` so the frontend can render the "X of N bays available" badge from UIUX v10 UC-S01 v2.x extension.

**Architecture references** (must be open while implementing):
- Functional specs v21 §6 (UC-H01 step 5 + Tiered Pricing Model rules table — sections 1610-1701 in the markdown extract)
- Functional specs v21 §10 (PlatformFeeConfig entity definition — section 5133 in the markdown extract)
- Architecture v10 §6.2 (PlatformFeeConfig entity pattern)
- Architecture v10 §8.2.1 (Stripe lifecycle stages reference the platform fee snapshot)
- UIUX v10 UC-H01 v2.x extension (3 new bullets covering tiered pricing fields, visualisation, and "Become a Spot Manager" CTA banner)
- UIUX v10 UC-S01 v2.x extension (Spot Pool listing badge — "X of N bays available" mint pill on listing cards)

---

## Critical constants

```typescript
// Tiered pricing
export const HOURLY_PRICE_MIN_EUR = 0.01;       // > 0 (FS rule: "must be greater than 0")
export const HOURLY_PRICE_MAX_EUR = 999.99;     // < 1000 (FS rule: "less than 1000")

export const DISCOUNT_VALUES = [0.50, 0.60, 0.70] as const;
export const DEFAULT_DISCOUNT_PCT = 0.60;

// Tier boundary thresholds (inclusive at the lower bound)
export const HOURLY_TIER_MAX_HOURS = 24;        // < 24h → hourly tier
export const DAILY_TIER_MAX_HOURS = 24 * 7;     // 24h to < 168h → daily tier
export const WEEKLY_TIER_MAX_HOURS = 24 * 28;   // 168h to < 672h → weekly tier
                                                 // ≥ 672h → monthly tier

// Tier unit definitions
export const HOURS_PER_DAY = 24;
export const DAYS_PER_WEEK = 7;
export const WEEKS_PER_MONTH = 4;               // exactly 4 weeks = 28 days, NOT calendar month
export const HOURS_PER_WEEK = HOURS_PER_DAY * DAYS_PER_WEEK;        // 168
export const HOURS_PER_MONTH = HOURS_PER_WEEK * WEEKS_PER_MONTH;    // 672

// Cheaper alternatives hint threshold
export const CHEAPER_ALTERNATIVE_MIN_SAVINGS_EUR = 1.00;
export const CHEAPER_ALTERNATIVE_MAX_SUGGESTIONS = 2;

// Platform fee config
export const PLATFORM_FEE_MIN = 0.00;
export const PLATFORM_FEE_MAX = 0.30;
export const PLATFORM_FEE_DEFAULT_SINGLE_SHOT = 0.15;
export const PLATFORM_FEE_DEFAULT_BLOCK_RESERVATION = 0.15;

// Spot Pool listing search projection
export const POOL_LISTING_BADGE_LOW_THRESHOLD_PCT = 0.20;  // < 20% available → "Limited availability"
```

These constants live in `backend/src/shared/pricing/constants.ts`. Every Lambda imports from there.

---

## DynamoDB schema additions

All on the existing `spotzy-main` table. No new tables.

```
// === Platform fee config singleton ===
PK: CONFIG#PLATFORM_FEE                  SK: METADATA
  singleShotPct (number, [0.00, 0.30], default 0.15),
  blockReservationPct (number, [0.00, 0.30], default 0.15),
  lastModifiedBy (adminUserId | null — null on initial seed),
  lastModifiedAt (ISO timestamp | null),
  historyLog [{ singleShotPct, blockReservationPct, modifiedBy, modifiedAt }]
  // Append-only history. Bounded to last 100 entries to avoid unbounded growth;
  // older entries roll off the front. Older history can be reconstructed from
  // CloudTrail / DynamoDB streams if needed for audit beyond the rolling window.

// === LISTING# METADATA additions (extends existing single-shot listings from Session 02) ===
PK: LISTING#{listingId}                  SK: METADATA
  // Existing fields unchanged EXCEPT pricing — see migration notes below.
  // New / changed pricing fields:
  pricePerHourEur (number, > 0, < 1000)             // REQUIRED, replaces pricePerHour
  dailyDiscountPct (number, one of {0.50, 0.60, 0.70})    // REQUIRED, default 0.60
  weeklyDiscountPct (number, one of {0.50, 0.60, 0.70})   // REQUIRED, default 0.60
  monthlyDiscountPct (number, one of {0.50, 0.60, 0.70})  // REQUIRED, default 0.60
  // REMOVED:
  // pricePerDay (number) — derived from pricePerHourEur × 24 × dailyDiscountPct
  // pricePerMonth (number) — derived from weekly × 4 × monthlyDiscountPct

// === BOOKING# METADATA additions (extends existing bookings from Session 03) ===
PK: BOOKING#{bookingId}                  SK: METADATA
  // Existing fields unchanged. New fields added at booking creation:
  appliedTier (HOURLY | DAILY | WEEKLY | MONTHLY)
  tierUnitsBilled (int — number of hourly, daily, weekly, or monthly units actually billed)
  tierRateEur (number — the per-unit rate at the applied tier)
  // New field added at settlement (booking-confirmed):
  platformFeeEur (number — snapshot of singleShotPct × totalEur at settlement)
  platformFeePct (number — the singleShotPct value used, snapshotted from CONFIG#PLATFORM_FEE)
```

**Migration notes:**

The pricing field change from `pricePerHour` / `pricePerDay` / `pricePerMonth` to `pricePerHourEur` + three discount percentages is a **breaking change** to the listing model. There is no automated migration of existing listings — running this session against a database with pre-existing listings requires the data migration step in PART D.

The new `pricePerHourEur` field is named with the explicit `Eur` suffix for two reasons: (a) to disambiguate from the legacy `pricePerHour` during the migration window, and (b) to make the currency unit obvious to anyone reading the schema later. Other monetary fields in the system already use the `Eur` suffix convention.

---

## PART A — Pricing function (the heart of this session)

### A1 — Constants file

Create `backend/src/shared/pricing/constants.ts` with the exact constants from the "Critical constants" section above.

### A2 — Type definitions

Create `backend/src/shared/pricing/types.ts`:

```typescript
export type DiscountPct = 0.50 | 0.60 | 0.70;

export type PricingTier = 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface TieredPricing {
  pricePerHourEur: number;
  dailyDiscountPct: DiscountPct;
  weeklyDiscountPct: DiscountPct;
  monthlyDiscountPct: DiscountPct;
}

export interface DerivedRates {
  hourlyRateEur: number;
  dailyRateEur: number;
  weeklyRateEur: number;
  monthlyRateEur: number;
}

export interface PriceQuote {
  totalEur: number;
  appliedTier: PricingTier;
  tierUnitsBilled: number;
  tierRateEur: number;
  durationHours: number;
  cheaperAlternatives: CheaperAlternative[];
}

export interface CheaperAlternative {
  type: 'SHORTER' | 'LONGER';
  durationHours: number;
  totalEur: number;
  savingsEur: number;
  description: string;          // human-readable, e.g. "Booking 24 hours instead of 25 saves €2.40"
}

export interface PlatformFeeConfig {
  singleShotPct: number;
  blockReservationPct: number;
  lastModifiedBy: string | null;
  lastModifiedAt: string | null;
  historyLog: PlatformFeeHistoryEntry[];
}

export interface PlatformFeeHistoryEntry {
  singleShotPct: number;
  blockReservationPct: number;
  modifiedBy: string;
  modifiedAt: string;
}
```

### A3 — Pricing function interface

Create `backend/src/shared/pricing/tiered-pricing.ts`:

```typescript
import type { TieredPricing, DerivedRates, PriceQuote, PricingTier } from './types';

/**
 * Computes the four derived tier rates from a TieredPricing configuration.
 *
 * Cascading derivation guarantees a monotonic per-hour ladder:
 *   hourlyRate = pricePerHourEur
 *   dailyRate  = hourlyRate × 24 × dailyDiscountPct
 *   weeklyRate = dailyRate × 7  × weeklyDiscountPct
 *   monthlyRate = weeklyRate × 4 × monthlyDiscountPct
 *
 * Because each discountPct is in [0.50, 0.70] (strictly < 1.0), every tier
 * has a strictly lower per-hour cost than the one above it, regardless of
 * which percentages are picked. This is what makes the cascade valid as a
 * pricing model — Spotters always benefit from longer commitments.
 *
 * Returns rates rounded to 2 decimal places (cents).
 */
export function deriveTierRates(pricing: TieredPricing): DerivedRates;

/**
 * Determines which billing tier applies for a given duration in hours.
 *
 * Boundaries (inclusive at the lower bound):
 *   < 24h          → HOURLY
 *   24h to < 168h  → DAILY
 *   168h to < 672h → WEEKLY
 *   ≥ 672h         → MONTHLY
 */
export function selectTier(durationHours: number): PricingTier;

/**
 * Computes the strict-tier total for a given duration:
 *   total = ceil(durationHours / tierUnitHours) × tierRate
 *
 * Example: 25-hour booking on €2/hour with 60% daily discount:
 *   tier      = DAILY
 *   tierRate  = 2 × 24 × 0.60 = €28.80
 *   tierUnits = ceil(25 / 24) = 2
 *   total     = 2 × €28.80 = €57.60
 *
 * Returns the total rounded to 2 decimal places (cents).
 */
export function computeStrictTierTotal(durationHours: number, pricing: TieredPricing): number;

/**
 * Generates a full price quote for a duration including the cheaperAlternatives hint.
 *
 * The cheaperAlternatives field is populated when a slightly shorter OR slightly longer
 * booking would be materially cheaper (savings ≥ €1). Up to 2 suggestions are returned,
 * one SHORTER and one LONGER. The Spotter is never automatically rebilled — these are
 * informational only.
 *
 * Suggestion search strategy:
 *   - SHORTER: try durationHours - 1, - 2, ... down to durationHours - 5 (or 1, whichever is higher)
 *   - LONGER: try durationHours + 1, + 2, ... up to durationHours + 5
 *   - For each candidate, compute the strict-tier total and the savings
 *   - If savings ≥ CHEAPER_ALTERNATIVE_MIN_SAVINGS_EUR, include it as a candidate
 *   - Among all SHORTER candidates, pick the one with the largest savings
 *   - Among all LONGER candidates, pick the one with the largest savings
 *
 * The +/- 5 hour search window is a heuristic — it catches the most common tier
 * boundary edge cases (24h, 168h, 672h) without doing a costly exhaustive search.
 */
export function generatePriceQuote(durationHours: number, pricing: TieredPricing): PriceQuote;

/**
 * Validates a TieredPricing configuration. Returns { valid: true } or
 * { valid: false, error: 'ERROR_CODE' } with one of:
 *   - PRICE_TOO_LOW (pricePerHourEur ≤ 0)
 *   - PRICE_TOO_HIGH (pricePerHourEur ≥ 1000)
 *   - INVALID_DISCOUNT (any discount not in {0.50, 0.60, 0.70})
 */
export function validateTieredPricing(pricing: Partial<TieredPricing>): { valid: boolean; error?: string };
```

### A4 — Pricing function tests

**Tests first:** `backend/__tests__/shared/pricing/tiered-pricing.test.ts`

```typescript
import {
  deriveTierRates,
  selectTier,
  computeStrictTierTotal,
  generatePriceQuote,
  validateTieredPricing,
} from '../../../src/shared/pricing/tiered-pricing';
import type { TieredPricing } from '../../../src/shared/pricing/types';

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
    expect(rates.dailyRateEur).toBe(28.80);    // 2 × 24 × 0.6
    expect(rates.weeklyRateEur).toBe(120.96);  // 28.80 × 7 × 0.6
    expect(rates.monthlyRateEur).toBe(290.30); // 120.96 × 4 × 0.6 = 290.304 → rounds to 290.30
  });

  test('cascade with 70% discounts (more aggressive)', () => {
    const pricing: TieredPricing = { ...standardPricing, dailyDiscountPct: 0.70, weeklyDiscountPct: 0.70, monthlyDiscountPct: 0.70 };
    const rates = deriveTierRates(pricing);
    expect(rates.hourlyRateEur).toBe(2.00);
    expect(rates.dailyRateEur).toBe(33.60);    // 2 × 24 × 0.7
    expect(rates.weeklyRateEur).toBe(164.64);  // 33.60 × 7 × 0.7
    expect(rates.monthlyRateEur).toBe(460.99); // 164.64 × 4 × 0.7 = 460.992 → 460.99
  });

  test('cascade with 50% discounts (least aggressive)', () => {
    const pricing: TieredPricing = { ...standardPricing, dailyDiscountPct: 0.50, weeklyDiscountPct: 0.50, monthlyDiscountPct: 0.50 };
    const rates = deriveTierRates(pricing);
    expect(rates.hourlyRateEur).toBe(2.00);
    expect(rates.dailyRateEur).toBe(24.00);    // 2 × 24 × 0.5
    expect(rates.weeklyRateEur).toBe(84.00);   // 24 × 7 × 0.5
    expect(rates.monthlyRateEur).toBe(168.00); // 84 × 4 × 0.5
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
    expect(rates.dailyRateEur).toBe(84.00);    // 5 × 24 × 0.7
    expect(rates.weeklyRateEur).toBe(352.80);  // 84 × 7 × 0.6
    expect(rates.monthlyRateEur).toBe(705.60); // 352.80 × 4 × 0.5
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
  test('1 hour → HOURLY', () => expect(selectTier(1)).toBe('HOURLY'));
  test('23 hours → HOURLY', () => expect(selectTier(23)).toBe('HOURLY'));
  test('23.99 hours → HOURLY', () => expect(selectTier(23.99)).toBe('HOURLY'));
  test('24 hours → DAILY (lower bound inclusive)', () => expect(selectTier(24)).toBe('DAILY'));
  test('100 hours → DAILY', () => expect(selectTier(100)).toBe('DAILY'));
  test('167.99 hours → DAILY', () => expect(selectTier(167.99)).toBe('DAILY'));
  test('168 hours → WEEKLY (lower bound inclusive)', () => expect(selectTier(168)).toBe('WEEKLY'));
  test('500 hours → WEEKLY', () => expect(selectTier(500)).toBe('WEEKLY'));
  test('671.99 hours → WEEKLY', () => expect(selectTier(671.99)).toBe('WEEKLY'));
  test('672 hours → MONTHLY (lower bound inclusive)', () => expect(selectTier(672)).toBe('MONTHLY'));
  test('1000 hours → MONTHLY', () => expect(selectTier(1000)).toBe('MONTHLY'));
});

describe('computeStrictTierTotal', () => {
  test('25-hour booking on €2/hour with 60% daily → €57.60 (canonical example from FS)', () => {
    // Tier = DAILY
    // tierRate = 2 × 24 × 0.6 = 28.80
    // units = ceil(25/24) = 2
    // total = 2 × 28.80 = 57.60
    expect(computeStrictTierTotal(25, standardPricing)).toBe(57.60);
  });

  test('1-hour booking on €2/hour → €2 (HOURLY tier, 1 unit)', () => {
    expect(computeStrictTierTotal(1, standardPricing)).toBe(2.00);
  });

  test('5-hour booking on €2/hour → €10', () => {
    expect(computeStrictTierTotal(5, standardPricing)).toBe(10.00);
  });

  test('exactly 24-hour booking on €2/hour → €28.80 (1 daily unit)', () => {
    expect(computeStrictTierTotal(24, standardPricing)).toBe(28.80);
  });

  test('48-hour booking on €2/hour → €57.60 (2 daily units)', () => {
    expect(computeStrictTierTotal(48, standardPricing)).toBe(57.60);
  });

  test('168-hour booking on €2/hour → €120.96 (1 weekly unit)', () => {
    expect(computeStrictTierTotal(168, standardPricing)).toBe(120.96);
  });

  test('200-hour booking on €2/hour → €241.92 (2 weekly units, ceil)', () => {
    expect(computeStrictTierTotal(200, standardPricing)).toBe(241.92);
  });

  test('672-hour booking on €2/hour → €290.30 (1 monthly unit)', () => {
    expect(computeStrictTierTotal(672, standardPricing)).toBe(290.30);
  });
});

describe('generatePriceQuote', () => {
  test('25-hour booking suggests SHORTER 24h alternative with €28.80 savings', () => {
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

  test('23-hour booking suggests LONGER 24h alternative... wait, no — 23h costs €46, 24h costs €28.80, savings €17.20', () => {
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
    // 23h is €46.00, current 24h is €28.80 → SHORTER would COST MORE, not save money. Excluded.
    expect(shorter).toBeUndefined();
  });

  test('1-hour booking has no useful alternatives', () => {
    const quote = generatePriceQuote(1, standardPricing);
    expect(quote.cheaperAlternatives).toEqual([]);
  });

  test('167-hour booking suggests LONGER 168h (1 week) for big savings', () => {
    // 167h hourly = 167 × 2 = €334
    // 168h weekly tier = 1 × 120.96 = €120.96
    // savings = €213.04 — definitely a useful hint
    const quote = generatePriceQuote(167, standardPricing);
    const longer = quote.cheaperAlternatives.find((a) => a.type === 'LONGER');
    expect(longer).toBeDefined();
    expect(longer!.durationHours).toBe(168);
    expect(longer!.totalEur).toBe(120.96);
  });

  test('alternatives are excluded when savings < €1', () => {
    // 5h booking → €10. 4h → €8. Savings of €2 — should still suggest SHORTER... wait, 4h has no special tier benefit.
    // Actually let's pick a case where savings are tiny: a listing where pricePerHour is €0.10
    // 5h @ €0.10/h = €0.50. 4h @ €0.10/h = €0.40. Savings €0.10 < €1.00 threshold → no alternative
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
    const bad = { dailyDiscountPct: 0.60, weeklyDiscountPct: 0.60, monthlyDiscountPct: 0.60 };
    expect(validateTieredPricing(bad).valid).toBe(false);
  });
});
```

Run the tests — they must fail (red). Implement `tiered-pricing.ts`. Run the tests — they must pass (green).

Implementation notes:
- Use `Math.round(value * 100) / 100` for the 2-decimal rounding (avoid floating-point string formatting headaches).
- Be careful with the `selectTier` boundary — `< 24` should NOT use `<= 23` because durations can be fractional. Use `durationHours < HOURLY_TIER_MAX_HOURS`.
- The `cheaperAlternatives` search is intentionally simple: try `±1`, `±2`, `±3`, `±4`, `±5` hours and pick the best SHORTER + the best LONGER. Don't try to be clever with binary search across the full duration range — that's O(N) and the +/-5 window is fine for the common edge cases.
- For SHORTER alternatives, never go below `1` hour. For LONGER, no hard upper bound — but the +5 hour window naturally limits the search.

---

## PART B — Platform fee config helpers

### B1 — Type definitions

Already covered in PART A2.

### B2 — Default seed function

Create `backend/src/shared/platform-fee/seed.ts`:

```typescript
import { PLATFORM_FEE_DEFAULT_SINGLE_SHOT, PLATFORM_FEE_DEFAULT_BLOCK_RESERVATION } from '../pricing/constants';
import type { PlatformFeeConfig } from '../pricing/types';

/**
 * Returns the default PlatformFeeConfig record used to seed the table on first deploy.
 * Idempotent — calling this multiple times returns the same shape.
 */
export function defaultPlatformFeeConfig(): PlatformFeeConfig {
  return {
    singleShotPct: PLATFORM_FEE_DEFAULT_SINGLE_SHOT,
    blockReservationPct: PLATFORM_FEE_DEFAULT_BLOCK_RESERVATION,
    lastModifiedBy: null,
    lastModifiedAt: null,
    historyLog: [],
  };
}
```

### B3 — Read helper

Create `backend/src/shared/platform-fee/read.ts`:

```typescript
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { PLATFORM_FEE_DEFAULT_SINGLE_SHOT, PLATFORM_FEE_DEFAULT_BLOCK_RESERVATION } from '../pricing/constants';
import type { PlatformFeeConfig } from '../pricing/types';

/**
 * Reads the current PlatformFeeConfig from DynamoDB.
 *
 * If the record doesn't exist (e.g. on first deploy before the seed Lambda has run),
 * falls back to default values rather than throwing. This makes the function safe to
 * call from any settlement Lambda even on a brand-new environment.
 */
export async function readPlatformFeeConfig(
  client: DynamoDBDocumentClient,
  tableName: string
): Promise<PlatformFeeConfig> {
  const result = await client.send(new GetCommand({
    TableName: tableName,
    Key: { PK: 'CONFIG#PLATFORM_FEE', SK: 'METADATA' },
  }));

  if (!result.Item) {
    return {
      singleShotPct: PLATFORM_FEE_DEFAULT_SINGLE_SHOT,
      blockReservationPct: PLATFORM_FEE_DEFAULT_BLOCK_RESERVATION,
      lastModifiedBy: null,
      lastModifiedAt: null,
      historyLog: [],
    };
  }

  return {
    singleShotPct: result.Item.singleShotPct,
    blockReservationPct: result.Item.blockReservationPct,
    lastModifiedBy: result.Item.lastModifiedBy ?? null,
    lastModifiedAt: result.Item.lastModifiedAt ?? null,
    historyLog: result.Item.historyLog ?? [],
  };
}
```

### B4 — Tests for the read helper

**Tests first:** `backend/__tests__/shared/platform-fee/read.test.ts`

Cover:
- Returns the seeded record when it exists
- Returns defaults when the record doesn't exist (no throw)
- Handles missing optional fields (`lastModifiedBy`, `lastModifiedAt`, `historyLog`) on legacy records

---

## PART C — Lambda functions

### C1 — `admin-platform-fee-get`

**Endpoint:** `GET /api/v1/admin/config/platform-fee`
**Auth:** Admin Cognito group
**Implements:** Backoffice config UI read

Returns the current PlatformFeeConfig including the history log.

**Tests first:** Cover happy path + 403 for non-admin.

Implementation: simple wrapper around `readPlatformFeeConfig`.

### C2 — `admin-platform-fee-update`

**Endpoint:** `POST /api/v1/admin/config/platform-fee`
**Auth:** Admin Cognito group
**Implements:** Backoffice config UI write

Body:
```typescript
{
  singleShotPct: number,        // [0.00, 0.30]
  blockReservationPct: number,  // [0.00, 0.30]
}
```

**Tests first:** Cover:
- Happy path — writes new values, appends to historyLog with `modifiedBy` and `modifiedAt`, sets `lastModifiedBy` and `lastModifiedAt`
- Rejects values < 0 with 400 PLATFORM_FEE_OUT_OF_BOUNDS
- Rejects values > 0.30 with 400 PLATFORM_FEE_OUT_OF_BOUNDS
- Rejects non-numeric values
- 403 for non-admin
- History log retains the 100 most recent entries (older roll off the front)
- Idempotent: setting the same values writes a new history entry but doesn't error

Implementation:
- Use a single UpdateItem with the new values + a `list_append` for the history entry
- Use a conditional expression to truncate the history log if it exceeds 100 entries (read-modify-write within the same Lambda invocation is fine here since this Lambda is called rarely)
- Bounds check happens before the DynamoDB call

### C3 — `booking-quote` (NEW Lambda — generates a quote without creating a booking)

**Endpoint:** `POST /api/v1/bookings/quote`
**Auth:** Required (any persona)
**Implements:** UC-S04 quote generation step

Body:
```typescript
{
  listingId: string,
  startTime: string,    // ISO
  endTime: string,      // ISO
}
```

Returns:
```typescript
{
  totalEur: number,
  appliedTier: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY',
  tierUnitsBilled: number,
  tierRateEur: number,
  durationHours: number,
  cheaperAlternatives: [{ type, durationHours, totalEur, savingsEur, description }],
}
```

This is a new Lambda — Session 03 has no equivalent because the original flat-rate model didn't need a quote helper. The Lambda loads the listing, validates the window against availability rules, computes the duration in hours, and calls `generatePriceQuote` from PART A.

**Tests first:** Cover:
- Happy path returns the right tier and total
- Includes cheaperAlternatives when applicable
- 404 if listing doesn't exist
- 400 if endTime ≤ startTime
- 400 if window violates availability rules
- For Spot Pool listings, computes the quote against the pool's pricing (same as single-shot since pool pricing is shared across bays)

### C4 — `listing-create` (UPDATE existing Lambda from Session 02)

**Existing endpoint:** `POST /api/v1/listings`

This is a SURGICAL UPDATE to the existing Lambda from Session 02. The change:
- **Remove** acceptance of `pricePerHour`, `pricePerDay`, `pricePerMonth` (any of these in the body returns 400 LEGACY_PRICING_FIELDS_REJECTED)
- **Add** acceptance and validation of `pricePerHourEur`, `dailyDiscountPct`, `weeklyDiscountPct`, `monthlyDiscountPct` (all required)
- Validation uses `validateTieredPricing` from PART A
- Default discount values (0.60) are NOT applied silently — clients must pass them explicitly. The default exists for the UI form to pre-populate, not for missing-field tolerance.

**Tests first:** Add new test cases to the existing Session 02 test file:
- Happy path with the new fields
- Rejects body with `pricePerDay`
- Rejects body with `pricePerMonth`
- Rejects body missing `pricePerHourEur`
- Rejects body missing any of the three discount fields
- Rejects discount of 0.55
- Rejects price of 0
- Pool listing creation (when `isPool=true` from Session 26) accepts the same pricing fields and stores them on the parent LISTING# row

### C5 — `listing-update` (UPDATE existing Lambda from Session 02)

Same surgical update as C4 but for the PATCH endpoint. Same validation rules.

### C6 — `listing-search` (UPDATE existing Lambda from Session 02)

This is a SURGICAL UPDATE adding the Spot Pool listing badge data to search results.

For each listing returned in the search results:
- If `isPool === true`, query the BAY# children to compute `availableBayCount` (count of bays with `status = ACTIVE` minus count of bays currently held by an ALLOCATED booking during the requested search window)
- Add `totalBayCount` and `availableBayCount` to the response payload
- For non-pool listings, `totalBayCount` and `availableBayCount` are omitted (not set to null — the absence of the field is the signal)

**Tests first:** Cover:
- Pool listing returned with `availableBayCount: 3, totalBayCount: 5`
- Pool listing with all bays occupied returned with `availableBayCount: 0, totalBayCount: 5`
- Single-spot listing returned without the bay count fields
- Performance: the per-listing bay query is bounded — search result page size is 20, so at most 20 secondary queries per search request. Acceptable for the v2.x scope. If search throughput becomes a bottleneck post-launch, the bay count can be denormalised onto the parent LISTING# row and updated by a DynamoDB Stream.

### C7 — `booking-create` (UPDATE existing Lambda from Session 03)

The existing Session 03 `booking-create` Lambda computes the booking total. Update it to:
- Use `generatePriceQuote` from PART A instead of the old flat-rate calculation
- Store `appliedTier`, `tierUnitsBilled`, and `tierRateEur` on the BOOKING# row
- Reject bookings on listings that still have legacy pricing fields (defensive — these should not exist after the migration in PART D, but the check belongs here as a backstop)

**Tests first:** Add new test cases to the existing Session 03 test file:
- Booking total uses the tiered pricing function
- Booking record stores the tier metadata
- Booking on a legacy-priced listing returns 500 LISTING_PRICING_NOT_MIGRATED

### C8 — `booking-confirmed` (UPDATE existing settlement Lambda from Session 04)

The Session 04 `booking-confirmed` Lambda runs at booking completion to finalise the booking, transfer funds to the Host via Stripe Connect, and write the settlement record.

Update it to:
- Read the current `singleShotPct` from `CONFIG#PLATFORM_FEE` via `readPlatformFeeConfig`
- Compute `platformFeeEur = round(totalEur × singleShotPct, 2)`
- Write `platformFeeEur` and `platformFeePct` (the snapshot value) onto the BOOKING# row in the settlement update
- The Stripe Connect transfer amount becomes `totalEur - platformFeeEur` (was previously hardcoded to a 15% fee in Session 04)

**Tests first:** Add new test cases to the existing Session 04 test file:
- Settlement reads the current platform fee from CONFIG and snapshots it
- Settlement uses the snapshotted fee for the Stripe Connect transfer math
- Future fee changes don't affect already-settled bookings (write a test that updates the config after settlement and re-reads the BOOKING# — the snapshot fields are unchanged)
- Settlement succeeds even if the CONFIG record doesn't exist yet (uses defaults)

---

## PART D — Data migration script

**File:** `backend/scripts/migrate-listings-to-tiered-pricing.ts`

This is a ONE-TIME migration script that converts existing listings from the legacy flat-rate model to the tiered model. It runs as a standalone Node.js script (not a Lambda) against the deployed DynamoDB table.

**Strategy:**

For each existing LISTING# METADATA row that has `pricePerHour` set but no `pricePerHourEur`:
1. Read the existing `pricePerHour`, `pricePerDay`, `pricePerMonth` values
2. Set `pricePerHourEur = pricePerHour` (direct copy — same field meaning)
3. **Reverse-engineer** discount percentages from the existing flat rates:
   - `dailyDiscountPct = pricePerDay / (pricePerHour × 24)` if `pricePerDay` exists, else 0.60
   - `weeklyDiscountPct = pricePerWeek / (pricePerDay × 7)` — but `pricePerWeek` doesn't exist in the old model, so default to 0.60
   - `monthlyDiscountPct = pricePerMonth / (pricePerWeek × 4)` — but `pricePerWeek` doesn't exist, so this calculation isn't meaningful. Default to 0.60.
4. **Snap** the computed `dailyDiscountPct` to the nearest allowed value `{0.50, 0.60, 0.70}`. If the computed value is outside `[0.45, 0.75]`, default to 0.60 and log a warning that this listing's old rates didn't fit the new model cleanly.
5. Write the new fields and **remove** the old `pricePerHour`, `pricePerDay`, `pricePerMonth` fields in the same UpdateItem.
6. Log every migration with `listingId`, old values, new values, and any snapping warnings to a CSV file for the Host to review.

**Tests first:** `backend/__tests__/scripts/migrate-listings-to-tiered-pricing.test.ts`

```typescript
describe('migrate-listings-to-tiered-pricing', () => {
  test('converts listing with hourly+daily to new model with snapped 0.60 discount', async () => {
    // Seed listing: pricePerHour=2, pricePerDay=28.80 → derived dailyDiscountPct = 28.80/(2×24) = 0.60 (exact match)
    // Expected: pricePerHourEur=2, dailyDiscountPct=0.60, weekly/monthly default to 0.60
  });

  test('snaps 0.58 to 0.60', async () => {
    // pricePerHour=2, pricePerDay=27.84 → derived 27.84/(2×24) = 0.58 → snap to 0.60 (closest allowed)
  });

  test('warns and defaults to 0.60 when discount is outside [0.45, 0.75]', async () => {
    // pricePerHour=2, pricePerDay=14.40 → derived 0.30 → outside range, default 0.60, log warning
  });

  test('removes legacy fields after migration', async () => {
    // Verify pricePerHour, pricePerDay, pricePerMonth are gone after the update
  });

  test('idempotent — running twice on the same listing is a no-op the second time', async () => {
    // The script's primary check is "has pricePerHour but no pricePerHourEur" — already-migrated listings skip
  });
});
```

The script outputs a summary at the end: "Migrated N listings, M warnings, 0 errors. See migration-report.csv for details."

**Run instructions** (added to the deployment README):
```bash
# Dry run first — outputs the migration report without writing
ts-node backend/scripts/migrate-listings-to-tiered-pricing.ts --env=staging --dry-run

# Actual run after reviewing the dry-run report
ts-node backend/scripts/migrate-listings-to-tiered-pricing.ts --env=staging

# Production migration
ts-node backend/scripts/migrate-listings-to-tiered-pricing.ts --env=prod
```

---

## PART E — Frontend updates

### E1 — Listing creation form (UC-H01 + UC-SM01)

**File:** `frontend/app/listings/new/PricingStep.tsx` (existing, from Session 02)

Replace the current 3-input pricing block (`pricePerHour`, `pricePerDay`, `pricePerMonth`) with:
- One **`pricePerHourEur`** numeric input (€, min 0.01, max 999.99, step 0.10)
- Three **discount steppers** labelled "Daily discount", "Weekly discount", "Monthly discount", each with options 50% / 60% / 70% as a segmented control. Default selection: 60%.
- A **live preview card** to the right of the form (or below on mobile) showing the four derived rates as the user adjusts inputs:
  - "€{hourly}/hour"
  - "€{daily}/day (24h)"
  - "€{weekly}/week (7 days)"
  - "€{monthly}/month (28 days)"

The live preview calls `deriveTierRates` from a frontend port of the pricing function (or via a debounced call to a `/api/v1/listings/preview-pricing` endpoint — pick whichever is simpler). Since the function is pure and small (~20 lines), porting it to the frontend is preferred.

**Below the steppers**: a small forest gradient bar showing the four tier rates as horizontal bars with relative widths reflecting the per-hour ratio. Tooltip on hover explains the cascade and the "monthly = 28 days" convention.

**Visibility-gated bullet at the top of the pricing step** (only for Hosts with 3+ active listings AND `spotManagerStatus === 'NONE'`): "Become a Spot Manager" soft banner with forest gradient background, white text, dismiss X, and CTA "Unlock multi-bay pools and block reservations" → navigates to UC-SM00 commitment gate.

**Tests first:** `frontend/__tests__/listings/pricing-step.test.tsx`

- 3 inputs render with defaults
- Adjusting `pricePerHourEur` updates all 4 derived rates in the preview
- Adjusting any discount stepper updates the corresponding tier and downstream tiers
- Discount steppers reject manual entry — only the 3 segmented options are selectable
- Submit posts the right body shape
- Soft banner only renders for eligible Hosts
- Banner dismiss persists for the session

### E2 — Booking flow quote display (UC-S04)

**File:** `frontend/app/listings/[id]/BookingFlow.tsx` (existing, from Session 08)

When the Spotter selects start and end times, fetch a quote via `POST /api/v1/bookings/quote` and display:
- The total in large forest bold
- The applied tier as a small badge ("Daily rate", "Weekly rate", etc.)
- The `tierUnitsBilled × tierRateEur` breakdown ("2 × €28.80 = €57.60")
- If `cheaperAlternatives` is non-empty, render an info banner with the suggestions:
  - "💡 Did you know? Booking 24 hours instead of 25 saves €28.80 — Adjust dates"
  - The "Adjust dates" link pre-fills the date picker with the suggested duration

**Tests first:** Cover the quote display, the tier badge, the breakdown, and the cheaper alternatives banner with the adjust link.

### E3 — Spot Pool listing badge in search results (UC-S01 v2.x extension)

**File:** `frontend/components/listings/ListingCard.tsx` (existing, from Session 07)

Add a small mint-coloured pill in the top-right corner of pool listing cards (where `listing.totalBayCount` is set):
- "X of N bays available" — when `availableBayCount > 0`
- "Fully booked" with brick-red background and 60% opacity on the card — when `availableBayCount === 0`
- "Limited availability" with amber background — when `availableBayCount / totalBayCount < 0.20`

**Tests first:** `frontend/__tests__/listings/listing-card.test.tsx`

- Badge renders for pool listings
- Badge does NOT render for single-spot listings
- Three states render correctly based on bay count ratio
- Card opacity drops to 60% when fully booked

### E4 — Backoffice platform fee config page

**Route:** `/admin/config/platform-fee`
**Component:** `frontend/app/admin/config/platform-fee/page.tsx`

Admin-only page (wrapped in the admin guard from Session 20). Shows:
- Current `singleShotPct` and `blockReservationPct` as numeric inputs (step 0.01, min 0, max 0.30) with percentage labels ("Single-shot booking fee: 15%")
- "Save" button posts to `POST /api/v1/admin/config/platform-fee`
- History log table below the form: 10 most recent changes with `modifiedAt`, `modifiedBy`, and the before/after values
- Warning banner: "Changes affect future settlements only. Bookings already settled retain their original fee snapshot."

**Tests first:** Cover the form, the bounds validation, the save action, the history table, and the warning copy.

---

## PART F — CDK additions

### F1 — Lambda function definitions

Add the new Lambdas to `lib/api-stack.ts`:

```typescript
const adminPlatformFeeGet = mkLambda('admin-platform-fee-get', 'functions/admin/platform-fee-get');
const adminPlatformFeeUpdate = mkLambda('admin-platform-fee-update', 'functions/admin/platform-fee-update');
const bookingQuote = mkLambda('booking-quote', 'functions/bookings/quote');
```

The two admin Lambdas use the admin Cognito group authorizer from Session 20. The booking-quote Lambda uses the standard Cognito JWT authorizer.

The `listing-create`, `listing-update`, `listing-search`, `booking-create`, and `booking-confirmed` Lambdas already exist from Sessions 02/03/04 — no new CDK definition needed, just redeploy after the code update.

### F2 — Platform fee config seed

Add a CDK custom resource that writes the default `CONFIG#PLATFORM_FEE METADATA` row on first deployment:

```typescript
new cr.AwsCustomResource(this, 'SeedPlatformFeeConfig', {
  onCreate: {
    service: 'DynamoDB',
    action: 'putItem',
    parameters: {
      TableName: this.spotzyMainTable.tableName,
      Item: {
        PK: { S: 'CONFIG#PLATFORM_FEE' },
        SK: { S: 'METADATA' },
        singleShotPct: { N: '0.15' },
        blockReservationPct: { N: '0.15' },
        lastModifiedBy: { NULL: true },
        lastModifiedAt: { NULL: true },
        historyLog: { L: [] },
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    },
    physicalResourceId: cr.PhysicalResourceId.of('PlatformFeeConfigSeed'),
  },
  policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
    resources: [this.spotzyMainTable.tableArn],
  }),
});
```

The `attribute_not_exists` condition makes the seed idempotent — re-deploying the stack doesn't overwrite admin changes.

---

## PART G — Integration tests

`backend/__tests__/integration/tiered-pricing.integration.test.ts`

```typescript
describe('Tiered pricing end-to-end', () => {
  test('listing creation → booking quote → booking creation → settlement → fee snapshot', async () => {
    // 1. Seed an admin user
    // 2. Admin updates the platform fee to 0.10 via the admin endpoint
    // 3. Create a listing with the tiered pricing fields
    // 4. Get a quote for a 25-hour booking → expect €57.60 total + SHORTER alternative
    // 5. Create the booking → BOOKING# stored with appliedTier=DAILY, tierUnits=2
    // 6. Run the settlement Lambda → BOOKING# updated with platformFeeEur=5.76, platformFeePct=0.10
    // 7. Admin updates platform fee to 0.20
    // 8. Read the BOOKING# again → snapshot fields unchanged (still 0.10)
  });

  test('migration script converts legacy listings without losing data', async () => {
    // 1. Seed listings with the OLD model (pricePerHour, pricePerDay, pricePerMonth)
    // 2. Run the migration script in dry-run mode → verify report
    // 3. Run the migration script for real
    // 4. Verify the listings now have pricePerHourEur + 3 discount fields
    // 5. Verify the legacy fields are gone
    // 6. Verify a booking can be created against the migrated listing
  });

  test('Spot Pool listing search returns bay count fields', async () => {
    // 1. Create a Spot Pool with 5 bays via Session 26 helpers
    // 2. Seed 2 active bookings on 2 of the bays during a search window
    // 3. Search for listings during that window
    // 4. Expect the pool listing to be returned with availableBayCount=3, totalBayCount=5
    // 5. Single-spot listings in the same response have no bay count fields
  });
});
```

---

## PART H — E2E tests (Playwright)

`e2e/tiered-pricing.spec.ts`

```typescript
test.describe('Tiered pricing user flows', () => {
  test('Host creates a listing with tiered pricing and sees the live preview', async ({ page }) => {
    // Login as Host test user
    // Navigate to /listings/new
    // Fill in required fields up to the pricing step
    // Set pricePerHourEur to 2.50
    // Verify live preview shows €2.50/hour, €36/day, €151.20/week, €362.88/month with default 60% discounts
    // Change daily discount to 70%
    // Verify daily rate updates to €42 and downstream tiers update accordingly
    // Submit listing
    // Verify the listing detail page shows the four-tier ladder
  });

  test('Spotter sees cheaperAlternatives hint when booking 25 hours', async ({ page }) => {
    // Navigate to a test listing priced at €2/hour with 60% daily
    // Open the booking flow
    // Pick a 25-hour window
    // Verify the quote shows €57.60 total with "Daily rate" badge
    // Verify the cheaperAlternatives banner shows "Booking 24 hours saves €28.80"
    // Click the "Adjust dates" link
    // Verify the date picker is updated to 24 hours
    // Verify the new quote is €28.80
  });

  test('Admin updates platform fee and the change is reflected on next settlement', async ({ page }) => {
    // Login as admin
    // Navigate to /admin/config/platform-fee
    // Change singleShotPct from 0.15 to 0.10
    // Save and verify success toast
    // Verify history log shows the new entry
    // (Settlement effect verified in integration tests, not E2E)
  });
});
```

---

## PART I — Acceptance criteria

A successful Claude Code run produces:

1. The pricing function in `backend/src/shared/pricing/tiered-pricing.ts` with all PART A4 tests passing
2. The platform fee read helper in `backend/src/shared/platform-fee/read.ts`
3. Three new Lambdas: `admin-platform-fee-get`, `admin-platform-fee-update`, `booking-quote`
4. Five existing Lambdas updated: `listing-create`, `listing-update`, `listing-search`, `booking-create`, `booking-confirmed`
5. The migration script with passing tests AND a clean dry-run against staging data
6. Frontend pricing form with live preview, segmented discount steppers, soft banner for Spot Manager CTA
7. Frontend booking quote display with tier badge and cheaper alternatives banner
8. Frontend Spot Pool listing badge in search results
9. Frontend backoffice platform fee config page
10. CDK seed for the default `CONFIG#PLATFORM_FEE` row (idempotent)
11. Integration test for the full tiered pricing flow + the migration script + Spot Pool search badge
12. E2E tests for the host create-listing flow, the spotter quote flow, and the admin config page
13. The functional specs UC-H01 step 5 + Tiered Pricing Model rules table are exhaustively covered
14. Sessions 26 and 27 can read from `CONFIG#PLATFORM_FEE` immediately after this session deploys

### Open questions to resolve at implementation time

1. **Frontend pricing function port** — the live preview in PART E1 either needs the pricing function ported to TypeScript on the frontend (small file, easy to port and keep in sync) OR a debounced call to a `/api/v1/listings/preview-pricing` endpoint (one extra Lambda, one network round-trip per keystroke). Recommendation: port the function. The cascade math is 4 lines and unlikely to change frequently.

2. **Migration script for production data** — the dry-run mode is mandatory. Before running against production, the CSV report must be reviewed by a human and any "warning" rows (where the legacy discount was outside `[0.45, 0.75]`) need to be either accepted at the default 0.60 or manually overridden via a separate admin action. There's no automated tooling for the override yet — flag this as a manual step in the deployment README.

3. **History log retention** — the current design rolls off entries beyond 100. If full audit history is required for compliance, the rolled-off entries can be reconstructed from CloudTrail or DynamoDB streams, but neither is currently configured for the `CONFIG#PLATFORM_FEE` row. Decision deferred to a separate compliance review.

4. **Per-listing fee override** — the current model has one global `singleShotPct` and one global `blockReservationPct`. There's no per-listing or per-Host fee override. If business needs to negotiate special rates with key Hosts, that's a follow-up feature requiring schema additions and a more complex settlement Lambda. Out of scope for this session.

5. **Currency support** — every monetary field uses EUR. Multi-currency is explicitly out of scope for v2.x — flagged in the architecture v10 §13 open questions list.

---

## Reading order for Claude Code

When feeding this file to Claude Code, the recommended sequence is:

1. **PART A** — pricing function and constants. The pricing function is the most testable pure logic in this session. Write it first so all the other Lambdas can import it.
2. **PART B** — platform fee config helpers (small, low-risk).
3. **PART C** in this order:
   - C1 + C2 (admin platform fee endpoints)
   - C3 (booking-quote Lambda — depends on PART A)
   - C4 + C5 (listing create/update updates — surgical edits to existing Session 02 Lambdas)
   - C7 (booking-create update — surgical edit to Session 03)
   - C8 (booking-confirmed update — surgical edit to Session 04, depends on PART B)
   - C6 (listing-search update — adds the bay count fields, depends on Session 26's BAY# entities)
4. **PART D** — data migration script. Run dry-run mode against staging data BEFORE wiring any of the new Lambdas to production traffic.
5. **PART E** — frontend updates (can run in parallel with backend but needs the API contracts stable first).
6. **PART F** — CDK additions.
7. **PART G** — integration tests against DynamoDB Local.
8. **PART H** — E2E tests against staging.

The most critical risk in this session is the **data migration in PART D**. Run the dry-run mode and review the CSV report carefully before flipping any production listing. Listings whose legacy discounts don't fit cleanly into the new `{0.50, 0.60, 0.70}` set need a human decision — the script picks 0.60 as a fallback, but the Host owner of the listing should be informed via email so they can adjust it post-migration if needed.
