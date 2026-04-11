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
