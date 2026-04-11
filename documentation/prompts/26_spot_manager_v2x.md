# Session 26 — Spot Manager (v2.x)

## UC-SM00 · UC-SM01 · UC-SM02 · UC-SM03 · UC-SM04 · UC-SM05

> ⚠ **v2.x SCOPE** — Do not start until sessions 00–22 are complete.
> Prerequisite sessions: 00–22.
>
> **This session REPLACES the obsolete Session 23 (Spot Manager — Post-MVP).** Session 23 implemented an older POOL#/SPOT# model that does not match the v2.x functional specs. The v2.x model uses LISTING#{poolId} with `isPool = true` as the parent (a pool IS a listing), with child BAY#{bayId} records, plus a mandatory commitment gate (RC insurance + access checklist + T&Cs) with admin review and a staged grant. Do not run Session 23 alongside this one.
>
> **This session is a prerequisite for Session 27 (Block Spotter v2.x).** Session 27 reads from the same LISTING#/BAY# entities and the `blockReservationCapable` flag set by this session.

---

## What this session builds

The Spot Manager persona allows Hosts who manage multiple parking bays in a single physical location (residential building, parking garage, hotel back-lot, event facility) to model their inventory as a **Spot Pool** — a single listing with N labelled bays — instead of N separate listings. Spot Managers also get access to professional features: a portfolio dashboard, bay-level swap operations, and (after RC insurance approval) the ability to host block reservations from Block Spotters.

The Spot Manager persona is **gated** behind a three-step commitment flow:
1. **RC insurance upload** — proof of professional civil liability insurance from a curated list of Belgian insurers
2. **Access infrastructure self-assertion** — four-item checklist confirming the Host has reliable access mechanisms, stable instructions, 24h chat response commitment, and acceptance of suspension consequences
3. **Spot Manager T&Cs acceptance** — scrolled-to-bottom acknowledgement of the additional Terms

Submission grants **immediate access** to Spot Manager features (`spotManagerStatus = STAGED`). **Block reservation capability** unlocks only after admin RC review approval (`blockReservationCapable = true`). The review SLA is 72 business hours.

After approval, three EventBridge Scheduler rules are created against the policy expiry date: 30-day reminder, 7-day reminder, and expiry suspend. The expiry suspend Lambda flips `blockReservationCapable` back to false on the expiry date itself, while preserving existing committed block reservations through their full lifecycle.

**Architecture references** (must be open while implementing):
- Functional specs v21 §8 (UC-SM00 through UC-SM05, full spec text — sections 4129 through 4992 in the markdown extract)
- Architecture v10 §5.20 (Spot Manager Commitment Gate Architecture — RCSubmission lifecycle, soft-lock, EventBridge expiry rules)
- Architecture v10 §6.2 (Entity patterns: SpotPool, PoolSpot, RCSubmission, RCReminder, RCSuspend, USER PROFILE Spot Manager fields)
- Architecture v10 §10.5 (EventBridge Scheduler rules: rc-expiry-reminder-30d, rc-expiry-reminder-7d, rc-expiry-suspend)
- UIUX v10 Spot Manager Use Cases section (6 screen specs)

---

## Personas and glossary additions (v2.x)

- **Spot Manager**: A Host who has completed the commitment gate (UC-SM00) with `spotManagerStatus = STAGED` (post-submission, pre-approval) or `ACTIVE` (post-approval). The persona is additive — Spot Managers retain all Host capabilities plus pool management.
- **Spot Pool**: A parent listing record with `isPool = true` representing one physical location with N parking bays sharing the same characteristics (type, dimensions, EV charging, pricing, access). Persisted as `LISTING#{poolListingId} METADATA` with the same shape as a regular listing plus pool-specific fields.
- **Pool Spot (Bay)**: An individual bay within a Spot Pool. Persisted as `LISTING#{poolListingId} BAY#{bayId}`. Has its own optional label and access instructions but inherits pricing, type, and EV charging from the parent SpotPool.
- **Commitment gate**: The three-step onboarding flow (RC insurance, access checklist, T&Cs). Always triggered explicitly — the system never auto-promotes a Host.
- **Staged grant**: The pattern where Spot Manager features unlock immediately on submission (`spotManagerStatus = STAGED`), but block reservation capability unlocks only after admin approval (`blockReservationCapable = true`). The split lets Hosts start exploring pools while their RC review is pending.
- **RC insurance review**: An admin-side flow in the backoffice where a Spotzy admin reviews the uploaded RC document, the form fields, and the Host profile, then approves, rejects, or requests clarification. SLA is 72 business hours from submission.
- **Soft-lock**: A 15-minute exclusive lock acquired by an admin when they open a submission for review. Prevents two admins from concurrently reviewing the same submission. Refreshed on activity, released on navigation.
- **Soft suspension**: The state where `blockReservationCapable = false` due to RC insurance expiry. Existing committed block reservations are honoured through their full lifecycle. Single-shot bookings continue normally. Only NEW block reservation matching is blocked.
- **SUPERSEDED submission**: An older RC submission that has been replaced by a newer approved one. Marked with `supersededBy` pointing to the new submission ID. Neither record is deleted — both are queryable for audit.

---

## Critical constants

```typescript
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
export const POLICY_NEW_MIN_DAYS_FROM_NOW = 30;   // submission requires expiry ≥ 30 days in the future (warning, not block — see UC-SM00 Alt B)

// Spot Pool constraints
export const POOL_MIN_BAY_COUNT = 2;             // 1 bay → use UC-H01 instead
export const POOL_MAX_BAY_COUNT = 200;
export const POOL_MIN_PHOTOS = 2;                // mandatory minimum

// Tiered pricing discount values (matches Session 28 — must be identical)
export const TIERED_DISCOUNT_VALUES = [0.50, 0.60, 0.70] as const;

// T&Cs version — bump when the Spot Manager terms text changes
export const SPOT_MANAGER_TCS_VERSION = '2026-04-v1';
```

These constants live in `backend/src/shared/spot-manager/constants.ts`. Every Lambda in this session imports from there. Hard-coding any of these inline is a code review failure.

---

## DynamoDB schema additions

All on the existing `spotzy-main` table. No new tables.

```
// === USER PROFILE extension ===
PK: USER#{userId}                        SK: PROFILE
  // Existing fields (Spotter, Host, Block Spotter) unchanged.
  // New fields added for Spot Manager:
  spotManagerStatus (NONE | STAGED | ACTIVE)             // default NONE
  blockReservationCapable (bool)                          // default false; only settable to true via admin approval
  rcInsuranceStatus (NONE | PENDING_REVIEW | APPROVED | EXPIRED | REJECTED)  // default NONE
  rcInsuranceExpiryDate (ISO date | null)
  rcInsuranceApprovedAt (ISO timestamp | null)
  currentRCSubmissionId (string | null)                   // points at the active RCSUBMISSION# record

// === RC submission record (one per Host submission, append-only audit trail) ===
PK: USER#{userId}                        SK: RCSUBMISSION#{submissionId}
  submissionId, userId,
  insurer (string from curated Belgian insurer enum),
  policyNumber (free text, max 100 chars),
  expiryDate (ISO date),
  documentS3Key (string — SSE-encrypted bucket reference),
  documentMimeType (one of RC_DOCUMENT_ALLOWED_MIME_TYPES),
  documentSizeBytes (int),
  checklistAcceptance {
    reliableAccess: bool,
    stableInstructions: bool,
    chatResponseCommitment: bool,
    suspensionAcknowledged: bool,
    acceptedAt: ISO timestamp,
  },
  tcsVersionAccepted (string — see SPOT_MANAGER_TCS_VERSION),
  status (PENDING_REVIEW | APPROVED | REJECTED | CLARIFICATION_REQUESTED | SUPERSEDED),
  reviewedBy (adminUserId | null),
  reviewedAt (ISO | null),
  reviewerNote (string | null),
  rejectionReason (EXPIRED_POLICY | ILLEGIBLE_DOCUMENT | WRONG_INSURANCE_TYPE | NAME_MISMATCH | OTHER | null),
  supersededBy (submissionId | null),
  createdAt, updatedAt

// === Reverse projection for the admin review queue (FIFO by submission timestamp) ===
PK: RC_REVIEW_QUEUE                      SK: PENDING#{createdAt}#{submissionId}
  // Single-row projection that lets admin queue Query without scanning all USER# rows.
  // Written on submission, deleted on any terminal status transition (APPROVED, REJECTED, SUPERSEDED).
  submissionId, userId, createdAt, insurer, policyNumber, expiryDate

// === Soft-lock record ===
PK: RC_SOFT_LOCK#{submissionId}          SK: METADATA
  submissionId, lockedBy (adminUserId), lockedAt, expiresAt
  // TTL attribute set to expiresAt + 60 seconds so DynamoDB auto-cleans expired locks.

// === Reminder log (one per fired/skipped reminder) ===
PK: USER#{userId}                        SK: RCREMINDER#{submissionId}#{type}
  // type ∈ { '30d', '7d' }
  submissionId, type (30_DAY_REMINDER | 7_DAY_REMINDER),
  sentAt (ISO | null),
  channel (EMAIL | IN_APP | BOTH),
  skipReason (SUPERSEDED | RENEWED_EARLY | null)

// === Suspension log (one per expiry suspension event) ===
PK: USER#{userId}                        SK: RCSUSPEND#{submissionId}
  submissionId, suspendedAt (ISO),
  reason (currently only EXPIRED),
  affectedListingIds (string[])

// === Spot Pool listing (extends LISTING#{listingId} METADATA) ===
PK: LISTING#{poolListingId}              SK: METADATA
  // Existing listing fields unchanged. New fields for pool listings:
  isPool (bool, default false)            // true marks this as a pool parent
  bayCount (int, only set when isPool=true) // total number of bays in the pool
  blockReservationsOptedIn (bool, default false)  // gate for block reservation matching
  riskShareMode (PERCENTAGE | MIN_BAYS_FLOOR | null)  // null means block reservations not configured

// === Pool Spot (Bay) records (children of a pool listing) ===
PK: LISTING#{poolListingId}              SK: BAY#{bayId}
  bayId, poolListingId, label (string, default "Bay {N}"),
  accessInstructions (string | null, optional per-bay override),
  status (ACTIVE | TEMPORARILY_CLOSED | PERMANENTLY_REMOVED),
  createdAt, updatedAt
```

