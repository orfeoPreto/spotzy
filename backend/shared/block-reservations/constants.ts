// Block Spotter v2.x — critical constants
// Imported by all block-reservation Lambdas. Never hard-code these inline.

// Risk share rates
export const PERCENTAGE_RATE = 0.30;
export const MIN_BAYS_FLOOR_RATIO = 0.55;

// Window cap
export const MAX_WINDOW_DAYS = 7;
export const MIN_LEAD_TIME_HOURS = 24;

// Bay count bounds
export const MIN_BAY_COUNT = 2;
export const MAX_BAY_COUNT = 500;

// Authorisation timing
export const AUTH_OFFSET_DAYS = 7;
export const AUTH_FAILURE_GRACE_HOURS = 24;

// Cancellation tier boundaries
export const FREE_CANCEL_THRESHOLD_DAYS = 7;
export const NO_CANCEL_THRESHOLD_HOURS = 24;
export const PARTIAL_CANCEL_PERCENTAGE = 0.50;

// Validation charge
export const VALIDATION_CHARGE_EUR = 1.00;

// Plan ranking and matching
export const MAX_PLANS_RETURNED = 3;
export const PLAN_FRESHNESS_MINUTES = 30;
export const DEFAULT_HISTORICAL_ALLOCATION_RATE = 0.7;

// Guest PII anonymisation
export const GUEST_ANONYMISE_OFFSET_HOURS = 48;

// Magic link token
export const MAGIC_LINK_TOKEN_TTL_HOURS = 48;
