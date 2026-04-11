// Tiered pricing
export const HOURLY_PRICE_MIN_EUR = 0.01;       // > 0 (FS rule: "must be greater than 0")
export const HOURLY_PRICE_MAX_EUR = 999.99;     // < 1000 (FS rule: "less than 1000")

export const DISCOUNT_VALUES = [0.50, 0.60, 0.70] as const;
export const DEFAULT_DISCOUNT_PCT = 0.60;

// Tier boundary thresholds (inclusive at the lower bound)
export const HOURLY_TIER_MAX_HOURS = 24;        // < 24h -> hourly tier
export const DAILY_TIER_MAX_HOURS = 24 * 7;     // 24h to < 168h -> daily tier
export const WEEKLY_TIER_MAX_HOURS = 24 * 28;   // 168h to < 672h -> weekly tier
                                                 // >= 672h -> monthly tier

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
export const POOL_LISTING_BADGE_LOW_THRESHOLD_PCT = 0.20;  // < 20% available -> "Limited availability"