**Rationale notes** (paraphrased from architecture v10 §5.20 and §6.2):
- The pool IS a listing — there is no separate POOL# entity. This means pool listings appear in search results alongside single-spot listings and inherit all the listing infrastructure (search, availability resolver, photos, ratings) for free. The `isPool = true` flag drives any divergent behaviour.
- BAY# records are child records under the pool listing PK. A single Query on `PK = LISTING#{poolId}` returns the METADATA + all BAY# rows in one round trip, which is what the portfolio dashboard and the booking flow both need.
- Bay-level access instructions are OPTIONAL — if `accessInstructions` is null on a BAY#, the bay falls back to the listing-level access instructions.
- The `RC_REVIEW_QUEUE` projection is a single PK with one row per pending submission. Admins query it with a single Query operation sorted by SK ascending (which gives FIFO order because the SK starts with `PENDING#{createdAt}`). On any terminal status, the projection row is deleted in the same TransactWriteItems as the status update.
- Soft-locks are stored as their own PK with a TTL attribute so DynamoDB auto-cleans them. This avoids needing a sweeper Lambda.
- The reminder and suspension log records are append-only — they exist as audit evidence even if the Lambda was a no-op (skipped due to SUPERSEDED). The `sentAt = null` + `skipReason` pattern lets you reconstruct the full history of EventBridge rule firings.

---

## Curated Belgian RC insurer list

The functional specs reference "a curated list of Belgian RC insurers" without enumerating them. Use this as the initial list — managed as a config in `backend/src/shared/spot-manager/insurers.ts`:

```typescript
export const BELGIAN_RC_INSURERS = [
  'AG Insurance',
  'Allianz Belgium',
  'Argenta Assuranties',
  'AXA Belgium',
  'Baloise Insurance',
  'Belfius Insurance',
  'DKV Belgium',
  'Ethias',
  'Federale Verzekering',
  'KBC Verzekeringen',
  'P&V Verzekeringen',
  'Vivium',
  'Other (please specify in policy number field)',
] as const;

export type BelgianRCInsurer = typeof BELGIAN_RC_INSURERS[number];
```

This list lives in code (not the database) so it ships atomically with the rest of the v2.x release. If new insurers need to be added, that's a code change with a normal deployment cycle. The "Other" option exists as a safety valve for niche providers — when chosen, the admin reviews extra carefully.

---

## PART A — Shared helpers

### A1 — Constants file

Create `backend/src/shared/spot-manager/constants.ts` with the exact constants from the "Critical constants" section above. Export all of them as named exports.

### A2 — Type definitions

Create `backend/src/shared/spot-manager/types.ts`:

```typescript
import type { BelgianRCInsurer } from './insurers';

export type SpotManagerStatus = 'NONE' | 'STAGED' | 'ACTIVE';

export type RCInsuranceStatus =
  | 'NONE'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'EXPIRED'
  | 'REJECTED';

export type RCSubmissionStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CLARIFICATION_REQUESTED'
  | 'SUPERSEDED';

export type RCRejectionReason =
  | 'EXPIRED_POLICY'
  | 'ILLEGIBLE_DOCUMENT'
  | 'WRONG_INSURANCE_TYPE'
  | 'NAME_MISMATCH'
  | 'OTHER';

export interface ChecklistAcceptance {
  reliableAccess: boolean;
  stableInstructions: boolean;
  chatResponseCommitment: boolean;
  suspensionAcknowledged: boolean;
  acceptedAt: string;
}

export interface RCSubmission {
  submissionId: string;
  userId: string;
  insurer: BelgianRCInsurer;
  policyNumber: string;
  expiryDate: string;        // ISO date YYYY-MM-DD
  documentS3Key: string;
  documentMimeType: string;
  documentSizeBytes: number;
  checklistAcceptance: ChecklistAcceptance;
  tcsVersionAccepted: string;
  status: RCSubmissionStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewerNote: string | null;
  rejectionReason: RCRejectionReason | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpotManagerProfileFields {
  spotManagerStatus: SpotManagerStatus;
  blockReservationCapable: boolean;
  rcInsuranceStatus: RCInsuranceStatus;
  rcInsuranceExpiryDate: string | null;
  rcInsuranceApprovedAt: string | null;
  currentRCSubmissionId: string | null;
}

export type BayStatus = 'ACTIVE' | 'TEMPORARILY_CLOSED' | 'PERMANENTLY_REMOVED';

export interface PoolSpot {
  bayId: string;
  poolListingId: string;
  label: string;
  accessInstructions: string | null;
  status: BayStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SpotPoolListingExtension {
  isPool: true;
  bayCount: number;
  blockReservationsOptedIn: boolean;
  riskShareMode: 'PERCENTAGE' | 'MIN_BAYS_FLOOR' | null;
}

export interface RCReminderLog {
  submissionId: string;
  type: '30_DAY_REMINDER' | '7_DAY_REMINDER';
  sentAt: string | null;
  channel: 'EMAIL' | 'IN_APP' | 'BOTH';
  skipReason: 'SUPERSEDED' | 'RENEWED_EARLY' | null;
}

export interface RCSuspendLog {
  submissionId: string;
  suspendedAt: string;
  reason: 'EXPIRED';
  affectedListingIds: string[];
}

export interface SoftLock {
  submissionId: string;
  lockedBy: string;
  lockedAt: string;
  expiresAt: string;
}
```

### A3 — Business hours helper

Belgian business hours computation is non-trivial because of public holidays. Create `backend/src/shared/spot-manager/business-hours.ts`:

```typescript
import { BUSINESS_DAY_START_HOUR, BUSINESS_DAY_END_HOUR, BUSINESS_TIMEZONE } from './constants';

/**
 * Belgian public holidays for the years we care about.
 * Update annually as part of release housekeeping.
 */
export const BELGIAN_PUBLIC_HOLIDAYS_2026: string[] = [
  '2026-01-01', // New Year's Day
  '2026-04-06', // Easter Monday
  '2026-05-01', // Labour Day
  '2026-05-14', // Ascension Day
  '2026-05-25', // Whit Monday
  '2026-07-21', // Belgian National Day
  '2026-08-15', // Assumption
  '2026-11-01', // All Saints' Day
  '2026-11-11', // Armistice Day
  '2026-12-25', // Christmas
];

export const BELGIAN_PUBLIC_HOLIDAYS_2027: string[] = [
  '2027-01-01',
  '2027-03-29',
  '2027-05-01',
  '2027-05-06',
  '2027-05-17',
  '2027-07-21',
  '2027-08-15',
  '2027-11-01',
  '2027-11-11',
  '2027-12-25',
];

export const BELGIAN_PUBLIC_HOLIDAYS = [
  ...BELGIAN_PUBLIC_HOLIDAYS_2026,
  ...BELGIAN_PUBLIC_HOLIDAYS_2027,
];

/**
 * Returns the number of business hours elapsed between two ISO timestamps,
 * counting only Mon–Fri 09:00–17:00 Brussels time and excluding Belgian
 * public holidays.
 */
export function businessHoursBetween(startIso: string, endIso: string): number;

/**
 * Returns true if the given timestamp falls within Belgian business hours.
 */
export function isBusinessHour(iso: string): boolean;

/**
 * Returns true if the given ISO date is a Belgian public holiday.
 */
export function isBelgianPublicHoliday(isoDate: string): boolean;

/**
 * Computes the deadline timestamp by adding N business hours to a starting timestamp.
 * Used by the SLA tracker to figure out when a submission's 72-hour deadline is.
 */
export function addBusinessHours(startIso: string, hours: number): string;
```

### A4 — Tests for business-hours helper

**Tests first:** `backend/__tests__/shared/spot-manager/business-hours.test.ts`

```typescript
import {
  businessHoursBetween,
  isBusinessHour,
  isBelgianPublicHoliday,
  addBusinessHours,
} from '../../../src/shared/spot-manager/business-hours';

describe('isBusinessHour', () => {
  test('Tuesday 10:00 Brussels → true', () => {
    expect(isBusinessHour('2026-04-14T08:00:00Z')).toBe(true);  // 10:00 CEST
  });

  test('Saturday 10:00 Brussels → false', () => {
    expect(isBusinessHour('2026-04-11T08:00:00Z')).toBe(false);
  });

  test('Tuesday 06:00 Brussels (before 09:00) → false', () => {
    expect(isBusinessHour('2026-04-14T04:00:00Z')).toBe(false);  // 06:00 CEST
  });

  test('Tuesday 18:00 Brussels (after 17:00) → false', () => {
    expect(isBusinessHour('2026-04-14T16:00:00Z')).toBe(false);  // 18:00 CEST
  });

  test('Belgian public holiday Monday → false even at 10:00', () => {
    expect(isBusinessHour('2026-04-06T08:00:00Z')).toBe(false);  // Easter Monday 2026
  });
});

describe('isBelgianPublicHoliday', () => {
  test('2026-04-06 (Easter Monday) is a holiday', () => {
    expect(isBelgianPublicHoliday('2026-04-06')).toBe(true);
  });

  test('2026-04-07 is not a holiday', () => {
    expect(isBelgianPublicHoliday('2026-04-07')).toBe(false);
  });
});

describe('businessHoursBetween', () => {
  test('Tuesday 10:00 to Tuesday 16:00 same day → 6 business hours', () => {
    const start = '2026-04-14T08:00:00Z';  // 10:00 CEST
    const end = '2026-04-14T14:00:00Z';    // 16:00 CEST
    expect(businessHoursBetween(start, end)).toBe(6);
  });

  test('Friday 16:00 to Monday 10:00 → 2 business hours (1 Friday + 1 Monday)', () => {
    // Across the weekend gap
    const start = '2026-04-17T14:00:00Z';  // Fri 16:00 CEST
    const end = '2026-04-20T08:00:00Z';    // Mon 10:00 CEST
    expect(businessHoursBetween(start, end)).toBe(2);
  });

  test('Submission Friday 16:00 to Wednesday 10:00 → 17 business hours', () => {
    // Fri 16:00 → 17:00 = 1h
    // Mon 09:00 → 17:00 = 8h
    // Tue 09:00 → 17:00 = 8h
    // Wed 09:00 → 10:00 = 1h
    // Wait — that's 1 + 8 + 8 + 1 = 18, but the test expects 17.
    // Re-check: Friday 16:00 → 17:00 is 1h, Mon 09 → 17 is 8h, Tue 09 → 17 is 8h,
    // Wed 09 → 10 is 1h → total 18h. Use 18 in the actual test.
    const start = '2026-04-17T14:00:00Z';  // Fri 16:00 CEST
    const end = '2026-04-22T08:00:00Z';    // Wed 10:00 CEST
    expect(businessHoursBetween(start, end)).toBe(18);
  });

  test('skips Belgian public holidays', () => {
    // Sunday April 5 → Tuesday April 7, skipping Easter Monday April 6
    const start = '2026-04-05T08:00:00Z';  // Sun 10:00 CEST
    const end = '2026-04-07T14:00:00Z';    // Tue 16:00 CEST
    // Sunday: 0h
    // Monday April 6: holiday, 0h
    // Tuesday April 7: 09:00 → 16:00 = 7h
    expect(businessHoursBetween(start, end)).toBe(7);
  });
});

describe('addBusinessHours', () => {
  test('Mon 10:00 + 8 business hours = Tue 10:00 (because day caps at 17:00)', () => {
    const start = '2026-04-13T08:00:00Z';   // Mon 10:00 CEST
    const result = addBusinessHours(start, 8);
    // Mon 10:00–17:00 = 7h, Tue 09:00–10:00 = 1h → arrives Tue 10:00
    expect(result).toBe('2026-04-14T08:00:00.000Z');
  });

  test('Mon 10:00 + 72 business hours = following Wed 17:00', () => {
    const start = '2026-04-13T08:00:00Z';   // Mon 10:00 CEST
    const result = addBusinessHours(start, 72);
    // Mon 10–17 = 7h
    // Tue 9–17 = 8h (cum 15)
    // Wed 9–17 = 8h (cum 23)
    // Thu 9–17 = 8h (cum 31)
    // Fri 9–17 = 8h (cum 39)
    // Mon 9–17 = 8h (cum 47)
    // Tue 9–17 = 8h (cum 55)
    // Wed 9–17 = 8h (cum 63)
    // Thu 9–17 = 8h (cum 71)
    // Fri 9–10 = 1h (cum 72) → arrives Fri 10:00 CEST = 08:00 UTC
    expect(result).toBe('2026-04-24T08:00:00.000Z');
  });

  test('respects Belgian public holidays', () => {
    // Start Friday April 3 10:00 CEST + 8 business hours
    // Fri Apr 3: 10–17 = 7h
    // Sat/Sun: 0h
    // Mon Apr 6: HOLIDAY, 0h
    // Tue Apr 7: 9–10 = 1h → arrives Tue Apr 7 10:00 CEST
    const start = '2026-04-03T08:00:00Z';
    const result = addBusinessHours(start, 8);
    expect(result).toBe('2026-04-07T08:00:00.000Z');
  });
});
```

