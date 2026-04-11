// Review SLA — business hours only
export const REVIEW_SLA_BUSINESS_HOURS = 72;
export const BUSINESS_DAY_START_HOUR = 9;       // 09:00 Brussels
export const BUSINESS_DAY_END_HOUR = 17;        // 17:00 Brussels
export const BUSINESS_TIMEZONE = 'Europe/Brussels';

// Soft-lock duration for the admin review queue
export const REVIEW_SOFT_LOCK_MINUTES = 15;

// RC document upload constraints
export const RC_DOCUMENT_MAX_SIZE_MB = 10;
export const RC_DOCUMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];

// Policy expiry warning thresholds
export const POLICY_EXPIRY_REMINDER_30D_DAYS = 30;
export const POLICY_EXPIRY_REMINDER_7D_DAYS = 7;
export const POLICY_NEW_MIN_DAYS_FROM_NOW = 30;

// Spot Pool constraints
export const POOL_MIN_BAY_COUNT = 2;
export const POOL_MAX_BAY_COUNT = 200;
export const POOL_MIN_PHOTOS = 2;

// Tiered pricing discount values (matches Session 28 — must be identical)
export const TIERED_DISCOUNT_VALUES = [0.50, 0.60, 0.70] as const;

// T&Cs version — bump when the Spot Manager terms text changes
export const SPOT_MANAGER_TCS_VERSION = '2026-04-v1';
