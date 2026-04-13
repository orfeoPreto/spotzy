import type { VATStatus } from './vat-constants';

export type DiscountPct = 0.50 | 0.60 | 0.70;

export type PricingTier = 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface TieredPricing {
  /** Host's NET rate per hour (what they keep). Renamed from pricePerHourEur in 28b. */
  hostNetPricePerHourEur: number;
  /** @deprecated Use hostNetPricePerHourEur. Kept for backward compat during migration. */
  pricePerHourEur?: number;
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
  description: string;
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

/** Complete price breakdown captured at booking creation — immutable once written. */
export interface PriceBreakdown {
  hostNetTotalEur: number;
  hostVatRate: number;
  hostVatEur: number;
  hostGrossTotalEur: number;
  platformFeePct: number;
  platformFeeEur: number;
  platformFeeVatRate: number;
  platformFeeVatEur: number;
  /** THE HEADLINE: what the Spotter actually pays */
  spotterGrossTotalEur: number;
  currency: 'EUR';
  breakdownComputedAt: string;
  appliedTier: PricingTier;
  tierUnitsBilled: number;
  tierRateEur: number;
  durationHours: number;
  cheaperAlternatives?: CheaperAlternative[];
}

export interface FullPriceBreakdownInput {
  pricing: TieredPricing;
  durationHours: number;
  hostVatStatus: VATStatus;
  platformFeePct: number;
  vatRate: number;
}