Run the tests — confirm they fail (red). Implement using `date-fns-tz` (already available in the project from session 12 availability work) for timezone math. Confirm they pass (green).

### A5 — Validation helpers

Create `backend/src/shared/spot-manager/validation.ts`:

```typescript
import { RC_DOCUMENT_MAX_SIZE_MB, RC_DOCUMENT_ALLOWED_MIME_TYPES, POOL_MIN_BAY_COUNT, POOL_MAX_BAY_COUNT } from './constants';
import { BELGIAN_RC_INSURERS } from './insurers';

export function validateInsurer(insurer: string): boolean {
  return BELGIAN_RC_INSURERS.includes(insurer as any);
}

export function validatePolicyNumber(policyNumber: string): { valid: boolean; error?: string } {
  if (!policyNumber || policyNumber.length === 0) return { valid: false, error: 'POLICY_NUMBER_REQUIRED' };
  if (policyNumber.length > 100) return { valid: false, error: 'POLICY_NUMBER_TOO_LONG' };
  return { valid: true };
}

export function validateExpiryDate(expiryDate: string, now: Date): { valid: boolean; warning?: string; error?: string } {
  const expiry = new Date(expiryDate + 'T00:00:00Z');
  if (isNaN(expiry.getTime())) return { valid: false, error: 'INVALID_DATE_FORMAT' };
  if (expiry <= now) return { valid: false, error: 'EXPIRY_DATE_IN_PAST' };
  const daysFromNow = (expiry.getTime() - now.getTime()) / (24 * 3600 * 1000);
  if (daysFromNow < 30) return { valid: true, warning: 'POLICY_NEAR_EXPIRY' };
  return { valid: true };
}

export function validateRCDocument(mimeType: string, sizeBytes: number): { valid: boolean; error?: string } {
  if (!RC_DOCUMENT_ALLOWED_MIME_TYPES.includes(mimeType)) return { valid: false, error: 'INVALID_MIME_TYPE' };
  if (sizeBytes > RC_DOCUMENT_MAX_SIZE_MB * 1024 * 1024) return { valid: false, error: 'FILE_TOO_LARGE' };
  if (sizeBytes <= 0) return { valid: false, error: 'EMPTY_FILE' };
  return { valid: true };
}

export function validateChecklistAcceptance(checklist: Record<string, unknown>): { valid: boolean; error?: string } {
  const required = ['reliableAccess', 'stableInstructions', 'chatResponseCommitment', 'suspensionAcknowledged'];
  for (const key of required) {
    if (checklist[key] !== true) return { valid: false, error: 'CHECKLIST_INCOMPLETE' };
  }
  return { valid: true };
}

export function validateBayCount(bayCount: number): { valid: boolean; error?: string } {
  if (!Number.isInteger(bayCount)) return { valid: false, error: 'BAY_COUNT_NOT_INTEGER' };
  if (bayCount < POOL_MIN_BAY_COUNT) return { valid: false, error: 'BAY_COUNT_TOO_LOW' };
  if (bayCount > POOL_MAX_BAY_COUNT) return { valid: false, error: 'BAY_COUNT_TOO_HIGH' };
  return { valid: true };
}

export function generateBayLabel(bayIndex: number): string {
  return `Bay ${bayIndex + 1}`;
}
```

### A6 — Tests for validation helpers

**Tests first:** `backend/__tests__/shared/spot-manager/validation.test.ts`

```typescript
import {
  validateInsurer,
  validatePolicyNumber,
  validateExpiryDate,
  validateRCDocument,
  validateChecklistAcceptance,
  validateBayCount,
  generateBayLabel,
} from '../../../src/shared/spot-manager/validation';

describe('validateInsurer', () => {
  test('accepts AXA Belgium', () => expect(validateInsurer('AXA Belgium')).toBe(true));
  test('accepts Ethias', () => expect(validateInsurer('Ethias')).toBe(true));
  test('accepts the Other option', () => expect(validateInsurer('Other (please specify in policy number field)')).toBe(true));
  test('rejects unknown insurer', () => expect(validateInsurer('Acme Insurance')).toBe(false));
});

describe('validatePolicyNumber', () => {
  test('accepts standard policy number', () => expect(validatePolicyNumber('POL-12345').valid).toBe(true));
  test('rejects empty', () => expect(validatePolicyNumber('').error).toBe('POLICY_NUMBER_REQUIRED'));
  test('rejects too long', () => expect(validatePolicyNumber('x'.repeat(101)).error).toBe('POLICY_NUMBER_TOO_LONG'));
});

describe('validateExpiryDate', () => {
  const now = new Date('2026-04-10T12:00:00Z');

  test('accepts date 60 days in the future', () => {
    expect(validateExpiryDate('2026-06-09', now).valid).toBe(true);
  });

  test('warns on date 20 days in the future', () => {
    const result = validateExpiryDate('2026-04-30', now);
    expect(result.valid).toBe(true);
    expect(result.warning).toBe('POLICY_NEAR_EXPIRY');
  });

  test('rejects date in the past', () => {
    expect(validateExpiryDate('2026-04-05', now).error).toBe('EXPIRY_DATE_IN_PAST');
  });

  test('rejects malformed date', () => {
    expect(validateExpiryDate('not-a-date', now).error).toBe('INVALID_DATE_FORMAT');
  });
});

describe('validateRCDocument', () => {
  test('accepts PDF under 10MB', () => {
    expect(validateRCDocument('application/pdf', 5 * 1024 * 1024).valid).toBe(true);
  });
  test('accepts JPEG', () => {
    expect(validateRCDocument('image/jpeg', 1024).valid).toBe(true);
  });
  test('rejects EXE', () => {
    expect(validateRCDocument('application/octet-stream', 1024).error).toBe('INVALID_MIME_TYPE');
  });
  test('rejects file over 10MB', () => {
    expect(validateRCDocument('application/pdf', 11 * 1024 * 1024).error).toBe('FILE_TOO_LARGE');
  });
  test('rejects empty file', () => {
    expect(validateRCDocument('application/pdf', 0).error).toBe('EMPTY_FILE');
  });
});

describe('validateChecklistAcceptance', () => {
  test('accepts when all four checked', () => {
    const checklist = {
      reliableAccess: true,
      stableInstructions: true,
      chatResponseCommitment: true,
      suspensionAcknowledged: true,
    };
    expect(validateChecklistAcceptance(checklist).valid).toBe(true);
  });

  test('rejects when one box is unchecked', () => {
    const checklist = {
      reliableAccess: true,
      stableInstructions: false,
      chatResponseCommitment: true,
      suspensionAcknowledged: true,
    };
    expect(validateChecklistAcceptance(checklist).error).toBe('CHECKLIST_INCOMPLETE');
  });
});

describe('validateBayCount', () => {
  test('accepts 2', () => expect(validateBayCount(2).valid).toBe(true));
  test('rejects 1', () => expect(validateBayCount(1).error).toBe('BAY_COUNT_TOO_LOW'));
  test('accepts 200', () => expect(validateBayCount(200).valid).toBe(true));
  test('rejects 201', () => expect(validateBayCount(201).error).toBe('BAY_COUNT_TOO_HIGH'));
  test('rejects 2.5', () => expect(validateBayCount(2.5).error).toBe('BAY_COUNT_NOT_INTEGER'));
});

describe('generateBayLabel', () => {
  test('index 0 → "Bay 1"', () => expect(generateBayLabel(0)).toBe('Bay 1'));
  test('index 4 → "Bay 5"', () => expect(generateBayLabel(4)).toBe('Bay 5'));
});
```

Run the tests — they must fail (red). Implement `validation.ts` and `insurers.ts`. Run the tests — they must pass (green).


---

## PART B — Lambda functions

This session adds the following Lambdas. Each follows TDD: tests first (red), implementation (green).

| # | Lambda | Endpoint | UC | Trigger |
|---|---|---|---|---|
| B1 | `rc-submission-create` | POST /api/v1/spot-manager/rc-submissions | UC-SM00 | API Gateway |
| B2 | `rc-submission-presign-upload` | POST /api/v1/spot-manager/rc-submissions/presign | UC-SM00 step 4 | API Gateway |
| B3 | `rc-submission-get` | GET /api/v1/spot-manager/rc-submissions/{submissionId} | UC-SM00, UC-SM02 | API Gateway |
| B4 | `rc-submission-list-mine` | GET /api/v1/spot-manager/rc-submissions/mine | Spot Manager dashboard | API Gateway |
| B5 | `admin-rc-review-list` | GET /api/v1/admin/rc-review | UC-SM02 step 1 | API Gateway (admin auth) |
| B6 | `admin-rc-review-soft-lock` | POST /api/v1/admin/rc-review/{submissionId}/lock | UC-SM02 step 3 | API Gateway (admin auth) |
| B7 | `admin-rc-review-decide` | POST /api/v1/admin/rc-review/{submissionId}/decide | UC-SM02 step 7-9 | API Gateway (admin auth) |
| B8 | `pool-listing-create` | POST /api/v1/listings (extended) | UC-SM01 | API Gateway |
| B9 | `pool-bay-update` | PATCH /api/v1/listings/{poolId}/bays/{bayId} | UC-SM01 step 6 | API Gateway |
| B10 | `pool-bay-list` | GET /api/v1/listings/{poolId}/bays | UC-SM03, portfolio dashboard | API Gateway |
| B11 | `booking-bay-swap` | POST /api/v1/bookings/{bookingId}/swap-bay | UC-SM03 | API Gateway |
| B12 | `spot-manager-portfolio` | GET /api/v1/spot-manager/portfolio | UC-SM04 | API Gateway |
| B13 | `rc-expiry-reminder-30d` | (event-driven) | UC-SM05 30d reminder | EventBridge Scheduler |
| B14 | `rc-expiry-reminder-7d` | (event-driven) | UC-SM05 7d reminder | EventBridge Scheduler |
| B15 | `rc-expiry-suspend` | (event-driven) | UC-SM05 suspend | EventBridge Scheduler |

---

### B1 — `rc-submission-create`

**Endpoint:** `POST /api/v1/spot-manager/rc-submissions`
**Auth:** Required (Cognito JWT, must be a Host with Stripe Connect enabled)
**Implements:** UC-SM00 main flow steps 8-12

**Tests first:** `backend/__tests__/spot-manager/rc-submission-create.test.ts`

```typescript
import { handler } from '../../src/functions/spot-manager/rc-submission-create';
import { mockAuthEvent } from '../helpers/mock-auth-event';
import { resetDynamoMock, getDynamoItem, seedUserProfile } from '../helpers/dynamo-mock';
import { resetEventBridgeMock, getPublishedEvents } from '../helpers/eventbridge-mock';
import { resetSESMock, getSentEmails } from '../helpers/ses-mock';

beforeEach(() => {
  resetDynamoMock();
  resetEventBridgeMock();
  resetSESMock();
});

describe('rc-submission-create', () => {
  const validBody = {
    insurer: 'AXA Belgium',
    policyNumber: 'POL-2026-12345',
    expiryDate: '2027-04-15',
    documentS3Key: 'rc-uploads/user-1/2026-04-10-abc.pdf',
    documentMimeType: 'application/pdf',
    documentSizeBytes: 524288,
    checklistAcceptance: {
      reliableAccess: true,
      stableInstructions: true,
      chatResponseCommitment: true,
      suspensionAcknowledged: true,
    },
    tcsVersionAccepted: '2026-04-v1',
  };

  test('happy path — creates RCSUBMISSION#, sets STAGED status, schedules nothing yet', async () => {
    await seedUserProfile('user-1', { stripeConnectEnabled: true, spotManagerStatus: 'NONE' });

    const result = await handler(mockAuthEvent('user-1', { body: validBody }));
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.submissionId).toMatch(/^[0-9A-Z]{26}$/);   // ULID
    expect(body.status).toBe('PENDING_REVIEW');

    // RCSUBMISSION# record exists
    const submission = await getDynamoItem('USER#user-1', `RCSUBMISSION#${body.submissionId}`);
    expect(submission.insurer).toBe('AXA Belgium');
    expect(submission.policyNumber).toBe('POL-2026-12345');
    expect(submission.status).toBe('PENDING_REVIEW');
    expect(submission.checklistAcceptance.reliableAccess).toBe(true);

    // USER PROFILE updated
    const profile = await getDynamoItem('USER#user-1', 'PROFILE');
    expect(profile.spotManagerStatus).toBe('STAGED');
    expect(profile.blockReservationCapable).toBe(false);
    expect(profile.rcInsuranceStatus).toBe('PENDING_REVIEW');
    expect(profile.currentRCSubmissionId).toBe(body.submissionId);

    // Review queue projection written
    const queueProjection = await getDynamoItem('RC_REVIEW_QUEUE', expect.stringMatching(/^PENDING#/));
    expect(queueProjection.submissionId).toBe(body.submissionId);

    // EventBridge event published
    const events = getPublishedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].DetailType).toBe('rc.submission.created');

    // Confirmation email sent
    const emails = getSentEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0].template).toBe('rc-submission-confirmation');
  });

  test('rejects user without Stripe Connect (403 STRIPE_CONNECT_REQUIRED)', async () => {
    await seedUserProfile('user-1', { stripeConnectEnabled: false });
    const result = await handler(mockAuthEvent('user-1', { body: validBody }));
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error).toBe('STRIPE_CONNECT_REQUIRED');
  });

  test('rejects unknown insurer with 400 INVALID_INSURER', async () => {
    await seedUserProfile('user-1', { stripeConnectEnabled: true });
    const result = await handler(mockAuthEvent('user-1', { body: { ...validBody, insurer: 'Acme Insurance' } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('INVALID_INSURER');
  });

  test('rejects expiry in the past with 400 EXPIRY_DATE_IN_PAST', async () => {
    await seedUserProfile('user-1', { stripeConnectEnabled: true });
    const result = await handler(mockAuthEvent('user-1', { body: { ...validBody, expiryDate: '2025-01-01' } }));
    expect(result.statusCode).toBe(400);
  });

  test('accepts near-expiry policy (under 30 days) with warning in response', async () => {
    await seedUserProfile('user-1', { stripeConnectEnabled: true });
    const result = await handler(mockAuthEvent('user-1', { body: { ...validBody, expiryDate: '2026-04-25' } }));
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).warnings).toContain('POLICY_NEAR_EXPIRY');
  });

  test('rejects unchecked checklist with 400 CHECKLIST_INCOMPLETE', async () => {
    await seedUserProfile('user-1', { stripeConnectEnabled: true });
    const result = await handler(mockAuthEvent('user-1', {
      body: { ...validBody, checklistAcceptance: { ...validBody.checklistAcceptance, reliableAccess: false } },
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('CHECKLIST_INCOMPLETE');
  });

  test('resubmission preserves prior submissions in audit log', async () => {
    await seedUserProfile('user-1', {
      stripeConnectEnabled: true,
      spotManagerStatus: 'STAGED',
      rcInsuranceStatus: 'REJECTED',
    });
    // First submission already exists
    await seedRCSubmission('user-1', { submissionId: 'old-sub-1', status: 'REJECTED' });

    const result = await handler(mockAuthEvent('user-1', { body: validBody }));
    expect(result.statusCode).toBe(201);

    // Old submission still exists
    const old = await getDynamoItem('USER#user-1', 'RCSUBMISSION#old-sub-1');
    expect(old).toBeDefined();
    expect(old.status).toBe('REJECTED');

    // New submission created
    const newId = JSON.parse(result.body).submissionId;
    const newSub = await getDynamoItem('USER#user-1', `RCSUBMISSION#${newId}`);
    expect(newSub).toBeDefined();
    expect(newSub.status).toBe('PENDING_REVIEW');

    // Profile updated to point at new submission
    const profile = await getDynamoItem('USER#user-1', 'PROFILE');
    expect(profile.currentRCSubmissionId).toBe(newId);
    expect(profile.rcInsuranceStatus).toBe('PENDING_REVIEW');
  });
});
```

Implementation notes:
- Use `ulid()` for the submissionId.
- Validate insurer, policyNumber, expiryDate, document, and checklist using PART A helpers.
- Look up the USER# PROFILE first to enforce the Stripe Connect prerequisite.
- Use a TransactWriteItems to atomically write three things: the new RCSUBMISSION# row, the USER# PROFILE update (`spotManagerStatus = STAGED`, `rcInsuranceStatus = PENDING_REVIEW`, `currentRCSubmissionId = submissionId`), and the RC_REVIEW_QUEUE projection row.
- After the write succeeds, publish the EventBridge `rc.submission.created` event AND send the confirmation email.
- DO NOT update `blockReservationCapable` here — that flag stays false until admin approval.

---

### B2 — `rc-submission-presign-upload`

**Endpoint:** `POST /api/v1/spot-manager/rc-submissions/presign`
**Auth:** Required
**Implements:** UC-SM00 step 4 — secure RC document upload to S3

Returns a presigned PUT URL that the frontend uses to upload directly to S3 with server-side encryption. This avoids streaming the document through API Gateway (which has a 10 MB request body limit anyway).

**Tests first:** Cover:
- Happy path — returns presigned URL with the right expiry, S3 key under `rc-uploads/{userId}/{timestamp}-{ulid}.{ext}`
- Rejects invalid mime type
- Rejects oversize file declaration
- Sets ServerSideEncryption to AES256 in the presigned URL params

Implementation: standard S3 presigned PUT with `ContentType` and `ContentLength` constraints set in the policy. The bucket has SSE-S3 enforced via bucket policy as a defense-in-depth.

---

### B3 — `rc-submission-get`

**Endpoint:** `GET /api/v1/spot-manager/rc-submissions/{submissionId}`
**Auth:** Required (owner OR admin)
**Implements:** UC-SM00, UC-SM02 — fetch submission detail

Returns the full submission record. For non-admin requests, the document S3 key is returned but the URL is also presigned for short-lived (5 minute) GET access. For admin requests, the URL is presigned similarly but the access is logged in the audit log.

**Tests first:** Cover:
- Owner can fetch their own submission
- Admin can fetch any submission
- Non-owner non-admin gets 403
- Returns 404 for non-existent submission
- Document URL is presigned and short-lived
- Admin fetch is logged with adminUserId and timestamp

---

### B4 — `rc-submission-list-mine`

**Endpoint:** `GET /api/v1/spot-manager/rc-submissions/mine`
**Auth:** Required
**Implements:** Spot Manager dashboard — show the user's submission history

Returns the list of all RCSUBMISSION# rows for the authenticated user, sorted by `createdAt` descending. Includes the current active submission first (the one referenced by `USER#PROFILE.currentRCSubmissionId`) and historical superseded/rejected ones after.

**Tests first:** Cover:
- Returns all submissions for the owner
- Sorted by createdAt descending
- Empty list returns empty array (not 404)

Implementation: Query `PK = USER#{userId} BEGINS_WITH RCSUBMISSION#`. No pagination needed (Hosts will rarely have more than 5 submissions in their history).

---

### B5 — `admin-rc-review-list`

**Endpoint:** `GET /api/v1/admin/rc-review?status=PENDING_REVIEW&sort=fifo`
**Auth:** Admin Cognito group
**Implements:** UC-SM02 main flow step 1

Returns the list of pending RC submissions in FIFO order. Each row includes the SLA counter computed from `businessHoursBetween(submission.createdAt, now)` — flagged red if approaching the 72-hour SLA (>60h).

**Tests first:** Cover:
- Returns rows in FIFO order (oldest createdAt first)
- Each row includes `slaHoursElapsed` and `slaHoursRemaining` computed via `businessHoursBetween`
- Rows approaching SLA are flagged with `slaWarning: true` (>60 hours elapsed)
- Filters by status (default PENDING_REVIEW + CLARIFICATION_REQUESTED waiting-on-host sub-queue)
- 403 for non-admin
- Includes the soft-lock indicator if another admin currently has the submission locked

Implementation: Single Query on `PK = RC_REVIEW_QUEUE BEGINS_WITH PENDING#`. For each result, compute the SLA fields client-side using the business-hours helper. Additionally, do a BatchGetItem on `RC_SOFT_LOCK#{submissionId}` for each submissionId to populate the lock indicator.

---

### B6 — `admin-rc-review-soft-lock`

**Endpoint:** `POST /api/v1/admin/rc-review/{submissionId}/lock`
**Auth:** Admin Cognito group
**Implements:** UC-SM02 step 3 — soft-lock acquisition

Acquires the 15-minute soft-lock for the admin opening a submission. Refreshes if the same admin already has it. Returns 409 if a different admin holds the lock.

**Tests first:**
- Happy path — writes RC_SOFT_LOCK# row with lockedBy = admin's userId, lockedAt = now, expiresAt = now + 15min, TTL = expiresAt + 60s
- Refresh by same admin updates lockedAt and expiresAt
- 409 LOCK_HELD if a different admin currently holds the lock
- Lock auto-expires after 15 minutes (DynamoDB TTL handles cleanup)

Implementation: ConditionalUpdateItem with `attribute_not_exists(submissionId) OR lockedBy = :adminId OR expiresAt < :now`. The condition allows new locks, refreshes, and grabbing expired locks.

---

### B7 — `admin-rc-review-decide`

**Endpoint:** `POST /api/v1/admin/rc-review/{submissionId}/decide`
**Auth:** Admin Cognito group
**Implements:** UC-SM02 main flow steps 7-12 + Alt Flow A (clarification) + Alt Flow B (rejection)

Body shape:
```typescript
{
  decision: 'APPROVE' | 'REJECT' | 'CLARIFY',
  reviewerNote?: string,         // optional for APPROVE, required for CLARIFY
  rejectionReason?: 'EXPIRED_POLICY' | 'ILLEGIBLE_DOCUMENT' | 'WRONG_INSURANCE_TYPE' | 'NAME_MISMATCH' | 'OTHER',  // required for REJECT
}
```

This is the most complex Lambda in the session. On APPROVE it must:
1. Verify the soft-lock is held by the calling admin
2. Update RCSUBMISSION#: status = APPROVED, reviewedBy, reviewedAt, reviewerNote
3. Update USER# PROFILE: `blockReservationCapable = true`, `rcInsuranceStatus = APPROVED`, `rcInsuranceExpiryDate = submission.expiryDate`, `rcInsuranceApprovedAt = now`, `spotManagerStatus = ACTIVE` (transition from STAGED)
4. If there's a previously approved RCSUBMISSION#, mark it `status = SUPERSEDED, supersededBy = submissionId` and delete its EventBridge Scheduler rules (the 30d/7d/suspend ones)
5. Schedule three new EventBridge Scheduler rules: `rc-expiry-reminder-30d-{submissionId}`, `rc-expiry-reminder-7d-{submissionId}`, `rc-expiry-suspend-{submissionId}` against the new expiry date
6. Delete the RC_REVIEW_QUEUE projection row
7. Release the soft-lock
8. Send the approval email to the Host
9. Append an entry to the submission's audit log

On REJECT it must:
1. Verify soft-lock
2. Update RCSUBMISSION#: status = REJECTED, rejectionReason, reviewerNote, reviewedBy, reviewedAt
3. Update USER# PROFILE: `rcInsuranceStatus = REJECTED` (but spotManagerStatus stays STAGED — not downgraded)
4. Delete the RC_REVIEW_QUEUE projection row
5. Release the soft-lock
6. Send the rejection email with the specific reason

On CLARIFY it must:
1. Verify soft-lock
2. Update RCSUBMISSION#: status = CLARIFICATION_REQUESTED, reviewerNote, reviewedBy, reviewedAt
3. Move the projection from `PENDING#{createdAt}#{submissionId}` to `CLARIFICATION#{createdAt}#{submissionId}` (waiting-on-host sub-queue)
4. Release the soft-lock
5. Send the clarification email

**Tests first:** Cover all three decision paths plus:
- 409 LOCK_NOT_HELD if the calling admin doesn't hold the soft-lock
- 409 INVALID_STATE if the submission is not in PENDING_REVIEW or CLARIFICATION_REQUESTED
- APPROVE → reviewerNote optional, status transitions correctly, reschedules EventBridge rules
- APPROVE renewal → previous APPROVED submission marked SUPERSEDED, old EventBridge rules deleted
- REJECT → requires rejectionReason, sends email with the reason interpolated
- CLARIFY → requires reviewerNote, moves to clarification sub-queue
- Approval triggers email to Host with the right deep link
- Approval schedules exactly 3 EventBridge Scheduler rules with the correct timing

Implementation notes:
- Use a TransactWriteItems for the multi-record update (submission + profile + queue projection delete + soft-lock release).
- The EventBridge Scheduler API calls are NOT inside the transaction — they happen after the DynamoDB write. If a Scheduler call fails after a successful DynamoDB write, log the error and let an admin retry from the backoffice. This is the same pattern as Session 27's block-accept-plan.
- For renewals (case where a previous APPROVED submission exists), use a separate UpdateItem to mark it SUPERSEDED + a DeleteSchedule call for each of its three rules. Wrap the schedule deletes in try/catch since rules may have already fired.
- The SLA counter is computed at decision time and stored in the audit log entry as `slaHoursElapsed` for reporting.

---

### B8 — `pool-listing-create`

**Endpoint:** `POST /api/v1/listings` (this extends the existing `listing-create` Lambda from Session 02)
**Auth:** Required (must have `spotManagerStatus = STAGED` or `ACTIVE` if `isPool = true` in the body)
**Implements:** UC-SM01 main flow

This Lambda is an EXTENSION of the existing `listing-create` from Session 02. Add a new branch: if `body.isPool === true`, validate the additional fields (`bayCount`, `bayLabels` array), enforce the Spot Manager prerequisite, and write both the parent LISTING# row and N child BAY# rows in a single TransactWriteItems.

**Tests first:** Cover:
- Pool creation by an active Spot Manager — happy path writes LISTING# with `isPool = true, bayCount = N, blockReservationsOptedIn = false` plus N BAY# children with auto-generated labels
- Pool creation by a STAGED Spot Manager — also works (bay management is in the staged grant)
- Pool creation by a Host without Spot Manager status — 403 SPOT_MANAGER_REQUIRED
- bayCount of 1 → 400 BAY_COUNT_TOO_LOW
- bayCount of 201 → 400 BAY_COUNT_TOO_HIGH
- Photos under 2 → 400 INSUFFICIENT_PHOTOS
- Custom bay labels passed in → bays use those labels instead of "Bay 1".."Bay N"
- Per-bay access instructions passed in → stored on the BAY# rows
- TransactWriteItems atomicity — if BAY# write fails, the LISTING# is also rolled back

Implementation:
- Branch on `body.isPool === true` early in the handler.
- For non-pool listings, fall through to the existing single-spot listing logic from Session 02.
- For pool listings, validate `bayCount`, ensure the Host has Spot Manager status, and build the BAY# child rows. If `body.bayLabels` is provided, use those (validating uniqueness within the pool). Otherwise call `generateBayLabel(i)` for each.
- DynamoDB TransactWriteItems supports up to 100 items. For pools larger than 99 bays, chunk into multiple TransactWriteItems with the LISTING# row in the first chunk only and a marker that the BAY# writes are in-flight.
- The new pool row has `blockReservationsOptedIn = false` by default — Spot Managers must explicitly opt in via a separate endpoint after the listing is created (this avoids accidentally exposing pools to block reservations during initial setup).

---

### B9 — `pool-bay-update`

**Endpoint:** `PATCH /api/v1/listings/{poolId}/bays/{bayId}`
**Auth:** Required (must own the pool listing)
**Implements:** UC-SM01 step 6 — customise bay labels and access instructions

Body:
```typescript
{
  label?: string,                    // override the auto-generated label
  accessInstructions?: string,       // per-bay override; null clears it
  status?: 'ACTIVE' | 'TEMPORARILY_CLOSED' | 'PERMANENTLY_REMOVED',
}
```

**Tests first:** Cover:
- Owner can update label
- Owner can clear accessInstructions by passing null
- Status change to TEMPORARILY_CLOSED triggers a check for active bookings on this bay — if any, return 409 BAY_HAS_ACTIVE_BOOKINGS
- PERMANENTLY_REMOVED requires no active OR upcoming bookings (similar check)
- Non-owner gets 403
- Updating a non-existent bay returns 404
- Label uniqueness within the pool is enforced

---

### B10 — `pool-bay-list`

**Endpoint:** `GET /api/v1/listings/{poolId}/bays`
**Auth:** Required (owner OR public)
**Implements:** UC-SM03 + portfolio dashboard + booking flow bay assignment

Returns all BAY# rows for a pool listing, optionally filtered by status. For the public consumption (booking flow), only ACTIVE bays are returned and sensitive fields like `accessInstructions` are stripped. For the owner, all fields and statuses are returned.

**Tests first:** Cover:
- Owner sees all bays with all fields
- Public sees only ACTIVE bays without accessInstructions
- Filter by status works for the owner
- Returns empty array (not 404) if the pool exists but has no bays (defensive — shouldn't happen in practice)

Implementation: Query on `PK = LISTING#{poolId} BEGINS_WITH BAY#`. Auth check: if the JWT subject matches the pool's `ownerUserId`, return everything; otherwise return the public projection.

---

### B11 — `booking-bay-swap`

**Endpoint:** `POST /api/v1/bookings/{bookingId}/swap-bay`
**Auth:** Required (must be the Spot Manager who owns the pool containing the booking)
**Implements:** UC-SM03 main flow

Body: `{ targetBayId: 'bay-N' }`

This Lambda swaps a Spotter's assignment from one bay to another within the same pool, without modifying the booking ID, dates, price, or Spotter identity.

**Tests first:** Cover:
- Happy path — booking's `poolSpotId` updates to targetBayId, audit log entry appended, silent notification sent to Spotter
- Target bay must be free for the entire booking window (uses the existing availability resolver from Session 12)
- Cannot swap to a bay in a different pool — returns 400 CROSS_POOL_SWAP_NOT_ALLOWED
- Non-owner gets 403
- Booking ID, dates, price, Spotter identity, status all unchanged after swap
- The silent notification email contains only the new access instructions, not a "your booking changed" framing
- Swap during an active booking is allowed (UC-SM03 alternative flow B for the auto-swap trigger)
- Multiple swaps on the same booking are allowed and each is independently logged

Implementation:
- Load the booking + the source pool listing + verify the JWT subject is the pool owner.
- Validate the target bay is in the same pool (`BAY#{targetBayId}` exists under `LISTING#{poolListingId}`).
- Check availability: query the existing availability resolver for `bayId = targetBayId` over the booking window. If any conflict, return 400 BAY_NOT_AVAILABLE.
- UpdateItem on the booking to set `poolSpotId = targetBayId` and append to the booking's audit log.
- Send the silent notification email with the new access instructions (template: `bay-swap-notification`).

---

### B12 — `spot-manager-portfolio`

**Endpoint:** `GET /api/v1/spot-manager/portfolio`
**Auth:** Required (must have spotManagerStatus = STAGED or ACTIVE)
**Implements:** UC-SM04 main flow

Returns the consolidated portfolio view: total spots under management, current occupancy, MTD earnings, all-time earnings, active bookings, upcoming bookings, plus a per-listing breakdown.

**Tests first:** Cover:
- Returns aggregate metrics across all listings owned by the user
- Includes both pool listings and single-spot listings
- Per-listing breakdown shows occupancy + MTD earnings per listing
- Drill-down per pool returns the bay-level status grid
- Empty state (Spot Manager with no listings yet) returns zeros and empty arrays
- Non-Spot-Manager gets 403

Implementation: Query the user's listings (existing pattern from Session 02), then for each listing query active + upcoming bookings (existing patterns from Session 03). For pool listings, also Query the BAY# children to compute the per-bay status grid. The response is a single composed object — no pagination since Spot Managers typically have under 50 listings.

---

### B13 — `rc-expiry-reminder-30d` Lambda

**Trigger:** EventBridge Scheduler rule `rc-expiry-reminder-30d-{submissionId}` firing at `expiryDate − 30 days`
**Implements:** UC-SM05 30-day reminder branch

**Tests first:** Cover:
- Happy path — sends email + in-app notification, writes RCREMINDER# log with sentAt, returns success
- Skips when submission is no longer APPROVED (e.g. SUPERSEDED) — writes log with sentAt = null, skipReason = SUPERSEDED, deletes the EventBridge rule
- Defensive: skips when user no longer has spotManagerStatus = ACTIVE (e.g. account deleted)
- Idempotent on re-fire — if the reminder has already been sent for this submissionId/type, no-op

Implementation:
- Read the BLOCKREQ-equivalent: load `USER#{userId}/RCSUBMISSION#{submissionId}` and `USER#{userId}/PROFILE`.
- If submission status is not APPROVED, write a skip log and call `DeleteSchedule` to clean up the rule.
- Otherwise send the email via SES (template: `rc-expiry-reminder-30d`) and an in-app notification (extending the notifications system from Session 05).
- Write the RCREMINDER# log row with `sentAt = now`, `channel = BOTH`, `type = 30_DAY_REMINDER`.

---

### B14 — `rc-expiry-reminder-7d` Lambda

**Trigger:** EventBridge Scheduler rule `rc-expiry-reminder-7d-{submissionId}` firing at `expiryDate − 7 days`
**Implements:** UC-SM05 7-day reminder branch

Identical structure to B13 but with the more urgent email template (`rc-expiry-reminder-7d`) and the 7_DAY_REMINDER eventType.

**Tests first:** Same shape as B13.

---

### B15 — `rc-expiry-suspend` Lambda

**Trigger:** EventBridge Scheduler rule `rc-expiry-suspend-{submissionId}` firing at `expiryDate` 00:00 Brussels time
**Implements:** UC-SM05 expiry suspend branch

This Lambda flips `blockReservationCapable` to false, sets `rcInsuranceStatus = EXPIRED`, leaves `spotManagerStatus = ACTIVE` unchanged, and writes an RCSUSPEND# log row with the snapshot of affected listing IDs.

**Tests first:** Cover:
- Happy path — flips the flag, writes the log, sends the email + in-app
- Skips when submission is no longer APPROVED (already renewed) — deletes the rule, no-op
- Existing committed BLOCKALLOC# records are NOT touched (verify the test seeds some and they're untouched after the suspend runs)
- Pool listings remain visible to single-shot Spotters (verify by querying with the public listing fetcher)
- The block-match Lambda (Session 27) skips this Spot Manager's pools after suspension (verify by running a match against the suspended Spot Manager's pools and confirming no plan includes them)

Implementation:
- Load the submission and profile.
- If the submission is no longer APPROVED, delete the rule and exit.
- Query the user's pool listings with `isPool = true AND blockReservationsOptedIn = true` to capture the affected listing IDs for the audit log.
- TransactWriteItems: update the profile, write the RCSUSPEND# log row.
- Send the suspension email and in-app notification.
- Do NOT update any BLOCKALLOC# records — those are explicitly preserved by UC-SM05's "Existing contract honouring" rule.

---

## PART C — Frontend screens

All Spot Manager frontend screens go in `frontend/app/spot-manager/` and `frontend/app/admin/rc-review/` (admin side). They follow the design system from UIUX v10.

### C1 — Navigation: Portfolio tab + persona switcher

**File:** `frontend/components/Navigation.tsx`

Add a "Portfolio" top-level tab that appears only when `activePersona === 'SPOT_MANAGER'` (driven by the persona switcher) OR when the user has `spotManagerStatus = STAGED` or `ACTIVE`. The tab links to `/spot-manager/portfolio`.

Add Spot Manager to the persona switcher dropdown (the small persona pill next to the avatar). The switcher already exists from the v9 → v10 navigation extension; this adds Spot Manager to the list of switchable personas for any user with `spotManagerStatus !== NONE`.

**Tests first:** `frontend/__tests__/navigation/spot-manager-tab.test.tsx`

### C2 — UC-SM00: Commitment Gate

**Route:** `/account/spot-manager/apply`
**Component:** `frontend/app/account/spot-manager/apply/page.tsx`

Three-step wizard. Each step is a separate sub-component to keep the file size manageable.

**Tests first:** `frontend/__tests__/spot-manager/commitment-gate.test.tsx`

- Step 1 — Insurance: file upload component (drag-and-drop with PDF/JPEG/PNG accept, 10 MB max client-side check), Belgian RC insurer dropdown sourced from a hardcoded constant matching the backend list, policy number text input (max 100 chars), expiry date picker. Inline validation errors. "Other (please specify)" insurer option triggers a longer free-text helper.
- Step 1 → Step 2 transition disabled until all fields valid AND file uploaded successfully (presigned URL upload completes with HTTP 200 from S3).
- Step 2 — Access checklist: 4 checkbox cards. Each card has a heading and a one-line clarification. "Continue" button disabled until all 4 are checked.
- Step 3 — T&Cs: scrollable container with the Spot Manager T&Cs text. Scroll position tracking — "I have read and accept" checkbox is disabled until the user has scrolled to within 50px of the bottom. "Accept and submit" button disabled until checkbox is checked.
- Submission flow: POSTs to `/api/v1/spot-manager/rc-submissions`, navigates to success screen on 201, shows inline error banner on 4xx/5xx.
- Success screen: large forest checkmark, "Your application is in review", explainer that Spot Manager features are unlocked immediately, block reservations after admin approval (typically within 72 business hours), CTA "Go to portfolio".
- Resume flow: if browser session storage has `spotManagerOnboardingState`, the wizard offers a "Resume application" banner on first load that restores the last-completed step.
- Re-submission flow: if the user has a REJECTED submission, the wizard pre-fills the form with the previous values and shows the rejection reason at the top.

### C3 — UC-SM01: Create a Spot Pool

**Route:** `/listings/new` (extended from the existing UC-H01 listing creation flow)
**Component:** Add a new step to the existing listing wizard: `frontend/app/listings/new/PoolStep.tsx`

The existing UC-H01 wizard (from Session 02 frontend + Session 13 deltas) gets a new mode toggle at the very first step: "Single Spot" / "Spot Pool". The toggle is only visible to users with `spotManagerStatus = STAGED` or `ACTIVE`.

When "Spot Pool" is selected, the wizard inserts two new steps between "Photos" (UC-H01 step 4) and "Pricing" (UC-H01 step 5):

**Pool capacity step**: numeric stepper labelled "Number of bays" with min=2, max=200. Helper text: "You can label and customise individual bays in the next step."

**Bay editor step**: vertical list of N bay rows where N matches the capacity. Each row:
- Bay number (auto-generated, e.g. "Bay 1")
- Editable label field (placeholder shows the auto label, accepting a custom label like "A-3" or "North wall")
- Optional access instructions textarea (collapsed by default, expand on click)
- Drag handle on the left for reordering (re-numbering happens automatically on drop)

The submit at the end of the wizard POSTs to `/api/v1/listings` with `isPool: true, bayCount: N, bayLabels: [...], bayAccessInstructions: [...]`.

**Tests first:** `frontend/__tests__/spot-manager/pool-create.test.tsx`

- Mode toggle visible only to Spot Managers
- Capacity stepper enforces 2–200
- Bay editor renders N rows
- Custom label override works
- Drag-and-drop reordering updates the row order and the auto-numbering
- Per-bay access instructions toggle expands and persists
- Submit posts to the right endpoint with the right body shape
- Success navigates to the new listing detail page

### C4 — UC-SM02: RC Insurance Review (admin side)

**Route:** `/admin/rc-review`
**Components:**
- `frontend/app/admin/rc-review/page.tsx` — queue list
- `frontend/app/admin/rc-review/[submissionId]/page.tsx` — review detail

Admin-only — the route is wrapped in the admin guard from Session 20.

**Queue list page:**
- Two-pane layout on desktop (queue list left, optional preview right). On mobile: queue list with full-screen drill-down.
- Each row shows: Host name, Host account creation date, insurer, policy number, expiry date, submission timestamp, time-in-queue counter (computed via the `slaHoursElapsed` field returned by the backend), and "Review" button.
- Rows >60h are highlighted with brick-red left accent bar and "Urgent" badge.
- Soft-lock indicator: rows currently being reviewed by another admin show the "Currently being reviewed by [admin name]" badge in slate, and clicking the row shows a read-only view rather than acquiring the lock.

**Review detail page:**
- On entry, POSTs to `/api/v1/admin/rc-review/{submissionId}/lock` to acquire the soft-lock. If the lock is held by someone else, shows the read-only banner.
- Document viewer at the top: embedded PDF.js for PDFs, native `<img>` for JPEG/PNG. Max-height 60vh, with download disabled (CSS `pointer-events: none` on the right-click menu and a `Content-Disposition: inline` header from the presigned URL).
- Metadata panel: Host profile (name, email, phone, billing address, VAT number), submission fields (insurer, policy number, expiry, checklist snapshot, T&Cs version).
- Action buttons: "Approve" (Primary Forest), "Request Clarification" (Slate outline), "Reject" (Brick), "Return to queue" (text link).
- Approve modal: optional reviewer note textarea, "Confirm approval" button.
- Reject modal: required rejection reason dropdown with the 5 fixed options + free-text note, "Confirm rejection" button.
- Clarify modal: required free-text message textarea (max 500 chars), "Send clarification request" button.
- On any decision: POSTs to `/api/v1/admin/rc-review/{submissionId}/decide`, shows success toast, navigates back to queue.
- Lock heartbeat: every 5 minutes while the page is open, the lock is refreshed by POSTing to the lock endpoint again.
- On navigate-away: best-effort POST to a release endpoint (or just let the lock expire).

**Tests first:** `frontend/__tests__/admin/rc-review.test.tsx`

### C5 — UC-SM03: Bay Swap Modal

**Component:** `frontend/components/spot-manager/BaySwapModal.tsx`

Modal triggered from the booking detail view in the Spot Manager portfolio (UC-SM04). Shows the current bay assignment, a list of available bays in the same pool with status indicators, and a confirm action.

**Tests first:**
- Current assignment summary card
- Available bays list (only bays in the SAME pool, with `status = ACTIVE` and no booking conflict for the current booking window)
- Selecting a bay enables the "Confirm swap" button
- Confirm posts to `/api/v1/bookings/{bookingId}/swap-bay`
- Success closes modal and shows toast
- Cross-pool swap warning (if the modal is opened from a context where multi-pool selection is exposed, which is currently NOT the case but the component should be defensive)

### C6 — UC-SM04: Portfolio Dashboard

**Route:** `/spot-manager/portfolio`
**Component:** `frontend/app/spot-manager/portfolio/page.tsx`

This is the Spot Manager's landing page (replacing the standard Host dashboard when their active persona is Spot Manager).

**Layout:** Mobile-first stacked, desktop uses a 3-column grid:
- Top row (full width): 4 metric cards — Active Pools, Total Bays, Bays Occupied Now, MTD Revenue
- Left column: Pool cards section — list of all spot pools owned by the user
- Middle column: Block contracts section — list of upcoming and active BLOCKALLOC# rows (data comes from Session 27 — gracefully handle the case where Session 27 isn't deployed yet)
- Right column: Settlement timeline — recent settled bookings and block contracts
- Above the metrics: RC insurance status banner (green if APPROVED, amber if expiring within 30 days, brick if expired)

**Tests first:** `frontend/__tests__/spot-manager/portfolio.test.tsx`

- Metric cards populated from the backend response
- Pool cards expand on click to show the bay-level grid
- Bay tiles show status (free / occupied / out-of-service)
- Block contracts section gracefully shows empty state if Session 27 isn't deployed
- RC banner color changes based on `rcInsuranceStatus` and the days until expiry
- "Create a Spot Pool" CTA navigates to `/listings/new` with the pool mode pre-selected
- "Renew RC insurance" CTA in the amber/brick banner navigates to `/account/spot-manager/apply` in renewal mode

### C7 — UC-SM05: Renewal & Expiry Banners

**Component:** `frontend/components/spot-manager/RCExpiryBanner.tsx` (used inline on the portfolio dashboard and the listing creation flow)

Renders one of three banner states based on `rcInsuranceStatus` and `rcInsuranceExpiryDate`:

- **APPROVED, expiry > 30 days away**: no banner
- **APPROVED, expiry 30 days to 7 days away**: amber banner with "Your RC insurance expires in [N] days. Renew to keep block reservations enabled." + "Renew" CTA
- **APPROVED, expiry < 7 days away**: brick-red banner with same copy but more urgent tone
- **EXPIRED**: persistent brick-red banner with "Your RC insurance has expired. Block reservations are suspended. Existing committed contracts are unaffected." + "Renew" CTA

The "Renew" CTA navigates to `/account/spot-manager/apply` with a query param `?mode=renewal&previousSubmissionId={id}` so the wizard pre-fills the form with the previous submission's values.

**Tests first:** `frontend/__tests__/spot-manager/rc-expiry-banner.test.tsx`

---

## PART D — CDK additions

### D1 — Lambda function definitions

Add 15 new Lambda definitions to `lib/api-stack.ts` (or a new `lib/spot-manager-stack.ts` if you prefer to keep the v2.x infrastructure isolated, mirroring the AgentStack pattern from architecture v10 §10.5):

```typescript
const rcSubmissionCreate = mkLambda('rc-submission-create', 'functions/spot-manager/rc-submission-create');
// ... 14 more
```

Wire each Lambda to the appropriate API Gateway route. The admin endpoints (B5, B6, B7) use the admin Cognito group authorizer from Session 20.

### D2 — S3 bucket for RC documents

Add a new bucket `spotzy-rc-documents-{env}` to `lib/data-stack.ts`:

```typescript
const rcDocumentsBucket = new s3.Bucket(this, 'RCDocumentsBucket', {
  bucketName: `spotzy-rc-documents-${this.envName}`,
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  enforceSSL: true,
  versioned: true,                                       // protects against accidental overwrites
  lifecycleRules: [
    {
      id: 'archive-old-rc-documents',
      enabled: true,
      transitions: [
        { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: cdk.Duration.days(90) },
        { storageClass: s3.StorageClass.GLACIER, transitionAfter: cdk.Duration.days(365) },
      ],
    },
  ],
});

// Grant the rc-submission-create and rc-submission-presign-upload Lambdas write access
// Grant the rc-submission-get and admin-rc-review-decide Lambdas read access
```

### D3 — EventBridge Scheduler permissions

Add an IAM policy to the Lambda execution role for the lambdas that create/delete schedules (`admin-rc-review-decide` for the approval flow, plus the three reminder/suspend Lambdas if they delete their own rules on skip):

```typescript
new iam.PolicyStatement({
  actions: [
    'scheduler:CreateSchedule',
    'scheduler:DeleteSchedule',
    'scheduler:UpdateSchedule',
    'scheduler:GetSchedule',
  ],
  resources: ['*'],
});
```

Create a shared `RCSchedulerRole` that EventBridge Scheduler assumes when invoking the target Lambdas. This role needs `lambda:InvokeFunction` for `rc-expiry-reminder-30d`, `rc-expiry-reminder-7d`, and `rc-expiry-suspend`.

### D4 — DynamoDB GSI additions

The session uses three reverse projections (`RC_REVIEW_QUEUE`, `RC_SOFT_LOCK#`, and the standard USER#-prefixed RCSUBMISSION#) — none require new GSIs. All Queries are single-PK lookups.

For the Spot Manager portfolio dashboard query that needs all listings owned by a user, the existing `USER#{userId}/LISTING#{listingId}` reverse projection from Session 02 already covers this. Verify it's in place before starting; if not, add it as part of this session.

### D5 — SES email templates

Add the following templates in `infrastructure/email-templates/`:

- `rc-submission-confirmation.html` — sent on UC-SM00 step 12
- `rc-submission-approved.html` — sent on UC-SM02 approval
- `rc-submission-rejected.html` — sent on UC-SM02 rejection (with the rejection reason interpolated)
- `rc-submission-clarification-requested.html` — sent on UC-SM02 clarification (with the admin's note interpolated)
- `rc-expiry-reminder-30d.html` — sent by B13
- `rc-expiry-reminder-7d.html` — sent by B14 (more urgent tone)
- `rc-expiry-suspended.html` — sent by B15
- `bay-swap-notification.html` — sent by B11 on bay swap (silent tone, access instructions only)

Each template uses the Spotzy brand header (forest #004526 band, white logo) and the standard footer.

### D6 — DynamoDB TTL on RC_SOFT_LOCK#

Enable DynamoDB TTL on the `expiresAtTtl` attribute of the `spotzy-main` table. The soft-lock records set `expiresAtTtl = floor(expiresAt / 1000) + 60` so the lock auto-cleans 60 seconds after its declared expiry. This is in addition to the application-level expiry check in B6 (the TTL is a safety net, not the primary mechanism).

### D7 — Belgian holiday calendar update task

Create a CDK custom resource or a yearly manual task to update the Belgian public holidays list in `business-hours.ts`. The 2026 and 2027 lists are baked into the constants for now, but a release in late 2027 needs to add 2028 dates. Document this in the deployment README.

---

## PART E — Integration tests

`backend/__tests__/integration/spot-manager.integration.test.ts`

End-to-end tests against DynamoDB Local covering the full Spot Manager lifecycle:

```typescript
describe('Spot Manager full lifecycle', () => {
  test('end-to-end: register → submit RC → admin approve → create pool → swap bay → renew', async () => {
    // 1. Seed a Host with Stripe Connect enabled
    await seedUserProfile('host-1', { stripeConnectEnabled: true, spotManagerStatus: 'NONE' });

    // 2. Submit RC insurance via UC-SM00
    const submitResult = await rcSubmissionCreate.handler(mockAuthEvent('host-1', { body: validRCBody }));
    expect(submitResult.statusCode).toBe(201);
    const { submissionId } = JSON.parse(submitResult.body);

    // Verify STAGED status
    let profile = await getDynamoItem('USER#host-1', 'PROFILE');
    expect(profile.spotManagerStatus).toBe('STAGED');
    expect(profile.blockReservationCapable).toBe(false);

    // 3. Admin acquires soft-lock and approves
    await adminRcReviewSoftLock.handler(mockAdminAuthEvent('admin-1', { pathParameters: { submissionId } }));
    const decideResult = await adminRcReviewDecide.handler(mockAdminAuthEvent('admin-1', {
      pathParameters: { submissionId },
      body: { decision: 'APPROVE', reviewerNote: 'Document is clear and policy is current' },
    }));
    expect(decideResult.statusCode).toBe(200);

    // Verify ACTIVE status and blockReservationCapable
    profile = await getDynamoItem('USER#host-1', 'PROFILE');
    expect(profile.spotManagerStatus).toBe('ACTIVE');
    expect(profile.blockReservationCapable).toBe(true);
    expect(profile.rcInsuranceExpiryDate).toBeDefined();

    // Verify EventBridge rules created (mocked)
    const rules = getCreatedSchedules();
    expect(rules).toHaveLength(3);
    expect(rules.map((r) => r.Name)).toContain(`rc-expiry-reminder-30d-${submissionId}`);
    expect(rules.map((r) => r.Name)).toContain(`rc-expiry-reminder-7d-${submissionId}`);
    expect(rules.map((r) => r.Name)).toContain(`rc-expiry-suspend-${submissionId}`);

    // 4. Create a Spot Pool
    const poolResult = await listingCreate.handler(mockAuthEvent('host-1', {
      body: {
        isPool: true,
        bayCount: 5,
        bayLabels: ['A1', 'A2', 'A3', 'B1', 'B2'],
        // ... rest of standard listing fields
      },
    }));
    expect(poolResult.statusCode).toBe(201);
    const { listingId: poolId } = JSON.parse(poolResult.body);

    // Verify the parent listing and 5 BAY# children
    const listing = await getDynamoItem(`LISTING#${poolId}`, 'METADATA');
    expect(listing.isPool).toBe(true);
    expect(listing.bayCount).toBe(5);
    const bays = await queryDynamo(`LISTING#${poolId}`, 'BAY#');
    expect(bays).toHaveLength(5);
    expect(bays.map((b) => b.label)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2']);

    // 5. Create a booking on bay A1 (using the existing booking-create from Session 03)
    const bookingResult = await bookingCreate.handler(mockAuthEvent('spotter-1', {
      body: { listingId: poolId, bayId: bays[0].bayId, startTime: '...', endTime: '...' },
    }));
    expect(bookingResult.statusCode).toBe(201);
    const { bookingId } = JSON.parse(bookingResult.body);

    // 6. Swap to bay A2 via UC-SM03
    const swapResult = await bookingBaySwap.handler(mockAuthEvent('host-1', {
      pathParameters: { bookingId },
      body: { targetBayId: bays[1].bayId },
    }));
    expect(swapResult.statusCode).toBe(200);

    // Verify booking poolSpotId updated, dates and price unchanged
    const booking = await getDynamoItem(`BOOKING#${bookingId}`, 'METADATA');
    expect(booking.poolSpotId).toBe(bays[1].bayId);

    // 7. Submit a renewal RC submission via UC-SM05
    const renewalResult = await rcSubmissionCreate.handler(mockAuthEvent('host-1', {
      body: { ...validRCBody, expiryDate: '2028-04-15' },  // new expiry
    }));
    expect(renewalResult.statusCode).toBe(201);
    const { submissionId: newSubmissionId } = JSON.parse(renewalResult.body);

    // 8. Admin approves the renewal
    await adminRcReviewSoftLock.handler(mockAdminAuthEvent('admin-1', { pathParameters: { submissionId: newSubmissionId } }));
    await adminRcReviewDecide.handler(mockAdminAuthEvent('admin-1', {
      pathParameters: { submissionId: newSubmissionId },
      body: { decision: 'APPROVE' },
    }));

    // Verify old submission marked SUPERSEDED
    const oldSubmission = await getDynamoItem('USER#host-1', `RCSUBMISSION#${submissionId}`);
    expect(oldSubmission.status).toBe('SUPERSEDED');
    expect(oldSubmission.supersededBy).toBe(newSubmissionId);

    // Verify profile points at the new submission
    profile = await getDynamoItem('USER#host-1', 'PROFILE');
    expect(profile.currentRCSubmissionId).toBe(newSubmissionId);
    expect(profile.rcInsuranceExpiryDate).toBe('2028-04-15');

    // Verify the old EventBridge rules were deleted and new ones created
    const finalRules = getCreatedSchedules();
    expect(finalRules.filter((r) => r.Name.includes(submissionId))).toHaveLength(0);     // old deleted
    expect(finalRules.filter((r) => r.Name.includes(newSubmissionId))).toHaveLength(3);  // new created
  });

  test('rejection flow preserves STAGED status', async () => { /* ... */ });
  test('clarification flow moves to waiting-on-host queue', async () => { /* ... */ });
  test('expiry reminder Lambda skips when submission is SUPERSEDED', async () => { /* ... */ });
  test('expiry suspend Lambda preserves committed BLOCKALLOC# records', async () => { /* ... */ });
  test('soft-lock prevents concurrent admin reviews', async () => { /* ... */ });
  test('soft-lock auto-expires after 15 minutes', async () => { /* ... */ });
});
```

---

## PART F — E2E tests (Playwright)

`e2e/spot-manager.spec.ts`

```typescript
test.describe('Spot Manager onboarding happy path', () => {
  test('Host completes commitment gate and creates a pool', async ({ page }) => {
    // Login as Host test user with Stripe Connect enabled
    // Navigate to /account/spot-manager/apply
    // Step 1: Upload a sample RC PDF, fill in insurer/policy/expiry
    // Step 2: Tick all 4 checklist boxes
    // Step 3: Scroll T&Cs to bottom, tick acceptance, submit
    // Verify success screen
    // Navigate to /spot-manager/portfolio
    // Verify "Pending review" banner shows
    // Click "Create a Spot Pool" CTA
    // Fill in pool wizard with bayCount=3
    // Customise bay labels: "Garage A", "Garage B", "Garage C"
    // Submit pool
    // Verify the new pool listing appears in portfolio
  });

  test('Admin reviews and approves a submission', async ({ page }) => {
    // Login as admin
    // Navigate to /admin/rc-review
    // Verify the test submission is in the queue
    // Click Review
    // Verify document viewer renders the PDF
    // Click Approve, confirm
    // Verify the submission moves out of the queue
    // Login as the Host (same browser context with persona switch)
    // Verify the "Pending review" banner is replaced by the active state
    // Verify "Block reservations enabled" indicator
  });

  test('Bay swap during active booking', async ({ page }) => { /* ... */ });
});
```

---

## PART G — Migration notes

### Existing data

Hosts who already have listings before Session 26 ships continue to operate as Hosts with `spotManagerStatus = NONE`. They are NOT auto-promoted. To become Spot Managers, they must explicitly go through UC-SM00. This is intentional — the commitment gate is a deliberate step, not an upgrade.

Existing single-spot listings are NOT migrated to pools. A Host who wants to convert an existing single-spot listing to a pool must archive the old listing and create a new pool listing from scratch.

### Session 23 (obsolete) coexistence

If Session 23 has been run in a development environment, the resulting `POOL#` and `POOL#/SPOT#` rows are stranded but harmless. No v2.x feature reads from those rows. They can be left in place or manually deleted via a one-time cleanup script — neither approach affects v2.x functionality.

### Session 27 (Block Spotter v2.x) prerequisites

Session 27 reads two things from this session:
1. The `LISTING#{poolId} BAY#{bayId}` entity model — block reservations allocate to specific bays via these records
2. The `USER#PROFILE.blockReservationCapable` flag — block-match Lambda filters out Spot Managers without it

Session 26 must be deployed and validated before Session 27 is run. Otherwise the Block Spotter feature has no pools to allocate against.

---

## Acceptance criteria for this session

A successful Claude Code run produces:

1. All 15 Lambda functions in `backend/src/functions/spot-manager/` with passing tests
2. Shared helpers in `backend/src/shared/spot-manager/` (constants, types, business-hours, validation, insurers)
3. Belgian business hours computation handles all the public holiday and weekend edge cases correctly
4. The commitment gate flow (UC-SM00) writes the right entities atomically and grants STAGED status immediately
5. The admin RC review flow (UC-SM02) supports approve/reject/clarify with the soft-lock concurrency model
6. Approval transitions STAGED → ACTIVE, sets `blockReservationCapable = true`, schedules 3 EventBridge rules, and supersedes any prior approved submission
7. Pool creation (UC-SM01) writes parent LISTING# + N child BAY# rows atomically
8. Bay swap (UC-SM03) preserves booking ID, dates, price, and Spotter identity
9. Portfolio dashboard (UC-SM04) returns the right aggregate metrics
10. Expiry reminder Lambdas (UC-SM05) handle the SUPERSEDED skip case correctly
11. Expiry suspend Lambda preserves existing committed BLOCKALLOC# rows and only blocks NEW matching
12. All 7 frontend screens (UC-SM00 through UC-SM05 plus admin review) are implemented and component-tested
13. The Portfolio navigation tab is persona-gated correctly
14. The integration test for the full lifecycle passes against DynamoDB Local
15. The Playwright E2E tests pass against staging
16. CDK synthesizes cleanly with all new Lambdas, S3 bucket, IAM policies, EventBridge Scheduler permissions, and SES templates
17. All UC-SM00 through UC-SM05 main flow steps have corresponding test coverage

### Open questions to resolve at implementation time

1. **Belgian holiday calendar maintenance** — the constants file ships with 2026 and 2027 hardcoded. A 2028 release needs to add 2028 dates manually OR pull from a public API at runtime. Recommendation: hardcoded annual update is fine for now (Belgian holidays are stable and known years in advance), bake into the release cycle.

2. **Document viewer security** — the admin RC review needs to render PDFs inline without exposing a downloadable URL. Using PDF.js with the presigned URL fetched server-side and streamed back as a data URI is the secure-but-slow option. Alternatively, the presigned URL can be set with `Content-Disposition: inline` and a very short expiry (60 seconds) to balance security and UX. Recommendation: the latter for the first cut.

3. **Soft-lock release on navigate-away** — browsers don't reliably fire `beforeunload` for SPAs. The 15-minute auto-expiry is the only guaranteed cleanup mechanism. Document this behaviour: admins navigating away from a review without deciding will block the submission for up to 15 minutes for other admins.

4. **Pool listing search behaviour** — when a Spotter searches for a parking spot, should pool listings be returned alongside single-spot listings? The functional specs say yes (UC-S01 v2.x extension shows the "X of N bays available" badge), but the behaviour requires the search Lambda from Session 02 to be updated. This is in scope for **Session 28 (Tiered Pricing + Platform Fee + Search Updates)**, not this session. Document the dependency.

5. **Auto-swap on bay closure (UC-SM03 Alt Flow B)** — if a Spot Manager toggles a BAY# to TEMPORARILY_CLOSED while it has an active booking, the system should attempt an automatic swap. This is currently NOT implemented in B9 (`pool-bay-update`). The Lambda just rejects the status change with `BAY_HAS_ACTIVE_BOOKINGS`. The auto-swap behaviour can be added in a follow-up session — flag this as a known limitation in the v2.x release notes.

---

## Reading order for Claude Code

When feeding this file to Claude Code, the recommended sequence is:

1. **PART A** — shared helpers in this order:
   - A1 + A2 (constants and types — pure declarations, no logic)
   - A3 + A4 (business-hours helper — most subtle pure logic, needs careful testing)
   - A5 + A6 (validation helpers)
2. **PART B** — Lambdas in this order:
   - B1 + B2 + B3 + B4 (RC submission CRUD)
   - B5 + B6 (admin queue + soft-lock — needed before B7)
   - B7 (admin decide — the most complex single Lambda)
   - B8 + B9 + B10 (pool listing + bay management)
   - B11 (booking bay swap — depends on the existing booking module from Session 03)
   - B12 (portfolio dashboard — composes data from B4, B10, plus existing booking queries)
   - B13 + B14 + B15 (expiry reminders and suspend — independent of each other but share template patterns)
3. **PART C** — frontend screens (can run in parallel with backend but needs the API contracts stable)
4. **PART D** — CDK additions (last, after all Lambdas are implemented)
5. **PART E** — integration tests
6. **PART F** — E2E tests

Don't try to write all 15 Lambdas in one shot. Work through them one at a time with the TDD red-green-refactor cycle on each. The most critical one is B7 (admin-rc-review-decide) — it has the most state transitions, the most external calls (EventBridge Scheduler, SES, multiple DynamoDB updates), and the most failure modes. Reserve a separate Claude Code session for B7 alone if needed.
