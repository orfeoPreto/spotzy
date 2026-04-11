# Session 27 — Block Spotter (v2.x)

## UC-BS01 · UC-BS02 · UC-BS03 · UC-BS04 · UC-BS05 · UC-BS06 · UC-BS07 · UC-BS08

> ⚠ **v2.x SCOPE** — Do not start until sessions 00–22, 26 (Spot Manager v2.x), and the tiered-pricing / platform-fee session are complete.
> Prerequisite sessions: 00–22, 26.
>
> **This session REPLACES the obsolete Session 24 (Corporate Guest).** Session 24 implemented a CORP#/MEMBER# bulk-booking model that does not match the v2.x functional specs. Block Spotter is the v2.x equivalent and uses an entirely different two-layer entity model (BLOCKREQ# → BLOCKALLOC# → BOOKING# grandchildren), the Stripe Option C deferred-single-authorisation flow, magic-link guest delivery, and a 3-tier cancellation policy. Do not run Session 24 alongside this one.

---

## What this session builds

The Block Spotter persona allows hotels, Airbnb hosts, event organisers, and other bulk reservation buyers to reserve a batch of parking bays from one or more Spot Pools through a structured contract called a Block Reservation. The flow runs from request submission through plan matching, plan acceptance with a €1 validation charge, deferred authorisation 7 days before window start, guest assignment, magic-link delivery, cancellation, and final settlement with per-allocation Stripe Connect transfers.

The Block Spotter persona is **additive** — any registered Spotzy user (Spotter, Host, Spot Manager) can become a Block Spotter by submitting their first block request. Unlike Spot Manager, there is no commitment gate. Soft verification is the only onboarding step: companyName + Belgian VAT number captured once and reused.

Architecturally this session adds a two-layer entity model on the existing `spotzy-main` DynamoDB table, a weighted greedy bulk allocator implemented as a pure function, four new Lambda functions covering the request lifecycle, three EventBridge Scheduler rule managers, a webhook handler for Stripe payment intent events, and the corresponding frontend screens.

**Architecture references** (must be open while implementing):
- Functional specs v21 §9 (UC-BS01 through UC-BS08, full spec text)
- Architecture v10 §5.19 (Block reservation matching pipeline and state machine)
- Architecture v10 §6.2 (Entity patterns for BLOCKREQ#, BLOCKALLOC#, BOOKING# under BLOCKALLOC#)
- Architecture v10 §8.2.1 (Stripe Option C lifecycle stages, idempotency keys, webhook events)
- Architecture v10 §10.5 (EventBridge Scheduler rules: block-auth-{reqId}, block-settle-{reqId}, guest-anonymise-{reqId})
- UIUX v10 Block Spotter Use Cases section (8 screen specs)

---

## Personas and glossary additions (v2.x)

- **Block Spotter**: A registered Spotzy user (any persona) who submits a block reservation request. Additive role — no opt-in gate, no commitment, no admin review.
- **Block Reservation**: A bulk multi-bay contract initiated by a Block Spotter and fulfilled across one or more Spot Pools. Persisted as a `BLOCKREQ#{reqId}` parent with one or more `BLOCKALLOC#{allocId}` children.
- **Block Allocation**: A sub-contract between a Block Reservation and one Spot Manager's Spot Pool. Captures the contributedBayCount, riskShareMode, riskShareRate, and snapshotted pricePerBayEur. Each BLOCKALLOC# eventually has zero or more BOOKING# grandchildren as guests are added.
- **Risk Share Mode**: A pool-level setting (configured by the Spot Manager on each pool listing) that determines how the Block Spotter pays for unallocated bays at settlement. Two modes: **PERCENTAGE** (Block Spotter pays 30% of the per-bay rate for any unfilled bay) and **MIN_BAYS_FLOOR** (Block Spotter pays full rate for at least 55% of contributedBayCount regardless of fill).
- **Worst-case amount**: The maximum amount the Block Spotter could owe — `sum(contributedBayCount × pricePerBayEur)` across all BLOCKALLOC# children. Authorised at T-7d, captured (in part or in full) at windowEnd.
- **Validation charge**: A €1 Stripe PaymentIntent created on plan acceptance and immediately voided. Proves the Block Spotter's payment method works.
- **Deferred authorisation**: The single Stripe `manual_capture` PaymentIntent placed at `windowStart − 7 days` for the worst-case amount. Held for up to 7 days, captured at windowEnd.
- **Magic link**: A signed JWT URL (`/claim/{token}`) emailed to each guest. First click provisions a stub Spotter user keyed on the guest email. Token expires 48 hours after windowEnd.

---

## Critical constants (must use these exact values)

```typescript
// Risk share rates — DO NOT CHANGE without coordination with the functional specs
export const PERCENTAGE_RATE = 0.30;        // PERCENTAGE mode: pay 30% of unfilled bay rate
export const MIN_BAYS_FLOOR_RATIO = 0.55;   // MIN_BAYS_FLOOR mode: pay for at least 55% of bays

// Window cap — paired with Stripe's 7-day authorisation expiry
export const MAX_WINDOW_DAYS = 7;
export const MIN_LEAD_TIME_HOURS = 24;       // startsAt must be at least 24h in the future

// Bay count bounds
export const MIN_BAY_COUNT = 2;
export const MAX_BAY_COUNT = 500;

// Authorisation timing
export const AUTH_OFFSET_DAYS = 7;           // Authorise at windowStart − 7 days
export const AUTH_FAILURE_GRACE_HOURS = 24;  // 24h to retry after T-7d failure

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
export const GUEST_ANONYMISE_OFFSET_HOURS = 48;  // After windowEnd

// Magic link token
export const MAGIC_LINK_TOKEN_TTL_HOURS = 48;    // After windowEnd
```

These constants live in `backend/src/shared/block-reservations/constants.ts`. Every Lambda in this session imports from there. Hard-coding any of these inline is a code review failure.

---

## DynamoDB schema additions

All on the existing `spotzy-main` table. No new tables.

```
PK: BLOCKREQ#{reqId}                     SK: METADATA
  reqId, ownerUserId, status (PENDING_MATCH | PLANS_PROPOSED | CONFIRMED | AUTHORISED | SETTLED | CANCELLED),
  cancellationReason (USER_CANCELLED_FREE | USER_CANCELLED_50PCT | AUTH_FAILED | USER_ABANDONED | SUPPORT_CANCELLED | null),
  startsAt (ISO), endsAt (ISO), bayCount (int),
  preferences {
    minPoolRating (number | null),
    requireVerifiedSpotManager (bool | null),
    noIndividualSpots (bool, default true),
    maxCounterparties (int | null),
    maxWalkingTimeFromPoint { minutes: int, lat: number, lng: number } | null,
    clusterTogether (bool | null)
  },
  pendingGuests [{ name, email, phone }] | null,
  companyNameSnapshot, vatNumberSnapshot,
  validationChargeId (Stripe PaymentIntent ID | null),
  authorisationId (Stripe PaymentIntent ID | null),
  authorisationRetryCount (int, default 0),
  proposedPlans [PlanSummary] | null,        // populated by block-match Lambda; cleared on edit/cancel
  proposedPlansComputedAt (ISO | null),
  acceptedPlanIndex (int | null),             // index into proposedPlans on acceptance
  settlementBreakdown { totalEur, capturedEur, refundedEur, perAllocation [{ allocId, contributedBayCount, allocatedBayCount, amountEur, platformFeeEur, transferId }] } | null,
  auditLog [{ timestamp, actorUserId, action, before, after }],
  createdAt, updatedAt

PK: USER#{userId}                        SK: BLOCKREQ#{reqId}
  → reverse-pattern projection for the Block Spotter dashboard listing.
  Same status, startsAt, endsAt, bayCount, lastUpdatedAt.

PK: BLOCKREQ#{reqId}                     SK: BLOCKALLOC#{allocId}
  allocId, poolListingId, spotManagerUserId,
  contributedBayCount (int — the CONTRACTED count, snapshotted on plan acceptance),
  allocatedBayCount (running counter — incremented as BOOKING# children are written),
  assignedBayIds (string[] — populated on plan acceptance via the availability resolver),
  riskShareMode (PERCENTAGE | MIN_BAYS_FLOOR),  // snapshotted from listing at acceptance
  riskShareRate (number),                       // snapshotted: 0.30 or 0.55
  pricePerBayEur (number),                      // snapshotted from tiered pricing function
  settlement {
    amountEur,
    platformFeePct (snapshotted at settlement),
    platformFeeEur,
    netToSpotManagerEur,
    transferId (Stripe Connect transfer ID),
    transferStatus (PENDING | CREATED | FAILED),
    settledAt
  } | null,
  createdAt, updatedAt

PK: LISTING#{poolListingId}              SK: BLOCKALLOC#{allocId}
  → reverse-pattern projection for Spot Manager portfolio queries.
  Same allocId, parentReqId, contributedBayCount, allocatedBayCount, startsAt, endsAt.

PK: BLOCKREQ#{reqId}                     SK: BOOKING#{bookingId}
  bookingId, allocId (parent BLOCKALLOC#), bayId, listingId (the pool listing ID — same across all bookings in this allocation),
  guestName, guestEmail, guestPhone,    // PII fields — anonymised at windowEnd + 48h
  spotterId (string | null — populated on first magic link click),
  emailStatus (PENDING | SENT | BOUNCED),
  emailSentAt, emailBouncedAt,
  allocationStatus (ALLOCATED | CANCELLED),
  source (BLOCK_RESERVATION),
  createdAt, updatedAt
```

**Rationale notes** (paraphrased from architecture v10 §6.2):
- The two-layer split (BLOCKREQ# parent, BLOCKALLOC# children) keeps all data for one block reservation under a single PK so settlement traversal is a single Query operation. The grandchild BOOKING# rows live under the same parent PK so the entire reservation can be loaded with one Query.
- The reverse projections (`USER#`/`BLOCKREQ#` and `LISTING#`/`BLOCKALLOC#`) support the Block Spotter dashboard and Spot Manager portfolio dashboard respectively, both of which need to list all BLOCKREQ# / BLOCKALLOC# rows for a given user or listing without scanning.
- BOOKING# children are NOT eagerly created on plan acceptance for the bays without pre-uploaded guests. They are materialised lazily as `block-guest-add` writes them. This sidesteps the DynamoDB 100-item TransactWriteItems limit for large blocks (e.g. a 200-bay reservation would otherwise hit the limit on confirmation).
- `assignedBayIds` on the BLOCKALLOC# is a string array populated at plan acceptance — these are the specific bayIds reserved for this block within the pool. They are removed from the pool's general availability for the entire window. As guests are added, each new BOOKING# is assigned one of these reserved bayIds by the bulk allocator.
- `riskShareMode` and `riskShareRate` are snapshotted on the BLOCKALLOC# at plan acceptance. Subsequent changes to the pool listing's risk share configuration do NOT affect existing allocations.

---

## PART A — Entity model and shared helpers

### A1 — Constants file

Create `backend/src/shared/block-reservations/constants.ts` with the exact constants from the "Critical constants" section above. Export all of them as named exports.

### A2 — Type definitions

Create `backend/src/shared/block-reservations/types.ts`:

```typescript
export type BlockRequestStatus =
  | 'PENDING_MATCH'
  | 'PLANS_PROPOSED'
  | 'CONFIRMED'
  | 'AUTHORISED'
  | 'SETTLED'
  | 'CANCELLED';

export type CancellationReason =
  | 'USER_CANCELLED_FREE'
  | 'USER_CANCELLED_50PCT'
  | 'AUTH_FAILED'
  | 'USER_ABANDONED'
  | 'SUPPORT_CANCELLED';

export type RiskShareMode = 'PERCENTAGE' | 'MIN_BAYS_FLOOR';

export interface BlockRequestPreferences {
  minPoolRating: number | null;
  requireVerifiedSpotManager: boolean | null;
  noIndividualSpots: boolean;
  maxCounterparties: number | null;
  maxWalkingTimeFromPoint: { minutes: number; lat: number; lng: number } | null;
  clusterTogether: boolean | null;
}

export interface PendingGuest {
  name: string;
  email: string;
  phone: string;
}

export interface BlockRequest {
  reqId: string;
  ownerUserId: string;
  status: BlockRequestStatus;
  cancellationReason: CancellationReason | null;
  startsAt: string;
  endsAt: string;
  bayCount: number;
  preferences: BlockRequestPreferences;
  pendingGuests: PendingGuest[] | null;
  companyNameSnapshot: string;
  vatNumberSnapshot: string;
  validationChargeId: string | null;
  authorisationId: string | null;
  authorisationRetryCount: number;
  proposedPlans: PlanSummary[] | null;
  proposedPlansComputedAt: string | null;
  acceptedPlanIndex: number | null;
  settlementBreakdown: SettlementBreakdown | null;
  auditLog: AuditLogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanSummary {
  planIndex: number;
  rationale: string;
  worstCaseEur: number;
  bestCaseEur: number;
  projectedCaseEur: number;
  allocations: PlanAllocation[];
}

export interface PlanAllocation {
  poolListingId: string;
  spotManagerUserId: string;
  contributedBayCount: number;
  riskShareMode: RiskShareMode;
  riskShareRate: number;
  pricePerBayEur: number;
  walkingDistanceMeters: number | null;
  poolRating: number;
}

export interface BlockAllocation {
  allocId: string;
  reqId: string;
  poolListingId: string;
  spotManagerUserId: string;
  contributedBayCount: number;
  allocatedBayCount: number;
  assignedBayIds: string[];
  riskShareMode: RiskShareMode;
  riskShareRate: number;
  pricePerBayEur: number;
  settlement: AllocationSettlement | null;
  createdAt: string;
  updatedAt: string;
}

export interface AllocationSettlement {
  amountEur: number;
  platformFeePct: number;
  platformFeeEur: number;
  netToSpotManagerEur: number;
  transferId: string | null;
  transferStatus: 'PENDING' | 'CREATED' | 'FAILED';
  settledAt: string;
}

export interface SettlementBreakdown {
  totalEur: number;
  capturedEur: number;
  refundedEur: number;
  perAllocation: Array<{
    allocId: string;
    contributedBayCount: number;
    allocatedBayCount: number;
    amountEur: number;
    platformFeeEur: number;
    transferId: string | null;
  }>;
}

export interface AuditLogEntry {
  timestamp: string;
  actorUserId: string;
  action: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface BlockBooking {
  bookingId: string;
  reqId: string;
  allocId: string;
  bayId: string;
  listingId: string;
  guestName: string | null;        // null after anonymisation
  guestEmail: string | null;        // null after anonymisation
  guestPhone: string | null;        // null after anonymisation
  spotterId: string | null;
  emailStatus: 'PENDING' | 'SENT' | 'BOUNCED';
  emailSentAt: string | null;
  emailBouncedAt: string | null;
  allocationStatus: 'ALLOCATED' | 'CANCELLED';
  source: 'BLOCK_RESERVATION';
  createdAt: string;
  updatedAt: string;
}
```

### A3 — Validation helpers

Create `backend/src/shared/block-reservations/validation.ts` with these pure functions:

```typescript
export function validateWindow(startsAt: string, endsAt: string, now: Date): { valid: boolean; error?: string };
// Returns { valid: false, error: 'WINDOW_TOO_SHORT' } if endsAt <= startsAt
// Returns { valid: false, error: 'INSUFFICIENT_LEAD_TIME' } if startsAt < now + 24h
// Returns { valid: false, error: 'WINDOW_EXCEEDS_7_DAYS' } if endsAt - startsAt > 7 days
// Otherwise { valid: true }

export function validateBayCount(bayCount: number): { valid: boolean; error?: string };
// Returns { valid: false, error: 'BAY_COUNT_TOO_LOW' } if bayCount < 2
// Returns { valid: false, error: 'BAY_COUNT_TOO_HIGH' } if bayCount > 500
// Returns { valid: true } otherwise

export function validateBelgianVAT(vatNumber: string): { valid: boolean; error?: string };
// Regex: /^BE0\d{9}$/
// Returns { valid: false, error: 'INVALID_VAT_NUMBER' } if doesn't match
// Returns { valid: true } otherwise

export function validateGuestEmail(email: string): boolean;
// Loose RFC-5322 email regex

export function validateGuestPhone(phone: string): boolean;
// E.164-style: + optional, 8-15 digits

export function validateGuestRow(row: { name: string; email: string; phone: string }): { valid: boolean; errors: string[] };
// Aggregates email + phone + name length checks
```

### A4 — Tests for validation helpers

**Tests first:** `backend/__tests__/shared/block-reservations/validation.test.ts`

```typescript
import {
  validateWindow,
  validateBayCount,
  validateBelgianVAT,
  validateGuestEmail,
  validateGuestPhone,
} from '../../../src/shared/block-reservations/validation';

describe('validateWindow', () => {
  const now = new Date('2026-04-10T12:00:00Z');

  test('valid window 3 days from now lasting 5 days', () => {
    const result = validateWindow('2026-04-13T09:00:00Z', '2026-04-18T18:00:00Z', now);
    expect(result.valid).toBe(true);
  });

  test('rejects endsAt before startsAt', () => {
    const result = validateWindow('2026-04-18T09:00:00Z', '2026-04-13T18:00:00Z', now);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('WINDOW_TOO_SHORT');
  });

  test('rejects startsAt less than 24h in the future', () => {
    const result = validateWindow('2026-04-10T20:00:00Z', '2026-04-12T20:00:00Z', now);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_LEAD_TIME');
  });

  test('rejects window exceeding 7 days', () => {
    const result = validateWindow('2026-04-15T00:00:00Z', '2026-04-23T00:00:00Z', now);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('WINDOW_EXCEEDS_7_DAYS');
  });

  test('accepts exactly 7-day window', () => {
    const result = validateWindow('2026-04-15T00:00:00Z', '2026-04-22T00:00:00Z', now);
    expect(result.valid).toBe(true);
  });
});

describe('validateBayCount', () => {
  test('accepts 2 bays', () => {
    expect(validateBayCount(2).valid).toBe(true);
  });
  test('rejects 1 bay', () => {
    expect(validateBayCount(1).error).toBe('BAY_COUNT_TOO_LOW');
  });
  test('accepts 500 bays', () => {
    expect(validateBayCount(500).valid).toBe(true);
  });
  test('rejects 501 bays', () => {
    expect(validateBayCount(501).error).toBe('BAY_COUNT_TOO_HIGH');
  });
});

describe('validateBelgianVAT', () => {
  test('accepts valid Belgian VAT', () => {
    expect(validateBelgianVAT('BE0123456789').valid).toBe(true);
  });
  test('rejects missing BE prefix', () => {
    expect(validateBelgianVAT('0123456789').valid).toBe(false);
  });
  test('rejects too few digits', () => {
    expect(validateBelgianVAT('BE012345678').valid).toBe(false);
  });
  test('rejects letters in number', () => {
    expect(validateBelgianVAT('BE0ABCDEFGHI').valid).toBe(false);
  });
});

describe('validateGuestEmail', () => {
  test('accepts standard email', () => {
    expect(validateGuestEmail('jane.doe@example.com')).toBe(true);
  });
  test('rejects missing @', () => {
    expect(validateGuestEmail('jane.doe.example.com')).toBe(false);
  });
});

describe('validateGuestPhone', () => {
  test('accepts E.164 format', () => {
    expect(validateGuestPhone('+32475123456')).toBe(true);
  });
  test('accepts no plus', () => {
    expect(validateGuestPhone('32475123456')).toBe(true);
  });
  test('rejects too short', () => {
    expect(validateGuestPhone('1234')).toBe(false);
  });
});
```

Run the tests — confirm they fail (red). Then write the implementations in `validation.ts`. Confirm they pass (green).

---

## PART B — Bulk allocator (the heart of the matching pipeline)

The bulk allocator is the most complex pure function in the v2.x scope. It's used in three places:
1. **block-match Lambda** — to compute proposed plans (which pools, how many bays from each)
2. **block-accept-plan Lambda** — to assign specific bayIds to the BLOCKALLOC#s on confirmation
3. **block-guest-add Lambda** — to assign specific bayIds to new BOOKING# rows as they're added

The allocator MUST be deterministic: given the same inputs (set of available pools, request preferences, list of guest items to allocate), it must always produce the same output. This makes audit trails reproducible and reassignments predictable.

### B1 — Allocator interface

Create `backend/src/shared/block-reservations/allocator.ts`:

```typescript
import type { BlockRequestPreferences, RiskShareMode } from './types';

export interface PoolCandidate {
  poolListingId: string;
  spotManagerUserId: string;
  totalBayCount: number;             // pool capacity
  availableBayIds: string[];         // bays not currently held by other reservations during the window
  pricePerBayEur: number;            // tiered pricing function evaluated against the request window
  riskShareMode: RiskShareMode;
  riskShareRate: number;
  poolRating: number;                // 0–5
  spotManagerVerified: boolean;
  walkingDistanceMeters: number | null;  // distance from preference reference point, or null if no ref
  latitude: number;
  longitude: number;
}

export interface AllocationItem {
  itemId: string;                    // arbitrary unique ID — guest email, or "bay-N" for pre-acceptance allocator
  preferredLat?: number;             // optional geo bias
  preferredLng?: number;
}

export interface AllocationResult {
  itemId: string;
  poolListingId: string;
  bayId: string;
  marginalCostEur: number;
}

export interface AllocatorWeights {
  cost: number;   // weight on cost score
  geo: number;    // weight on geo score
}

/**
 * Compute weighted greedy allocation of items to bays.
 *
 * Score for assigning an item to a candidate bay:
 *   score = w_cost × cost_score + w_geo × geo_score
 *
 * cost_score: normalised inverse of marginal cost.
 *   For PERCENTAGE pools below floor: marginal cost = 0 (filling an empty bay costs nothing extra)
 *   For PERCENTAGE pools at or above floor: marginal cost = pricePerBayEur × (1 − 0.30)
 *   For MIN_BAYS_FLOOR pools below floor: marginal cost = 0
 *   For MIN_BAYS_FLOOR pools at or above floor: marginal cost = pricePerBayEur
 *
 * geo_score: normalised inverse of distance from item's preferred lat/lng to the pool centroid.
 *   If no preferred lat/lng, geo_score = 1 (constant — all pools equally good).
 *
 * Weights are derived from preferences:
 *   - If maxWalkingTimeFromPoint is set: { cost: 0.4, geo: 0.6 }  (geo dominates)
 *   - Else if clusterTogether is true:    { cost: 0.5, geo: 0.5 } (balanced)
 *   - Else (default):                      { cost: 0.8, geo: 0.2 } (cost dominates)
 *
 * Tiebreak rule: if two candidate bays produce the same score, the one with the lower bayId
 * (lexicographic sort) wins. This is what makes the allocator deterministic.
 */
export function bulkAllocate(
  items: AllocationItem[],
  pools: PoolCandidate[],
  preferences: BlockRequestPreferences
): AllocationResult[];

export function deriveWeights(preferences: BlockRequestPreferences): AllocatorWeights;
```

### B2 — Allocator tests

**Tests first:** `backend/__tests__/shared/block-reservations/allocator.test.ts`

```typescript
import { bulkAllocate, deriveWeights } from '../../../src/shared/block-reservations/allocator';
import type { PoolCandidate, AllocationItem } from '../../../src/shared/block-reservations/allocator';
import type { BlockRequestPreferences } from '../../../src/shared/block-reservations/types';

const defaultPrefs: BlockRequestPreferences = {
  minPoolRating: null,
  requireVerifiedSpotManager: null,
  noIndividualSpots: true,
  maxCounterparties: null,
  maxWalkingTimeFromPoint: null,
  clusterTogether: null,
};

function makePool(overrides: Partial<PoolCandidate>): PoolCandidate {
  return {
    poolListingId: 'pool-1',
    spotManagerUserId: 'sm-1',
    totalBayCount: 10,
    availableBayIds: ['bay-01', 'bay-02', 'bay-03', 'bay-04', 'bay-05'],
    pricePerBayEur: 25,
    riskShareMode: 'PERCENTAGE',
    riskShareRate: 0.30,
    poolRating: 4.5,
    spotManagerVerified: true,
    walkingDistanceMeters: null,
    latitude: 50.85,
    longitude: 4.35,
    ...overrides,
  };
}

describe('deriveWeights', () => {
  test('default preferences favour cost (0.8) over geo (0.2)', () => {
    expect(deriveWeights(defaultPrefs)).toEqual({ cost: 0.8, geo: 0.2 });
  });

  test('maxWalkingTimeFromPoint set → geo dominates (0.4 cost / 0.6 geo)', () => {
    const prefs = { ...defaultPrefs, maxWalkingTimeFromPoint: { minutes: 10, lat: 50.85, lng: 4.35 } };
    expect(deriveWeights(prefs)).toEqual({ cost: 0.4, geo: 0.6 });
  });

  test('clusterTogether set → balanced (0.5 / 0.5)', () => {
    const prefs = { ...defaultPrefs, clusterTogether: true };
    expect(deriveWeights(prefs)).toEqual({ cost: 0.5, geo: 0.5 });
  });
});

describe('bulkAllocate — single pool', () => {
  test('assigns each item to a unique bay (no double-booking)', () => {
    const items: AllocationItem[] = [
      { itemId: 'guest-a' },
      { itemId: 'guest-b' },
      { itemId: 'guest-c' },
    ];
    const pools = [makePool({})];
    const result = bulkAllocate(items, pools, defaultPrefs);

    expect(result).toHaveLength(3);
    const bayIds = result.map((r) => r.bayId);
    expect(new Set(bayIds).size).toBe(3);                       // all unique
    expect(result.every((r) => r.poolListingId === 'pool-1')).toBe(true);
  });

  test('deterministic — same inputs produce same outputs', () => {
    const items: AllocationItem[] = [{ itemId: 'g1' }, { itemId: 'g2' }];
    const pools = [makePool({})];
    const r1 = bulkAllocate(items, pools, defaultPrefs);
    const r2 = bulkAllocate(items, pools, defaultPrefs);
    expect(r1).toEqual(r2);
  });

  test('tiebreak picks lexicographically lowest bayId', () => {
    const items: AllocationItem[] = [{ itemId: 'g1' }];
    const pools = [makePool({ availableBayIds: ['bay-99', 'bay-01', 'bay-50'] })];
    const result = bulkAllocate(items, pools, defaultPrefs);
    expect(result[0].bayId).toBe('bay-01');
  });
});

describe('bulkAllocate — multi-pool with cost', () => {
  test('with PERCENTAGE pools, cheaper pool wins when both have capacity', () => {
    const cheap = makePool({ poolListingId: 'pool-cheap', pricePerBayEur: 10, availableBayIds: ['bay-c1'] });
    const expensive = makePool({ poolListingId: 'pool-expensive', pricePerBayEur: 30, availableBayIds: ['bay-e1'] });
    const result = bulkAllocate([{ itemId: 'g1' }], [cheap, expensive], defaultPrefs);
    expect(result[0].poolListingId).toBe('pool-cheap');
  });
});

describe('bulkAllocate — geo bias', () => {
  test('with maxWalkingTimeFromPoint set, closer pool wins even if more expensive', () => {
    const close = makePool({
      poolListingId: 'pool-close',
      pricePerBayEur: 30,
      availableBayIds: ['bay-cl'],
      latitude: 50.85,
      longitude: 4.35,
    });
    const far = makePool({
      poolListingId: 'pool-far',
      pricePerBayEur: 10,
      availableBayIds: ['bay-fr'],
      latitude: 50.90,    // ~5km north
      longitude: 4.35,
    });
    const prefs: BlockRequestPreferences = {
      ...defaultPrefs,
      maxWalkingTimeFromPoint: { minutes: 10, lat: 50.85, lng: 4.35 },
    };
    const result = bulkAllocate([{ itemId: 'g1' }], [close, far], prefs);
    expect(result[0].poolListingId).toBe('pool-close');
  });
});

describe('bulkAllocate — capacity exhaustion', () => {
  test('returns fewer results than items if total available bays is insufficient', () => {
    const items: AllocationItem[] = [{ itemId: 'g1' }, { itemId: 'g2' }, { itemId: 'g3' }];
    const pools = [makePool({ availableBayIds: ['bay-01'] })];
    const result = bulkAllocate(items, pools, defaultPrefs);
    expect(result).toHaveLength(1);
    expect(result[0].itemId).toBe('g1');
  });

  test('allocates across multiple pools when no single pool has capacity', () => {
    const items: AllocationItem[] = [{ itemId: 'g1' }, { itemId: 'g2' }, { itemId: 'g3' }];
    const pools = [
      makePool({ poolListingId: 'pool-a', availableBayIds: ['a1', 'a2'] }),
      makePool({ poolListingId: 'pool-b', availableBayIds: ['b1', 'b2'] }),
    ];
    const result = bulkAllocate(items, pools, defaultPrefs);
    expect(result).toHaveLength(3);
    const poolIds = result.map((r) => r.poolListingId);
    expect(poolIds).toContain('pool-a');
    expect(poolIds).toContain('pool-b');
  });
});
```

Run the tests — they must fail (red). Then implement `allocator.ts`. The implementation should:

1. **Derive weights** from preferences using the rules in `deriveWeights`.
2. **Sort items by `itemId` lexicographically** (deterministic order).
3. **For each item in sorted order**: scan all available bays across all pools, compute the score for each candidate bay, pick the one with the highest score (tiebreak by lowest bayId). Mark that bayId as used (remove from `availableBayIds` of its pool). If no available bay exists, the item is not allocated.
4. **Return the list of allocations** in the order items were processed.

The cost_score normalisation should use the maximum marginal cost across all candidate bays as the divisor; geo_score uses the maximum walking distance similarly. If only one candidate exists, both scores are 1.0.

Use the **Haversine formula** for distance computation (latitude/longitude → meters). Don't pull in a heavy library; the formula is ~10 lines of math.

Run the tests — they must pass (green).


---

## PART C — Lambda functions

This session adds the following Lambdas. Each follows the TDD pattern: tests first (red), implementation (green).

| # | Lambda | Endpoint | UC | Trigger |
|---|---|---|---|---|
| C1 | `block-request-create` | POST /api/v1/block-requests | UC-BS01 | API Gateway |
| C2 | `block-request-update` | PATCH /api/v1/block-requests/{reqId} | UC-BS01 alt flow A | API Gateway |
| C3 | `block-request-get` | GET /api/v1/block-requests/{reqId} | UC-BS02/03/04/05 | API Gateway |
| C4 | `block-request-list` | GET /api/v1/block-requests?ownerUserId=me | Block Spotter dashboard | API Gateway |
| C5 | `block-match` | (event-driven) | UC-BS01/02 | EventBridge `block.request.created`/`updated` |
| C6 | `block-accept-plan` | POST /api/v1/block-requests/{reqId}/accept | UC-BS02 step 6 | API Gateway |
| C7 | `block-authorise` | (event-driven) | UC-BS03 step 7 | EventBridge Scheduler `block-auth-{reqId}` |
| C8 | `block-settle` | (event-driven) | UC-BS08 | EventBridge Scheduler `block-settle-{reqId}` |
| C9 | `block-request-cancel` | DELETE /api/v1/block-requests/{reqId} | UC-BS07 | API Gateway |
| C10 | `block-guest-add` | POST /api/v1/block-requests/{reqId}/guests | UC-BS04 | API Gateway |
| C11 | `block-guest-reassign` | PATCH /api/v1/block-requests/{reqId}/guests/{bookingId} | UC-BS05 | API Gateway |
| C12 | `block-guest-anonymise` | (event-driven) | UC-BS06 cleanup | EventBridge Scheduler `guest-anonymise-{reqId}` |
| C13 | `magic-link-claim` | GET /claim/{token} | UC-BS06 | API Gateway (public, no auth) |
| C14 | `block-payment-webhook` | POST /api/v1/payments/block-webhook | Stripe webhook events | Stripe |

---

### C1 — `block-request-create`

**Endpoint:** `POST /api/v1/block-requests`
**Auth:** Required (Cognito JWT, any persona)
**Implements:** UC-BS01 main flow

**Tests first:** `backend/__tests__/block-reservations/request-create.test.ts`

```typescript
import { handler } from '../../src/functions/block-reservations/request-create';
import { mockAuthEvent } from '../helpers/mock-auth-event';
import { resetDynamoMock, getDynamoItem } from '../helpers/dynamo-mock';
import { resetEventBridgeMock, getPublishedEvents } from '../helpers/eventbridge-mock';

beforeEach(() => {
  resetDynamoMock();
  resetEventBridgeMock();
});

describe('block-request-create', () => {
  const validBody = {
    startsAt: '2026-04-15T09:00:00Z',
    endsAt: '2026-04-18T18:00:00Z',
    bayCount: 20,
    preferences: {
      minPoolRating: 4,
      requireVerifiedSpotManager: true,
      noIndividualSpots: true,
      maxCounterparties: 2,
      maxWalkingTimeFromPoint: null,
      clusterTogether: true,
    },
    pendingGuests: null,
    companyName: 'Hotel Métropole SA',
    vatNumber: 'BE0123456789',
  };

  test('happy path — creates BLOCKREQ#, captures company snapshot, publishes event', async () => {
    const result = await handler(mockAuthEvent('user-1', { body: validBody }));
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.reqId).toMatch(/^[0-9A-Z]{26}$/);   // ULID
    expect(body.status).toBe('PENDING_MATCH');

    const item = await getDynamoItem(`BLOCKREQ#${body.reqId}`, 'METADATA');
    expect(item.ownerUserId).toBe('user-1');
    expect(item.bayCount).toBe(20);
    expect(item.companyNameSnapshot).toBe('Hotel Métropole SA');
    expect(item.vatNumberSnapshot).toBe('BE0123456789');

    // Reverse projection
    const reverse = await getDynamoItem('USER#user-1', `BLOCKREQ#${body.reqId}`);
    expect(reverse).toBeDefined();

    // EventBridge event published
    const events = getPublishedEvents();
    expect(events).toHaveLength(1);
    expect(events[0].DetailType).toBe('block.request.created');
    expect(JSON.parse(events[0].Detail).reqId).toBe(body.reqId);
  });

  test('first submission persists companyName + vatNumber to USER PROFILE', async () => {
    await handler(mockAuthEvent('user-1', { body: validBody }));
    const profile = await getDynamoItem('USER#user-1', 'PROFILE');
    expect(profile.companyName).toBe('Hotel Métropole SA');
    expect(profile.vatNumber).toBe('BE0123456789');
  });

  test('subsequent submission reuses companyName + vatNumber from USER PROFILE', async () => {
    // Seed PROFILE with existing values
    await seedUserProfile('user-1', { companyName: 'Existing Corp', vatNumber: 'BE0987654321' });

    const bodyWithoutCompany = { ...validBody };
    delete bodyWithoutCompany.companyName;
    delete bodyWithoutCompany.vatNumber;

    const result = await handler(mockAuthEvent('user-1', { body: bodyWithoutCompany }));
    expect(result.statusCode).toBe(201);

    const item = await getDynamoItem(`BLOCKREQ#${JSON.parse(result.body).reqId}`, 'METADATA');
    expect(item.companyNameSnapshot).toBe('Existing Corp');
    expect(item.vatNumberSnapshot).toBe('BE0987654321');
  });

  test('first submission requires companyName + vatNumber', async () => {
    const bodyMissing = { ...validBody };
    delete bodyMissing.companyName;
    delete bodyMissing.vatNumber;

    const result = await handler(mockAuthEvent('user-no-profile', { body: bodyMissing }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('SOFT_VERIFICATION_REQUIRED');
  });

  test('rejects window exceeding 7 days with 400 WINDOW_EXCEEDS_7_DAYS', async () => {
    const result = await handler(mockAuthEvent('user-1', {
      body: { ...validBody, startsAt: '2026-04-15T00:00:00Z', endsAt: '2026-04-23T00:00:00Z' },
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('WINDOW_EXCEEDS_7_DAYS');
  });

  test('rejects bayCount of 1 with 400 BAY_COUNT_TOO_LOW', async () => {
    const result = await handler(mockAuthEvent('user-1', { body: { ...validBody, bayCount: 1 } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('BAY_COUNT_TOO_LOW');
  });

  test('rejects bayCount over 500 with 400 BAY_COUNT_TOO_HIGH', async () => {
    const result = await handler(mockAuthEvent('user-1', { body: { ...validBody, bayCount: 501 } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('BAY_COUNT_TOO_HIGH');
  });

  test('rejects invalid VAT format', async () => {
    const result = await handler(mockAuthEvent('user-1', { body: { ...validBody, vatNumber: 'INVALID' } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('INVALID_VAT_NUMBER');
  });

  test('accepts pendingGuests array and stores on BLOCKREQ#', async () => {
    const guests = [
      { name: 'Alice Johnson', email: 'alice@example.com', phone: '+32475111222' },
      { name: 'Bob Smith', email: 'bob@example.com', phone: '+32475333444' },
    ];
    const result = await handler(mockAuthEvent('user-1', { body: { ...validBody, pendingGuests: guests } }));
    expect(result.statusCode).toBe(201);

    const item = await getDynamoItem(`BLOCKREQ#${JSON.parse(result.body).reqId}`, 'METADATA');
    expect(item.pendingGuests).toEqual(guests);
  });

  test('rejects pendingGuests with invalid email format', async () => {
    const guests = [{ name: 'Bad', email: 'not-an-email', phone: '+32475111222' }];
    const result = await handler(mockAuthEvent('user-1', { body: { ...validBody, pendingGuests: guests } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('INVALID_GUEST_EMAIL');
  });

  test('rejects duplicate emails in pendingGuests', async () => {
    const guests = [
      { name: 'A', email: 'same@example.com', phone: '+32475111222' },
      { name: 'B', email: 'same@example.com', phone: '+32475333444' },
    ];
    const result = await handler(mockAuthEvent('user-1', { body: { ...validBody, pendingGuests: guests } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('DUPLICATE_GUEST_EMAIL');
  });
});
```

Implementation notes for `block-request-create`:
- Use `ulid()` for the reqId (consistent with the rest of the codebase).
- Validate window, bayCount, VAT, and guest list using the helpers from PART A.
- Look up `USER#{userId} PROFILE` to check for existing companyName/vatNumber before requiring them in the body.
- Write three items in a single TransactWriteItems: `BLOCKREQ#{reqId} METADATA`, `USER#{userId} BLOCKREQ#{reqId}` (reverse projection), and the PROFILE update if needed.
- Publish the EventBridge event AFTER the DynamoDB write succeeds (no two-phase commit).
- The auditLog starts empty `[]`.
- The proposedPlans starts as `null` — populated by the block-match Lambda.

---

### C2 — `block-request-update`

**Endpoint:** `PATCH /api/v1/block-requests/{reqId}`
**Auth:** Required (must be the owner)
**Implements:** UC-BS01 alt flow A — re-edit before plan acceptance

Allows the Block Spotter to edit the request while in `PENDING_MATCH` or `PLANS_PROPOSED`. After acceptance (CONFIRMED) the request is immutable.

**Tests first:** Cover these scenarios:
- Owner can update window, bayCount, preferences, pendingGuests while status is PENDING_MATCH or PLANS_PROPOSED
- Update resets status to PENDING_MATCH and clears proposedPlans/proposedPlansComputedAt
- Update publishes a `block.request.updated` EventBridge event to re-trigger matching
- Update appends an entry to auditLog with before/after diffs
- Non-owner gets 403
- Update on CONFIRMED returns 409 REQUEST_LOCKED
- Update on CANCELLED returns 409 REQUEST_TERMINAL
- Update on AUTHORISED or SETTLED returns 409 REQUEST_LOCKED

Implementation notes:
- Use a conditional UpdateItem with `ConditionExpression: "attribute_exists(reqId) AND #status IN (:p, :pp)"` where `:p = PENDING_MATCH` and `:pp = PLANS_PROPOSED`.
- The auditLog append uses `list_append(if_not_exists(auditLog, :empty), :entry)`.
- Reset proposedPlans and acceptedPlanIndex to null in the same UpdateItem.

---

### C3 — `block-request-get`

**Endpoint:** `GET /api/v1/block-requests/{reqId}`
**Auth:** Required (owner OR admin OR Spot Manager whose pool is in an allocation)
**Implements:** UC-BS02/03/04/05 — load the block detail page

Returns the BLOCKREQ# METADATA plus an array of BLOCKALLOC# children plus an array of BOOKING# grandchildren (for UC-BS04 guest list view).

**Tests first:** Cover:
- Owner can fetch their own block request with all children
- Spot Manager whose pool is in a BLOCKALLOC# can fetch (read-only view, with PII redacted from BOOKING# rows — see UC-BS06 contact mediation)
- Admin can fetch any block request
- Non-owner non-Spot-Manager non-admin gets 403
- Fetching a non-existent reqId returns 404
- Response includes the full data tree: BLOCKREQ# + allocations + bookings

Implementation notes:
- Single Query: `PK = BLOCKREQ#{reqId}`. Returns the METADATA, all BLOCKALLOC#, and all BOOKING# in one round trip.
- Authorization check: load METADATA first, then check `ownerUserId` against the JWT subject. If mismatch, query `LISTING#{poolListingId} BLOCKALLOC#{allocId}` for any pool the JWT subject manages, and authorize if at least one match. Otherwise check the admin Cognito group claim.
- For Spot Manager fetches, redact `guestEmail`, `guestPhone`, and replace `guestName` with the first name only (privacy: Spot Manager only needs to identify the guest, not their full contact info).

---

### C4 — `block-request-list`

**Endpoint:** `GET /api/v1/block-requests?ownerUserId=me&status=...&limit=20&cursor=...`
**Auth:** Required
**Implements:** Block Spotter dashboard

Lists BLOCKREQ# rows owned by the authenticated user, sorted by createdAt descending. Supports cursor-based pagination and optional status filter.

**Tests first:** Cover:
- Returns owner's block requests in createdAt-desc order
- Pagination cursor round-trips correctly
- Status filter restricts results
- Empty result set returns empty array (not 404)

Implementation: Query the reverse projection `USER#{userId} BEGINS_WITH BLOCKREQ#`. The cursor is the LastEvaluatedKey base64-encoded.

---

### C5 — `block-match` Lambda

**Trigger:** EventBridge rule on `block.request.created` and `block.request.updated`
**Implements:** UC-BS01 step 9 + UC-BS02 plan computation

This is the matching pipeline. It runs the bulk allocator across all eligible Spot Pools to compute up to 3 candidate plans, then writes them to BLOCKREQ#.proposedPlans.

**Tests first:** `backend/__tests__/block-reservations/match.test.ts`

```typescript
describe('block-match Lambda', () => {
  test('writes proposedPlans and transitions PENDING_MATCH → PLANS_PROPOSED', async () => {
    await seedBlockRequest({ reqId: 'req-1', status: 'PENDING_MATCH', bayCount: 10 });
    await seedSpotPool({ poolListingId: 'pool-a', totalBayCount: 20, blockReservationsOptedIn: true });

    await handler({ detail: { reqId: 'req-1' } });

    const item = await getDynamoItem('BLOCKREQ#req-1', 'METADATA');
    expect(item.status).toBe('PLANS_PROPOSED');
    expect(item.proposedPlans).toHaveLength(1);
    expect(item.proposedPlans[0].allocations[0].poolListingId).toBe('pool-a');
    expect(item.proposedPlans[0].allocations[0].contributedBayCount).toBe(10);
    expect(item.proposedPlansComputedAt).toBeDefined();
  });

  test('skips pools where blockReservationsOptedIn is false', async () => { /* ... */ });
  test('skips pools where the Spot Manager has expired RC insurance', async () => { /* ... */ });
  test('respects minPoolRating preference', async () => { /* ... */ });
  test('respects requireVerifiedSpotManager preference', async () => { /* ... */ });
  test('respects maxCounterparties preference (caps multi-pool plans)', async () => { /* ... */ });
  test('respects maxWalkingTimeFromPoint preference (filters distant pools)', async () => { /* ... */ });
  test('returns at most MAX_PLANS_RETURNED plans', async () => { /* ... */ });
  test('plans are sorted by tiebreak: counterparties → cost → walking → rating', async () => { /* ... */ });
  test('empty result transitions to PLANS_PROPOSED with empty array (not error)', async () => { /* ... */ });
  test('worst case = sum(contributedBayCount × pricePerBayEur) across allocations', async () => { /* ... */ });
  test('best case applies risk share floor or percentage correctly', async () => { /* ... */ });
  test('projected case = best + (worst − best) × historicalAllocationRate', async () => { /* ... */ });
  test('first-time Block Spotter uses default historicalAllocationRate of 0.7', async () => { /* ... */ });
});
```

Implementation notes:
- Load all `LISTING#` entries with `isPool = true AND blockReservationsOptedIn = true` via a GSI on `POOL_OPTED_IN`. (This GSI is added by Session 26, the Spot Manager session — verify before starting.)
- For each candidate pool, load the Spot Manager's profile to check `spotManagerStatus` (must be ACTIVE — RC insurance not expired).
- Filter by preferences: minPoolRating, requireVerifiedSpotManager, maxWalkingTimeFromPoint.
- For each remaining pool, query its current availability for the request window using the existing availability resolver from session 12 (extended in session 26 for pool listings). This returns the list of available bayIds during the window.
- Compute the per-bay tiered price using the tiered pricing function (added in the tiered-pricing/platform-fee session) evaluated against the request window length.
- Build candidate plans:
  - **Single-pool plan**: pick the best single pool that has at least bayCount available bays. The "best" is by cost-then-walking-then-rating.
  - **Multi-pool plans**: combinations of 2 or 3 pools that sum to at least bayCount. Use a greedy combination: sort pools by cost ascending, take the cheapest, take the next cheapest, etc., until cumulative capacity meets bayCount. Repeat with cluster-aware ordering for the second plan, and rating-aware for the third.
- For each plan, run the bulk allocator with `bayCount` placeholder items (`bay-001`, `bay-002`, ...) to verify the assignment is feasible and to compute the per-pool contributedBayCount.
- Compute worst/best/projected costs per plan as in the tests above.
- Apply the tiebreak order: (1) fewest counterparties (length of allocations array), (2) lowest worst-case cost, (3) shortest average walking distance, (4) highest average rating.
- Take the top MAX_PLANS_RETURNED plans.
- Write the proposedPlans array to the BLOCKREQ# with `proposedPlansComputedAt = now()` and transition status to PLANS_PROPOSED.

---

### C6 — `block-accept-plan`

**Endpoint:** `POST /api/v1/block-requests/{reqId}/accept`
**Auth:** Required (must be the owner)
**Implements:** UC-BS02 step 6 → UC-BS03 booking-day flow

Body: `{ planIndex: 0 }` — the index into `proposedPlans` of the plan being accepted.

This is one of the most critical Lambdas in the session. It:
1. Re-validates the chosen plan's pools are still available (refresh from DynamoDB) — if stale, return 409 PLAN_STALE
2. Checks plan freshness — if `proposedPlansComputedAt` is older than `PLAN_FRESHNESS_MINUTES`, returns 409 PLANS_EXPIRED
3. Issues the €1 Stripe validation charge via `PaymentIntent.create` with `capture_method=automatic` and `idempotency_key=blockreq:{reqId}:validate`
4. Immediately calls `PaymentIntent.cancel` to void it
5. If validation fails: reverts the request to PLANS_PROPOSED with no allocations written, returns 402 PAYMENT_DECLINED
6. If validation succeeds: writes BLOCKALLOC# rows + reverse projections + transitions BLOCKREQ# to CONFIRMED with `validationChargeId` set
7. Materialises pendingGuests as BOOKING# rows using the bulk allocator (if any)
8. Sends magic link emails to those guests via SES
9. Schedules two EventBridge Scheduler rules: `block-auth-{reqId}` at startsAt − 7 days, and `block-settle-{reqId}` at endsAt
10. Schedules `guest-anonymise-{reqId}` at endsAt + 48 hours

**Tests first:** Cover:
- Happy path: validation charge succeeds, BLOCKALLOC#s written, status → CONFIRMED, pendingGuests materialised, magic links sent, all 3 EventBridge rules created
- 409 PLAN_STALE if a pool has become unavailable since matching
- 409 PLANS_EXPIRED if `proposedPlansComputedAt > now − 30 minutes`
- 402 PAYMENT_DECLINED if Stripe validation fails — status reverts to PLANS_PROPOSED, no allocations written
- 403 if non-owner attempts to accept
- 409 if request is not in PLANS_PROPOSED state
- 400 if planIndex is out of bounds for proposedPlans
- Idempotency: calling accept twice on the same request returns 409 the second time (status check)

Implementation notes:
- Use a TransactWriteItems for the all-or-nothing write of BLOCKALLOC# rows (max 100 — sanity check the plan size; if more than ~30 allocations the implementation needs to chunk, though in practice plans rarely exceed 3-5 allocations).
- The Stripe call MUST use the idempotency key format `blockreq:{reqId}:validate` so retries don't double-charge.
- BOOKING# rows are written in a SECOND TransactWriteItems batch after the BLOCKALLOC# batch succeeds. If the BOOKING# batch fails (rare), log it but don't roll back the BLOCKALLOC#s — instead mark the BLOCKREQ# with `bookingMaterializationError = true` and let an admin retry from the backoffice.
- The EventBridge Scheduler rule names follow the convention `block-auth-{reqId}`, `block-settle-{reqId}`, `guest-anonymise-{reqId}`. Use the SDK `CreateSchedule` operation with `FlexibleTimeWindow: { Mode: 'OFF' }` for exact timing.
- Magic link emails use the SES template `block-magic-link` (template content lives in CDK, see Part E).
- The audit log gets one entry: `{ action: 'PLAN_ACCEPTED', before: { status: 'PLANS_PROPOSED' }, after: { status: 'CONFIRMED', acceptedPlanIndex: N } }`.

---

### C7 — `block-authorise` Lambda

**Trigger:** EventBridge Scheduler rule `block-auth-{reqId}` firing at `startsAt − 7 days`
**Implements:** UC-BS03 main flow steps 7-10

This is the deferred single authorisation. It computes the worst-case amount and creates a Stripe `manual_capture` PaymentIntent.

**Tests first:** Cover:
- Happy path: computes worst case, creates PI, transitions CONFIRMED → AUTHORISED, stores authorisationId, sends confirmation email
- Idempotency key `blockreq:{reqId}:authorise` prevents double-auth on retry
- Authorisation failure (card declined) creates a 24-hour grace period EventBridge Scheduler rule `block-auth-grace-{reqId}` and sends urgent email
- Skips if BLOCKREQ# is in CANCELLED state (defensive — handler should no-op)
- Skips if BLOCKREQ# is already in AUTHORISED state (defensive idempotency)
- Worst case computation: `sum(contributedBayCount × pricePerBayEur)` across all BLOCKALLOC#s

Implementation:
- Load the BLOCKREQ# and all BLOCKALLOC# children with one Query.
- If status is not CONFIRMED, log and return (no-op — defensive).
- Compute `worstCaseEur = sum(allocs.map(a => a.contributedBayCount * a.pricePerBayEur))`.
- Convert to cents: `Math.round(worstCaseEur * 100)`.
- Stripe call: `PaymentIntent.create({ amount, currency: 'eur', payment_method: customerSavedPm, customer: stripeCustomerId, capture_method: 'manual', off_session: true, confirm: true, metadata: { purpose: 'authorise', reqId }, })` with idempotency key `blockreq:{reqId}:authorise`.
- On success: UpdateItem to set `status = AUTHORISED`, `authorisationId = pi.id`. Send confirmation email.
- On failure (Stripe throws): create the `block-auth-grace-{reqId}` schedule for `now + 24h`, send urgent email, increment `authorisationRetryCount`, and DO NOT change status (stays at CONFIRMED so the Block Spotter can manually retry from the dashboard).

---

### C8 — `block-settle` Lambda

**Trigger:** EventBridge Scheduler rule `block-settle-{reqId}` firing at `endsAt`
**Implements:** UC-BS08 settlement computation and execution

This is the second-most-critical Lambda after block-accept-plan. It captures the held authorisation, computes per-allocation amounts based on actual fill rate, runs Stripe Connect Transfers to Spot Managers, and writes the settlement breakdown.

**Tests first:** Cover:
- Happy path: captures the full worst-case amount (when fully allocated), creates one Stripe Transfer per allocation, transitions AUTHORISED → SETTLED, writes settlementBreakdown to BLOCKREQ# and per-allocation settlement to each BLOCKALLOC#
- Partial fill with PERCENTAGE risk share: computes `perAlloc = allocatedBayCount × pricePerBayEur + (contributedBayCount − allocatedBayCount) × pricePerBayEur × 0.30` and captures only this amount (rest of authorisation is voided)
- Partial fill with MIN_BAYS_FLOOR: computes `perAlloc = max(allocatedBayCount, contributedBayCount × 0.55) × pricePerBayEur`
- Platform fee snapshot: reads `CONFIG#PLATFORM_FEE METADATA.blockReservationPct` at the moment of settlement and stores it on the BLOCKALLOC# settlement record
- Stripe Connect Transfers: one per allocation, with `source_transaction` set to the captured charge ID
- Skips if BLOCKREQ# is not in AUTHORISED state (e.g. already cancelled — no-op)
- Settlement-failed state: if Stripe capture fails, status transitions to SETTLEMENT_FAILED (a sub-status — actually keep status as AUTHORISED but write `settlementError` field), notifies admin via PagerDuty
- Per-allocation transfer failure: if one Transfer fails, the others still go through; the failed allocation is marked `transferStatus = FAILED` and admin notified

Implementation notes:
- This is the longest Lambda in the session — easily 200-300 lines of TypeScript.
- Load BLOCKREQ# + all BLOCKALLOC# + count of BOOKING# children per allocation in one Query.
- Compute the per-allocation amounts using the risk share formulas above.
- Sum to get the total capture amount.
- Read CONFIG#PLATFORM_FEE METADATA for the fee snapshot.
- Capture the held authorisation: `PaymentIntent.capture({ amount_to_capture: Math.round(totalCaptureEur * 100) })` with idempotency key `blockreq:{reqId}:capture`. The `amount_to_capture` parameter is what makes Stripe void the unused portion automatically.
- For each allocation, compute `netToSpotManagerEur = amountEur × (1 - blockReservationPct)` and `platformFeeEur = amountEur - netToSpotManagerEur`.
- For each allocation, create a Stripe Connect Transfer: `Transfer.create({ amount: netCents, currency: 'eur', destination: spotManagerStripeConnectAccountId, source_transaction: chargeId, metadata: { reqId, allocId } })` with idempotency key `blockreq:{reqId}:transfer:{allocId}`.
- Write the settlement to each BLOCKALLOC# (UpdateItem) and to the BLOCKREQ# (UpdateItem with the breakdown).
- Transition BLOCKREQ# status to SETTLED.
- The auditLog gets one entry per settlement.
- Send a settlement summary email to the Block Spotter with a link to UC-BS08.

---

### C9 — `block-request-cancel`

**Endpoint:** `DELETE /api/v1/block-requests/{reqId}`
**Auth:** Required (must be the owner)
**Implements:** UC-BS07 main flow (3-tier cancellation)

**Tests first:** Cover all three tiers explicitly:

```typescript
describe('block-request-cancel — free tier (>7 days)', () => {
  test('cancels with reason USER_CANCELLED_FREE, no Stripe ops', async () => { /* ... */ });
  test('deletes the pending block-auth-{reqId} EventBridge rule', async () => { /* ... */ });
  test('notifies affected Spot Managers', async () => { /* ... */ });
  test('anonymises BOOKING# PII immediately (not waiting for 48h)', async () => { /* ... */ });
});

describe('block-request-cancel — 50% tier (7d to 24h)', () => {
  test('captures halfAmount = sum(contributedBayCount × pricePerBayEur) / 2', async () => { /* ... */ });
  test('voids the remainder of the authorisation', async () => { /* ... */ });
  test('distributes pro-rata across Spot Managers via Stripe Connect Transfers', async () => { /* ... */ });
  test('platform fee taken first per blockReservationPct', async () => { /* ... */ });
  test('if T-7d auth has not yet fired, places fresh PI for halfAmount and captures', async () => { /* ... */ });
  test('reason set to USER_CANCELLED_50PCT', async () => { /* ... */ });
});

describe('block-request-cancel — no-cancel tier (<24h)', () => {
  test('returns 409 NO_SELF_SERVICE_CANCEL', async () => { /* ... */ });
  test('does not change BLOCKREQ# state', async () => { /* ... */ });
});

describe('block-request-cancel — auth-failure window', () => {
  test('cancellation during T-7d grace period treated as free regardless of time-to-windowStart', async () => {
    // Simulates UC-BS07 Alt Flow C
  });
});
```

Implementation notes:
- Compute `hoursToWindowStart = (startsAt - now) / (3600 * 1000)`.
- Branch on the three tiers.
- For free tier: UpdateItem with status CANCELLED, USER_CANCELLED_FREE. Delete the Scheduler rule via SDK `DeleteSchedule`.
- For 50% tier: compute halfAmount, capture or fresh-PI as appropriate, distribute via Connect Transfers, write settlement, transition status.
- For no-cancel tier: return 409 immediately, no state change.
- For auth-failure window detection: check if `authorisationRetryCount > 0 AND status === 'CONFIRMED' AND (a `block-auth-grace-{reqId}` scheduler rule exists OR a recent block-authorise failure event is in the auditLog)`.

---

### C10 — `block-guest-add`

**Endpoint:** `POST /api/v1/block-requests/{reqId}/guests`
**Auth:** Required (owner)
**Implements:** UC-BS04

Body: `{ guests: [{ name, email, phone }, ...] }` for bulk OR `{ guests: [{ name, email, phone }] }` for single-add.

**Tests first:** Cover:
- Adds N guests, materialises N BOOKING# rows via the bulk allocator
- Increments allocatedBayCount on the BLOCKALLOC#s
- Sends magic link emails
- Rejects with 400 OVER_ALLOCATION if the new total would exceed `sum(contributedBayCount)`
- Rejects with 400 DUPLICATE_GUEST_EMAIL if any new email matches an existing BOOKING# in this BLOCKREQ#
- Rejects with 409 WINDOW_CLOSED if `now > startsAt`
- Allows partial fill (under-allocation)
- Atomic: if any individual write fails, the entire batch is rolled back

Implementation: similar pattern to block-accept-plan's BOOKING# materialisation. Use the bulk allocator with the existing `assignedBayIds` minus already-occupied bays as the available pool.

---

### C11 — `block-guest-reassign`

**Endpoint:** `PATCH /api/v1/block-requests/{reqId}/guests/{bookingId}`
**Auth:** Required (owner)
**Implements:** UC-BS05

Body: either `{ targetBayId: 'bay-N' }` to swap to a specific bay OR `{ guestEmail: 'new@example.com', guestName: '...', guestPhone: '...' }` to update the guest details.

**Tests first:**
- Swap to a free target bay → updates BOOKING#.bayId, sends fresh magic link, appends auditLog entry
- Cross-pool swap (target bay is in a different BLOCKALLOC#) → updates both BLOCKALLOC#s' allocatedBayCount, swaps allocId on the BOOKING#
- Update guest email → sends fresh magic link to new email, anonymises old email immediately
- 400 if target bay is occupied
- 400 if target bay is not part of this BLOCKREQ#'s assigned bays
- 403 if non-owner

---

### C12 — `block-guest-anonymise`

**Trigger:** EventBridge Scheduler rule `guest-anonymise-{reqId}` at `endsAt + 48 hours`
**Implements:** UC-BS06 cleanup + GDPR right-to-be-forgotten for block guests

For each BOOKING# child of the BLOCKREQ#:
- Set `guestName = null`, `guestEmail = null`, `guestPhone = null`
- If `spotterId` is set AND that user has no other Spotzy activity (no other bookings, no listings, no chat messages), delete the stub user record entirely
- Otherwise leave the user record alone (they engaged with Spotzy beyond the magic link)

**Tests first:** Cover:
- Anonymises PII on all BOOKING# children
- Deletes stub users with no other activity
- Preserves stub users that have other activity
- Idempotent — calling twice produces the same final state

---

### C13 — `magic-link-claim`

**Endpoint:** `GET /claim/{token}` (public, no auth, bypasses Cognito)
**Implements:** UC-BS06 main flow

Token is a signed JWT with `{ bookingId, bayId, exp: endsAt + 48h }`. The signing secret lives in AWS Secrets Manager.

**Tests first:**
- Valid token: returns 200 with the bay info payload (poolName, address, bayLabel, accessInstructions, startsAt, endsAt, contactSupportLink), provisions a stub Spotter user keyed on guestEmail if no spotterId is set on the BOOKING#
- Expired token: returns 410 GONE
- Invalid signature: returns 401
- Token for a CANCELLED booking: returns 410 GONE with reason "Block reservation was cancelled"
- First click on a token: creates the stub user, sets BOOKING#.spotterId, returns the payload
- Second click: returns the payload directly (idempotent stub user provisioning)

Implementation notes:
- The Lambda is mounted at `/claim/{token}` in API Gateway with NO authorizer (public).
- It returns HTML directly (server-rendered minimal page) — NOT JSON. The frontend for the magic link page is a static HTML template inlined in this Lambda. This avoids needing the Block Spotter to have a frontend deployment URL handy.
- Alternatively (recommended): redirect to `https://spotzy.be/claim/{token}` where the Next.js frontend handles the rendering, and the Lambda just validates the token and returns the booking data via a separate `/api/v1/public/claim/{token}` endpoint that the frontend calls. This is the cleaner path.

---

### C14 — `block-payment-webhook`

**Endpoint:** `POST /api/v1/payments/block-webhook`
**Auth:** None (Stripe webhook signature verification instead)
**Implements:** Webhook handlers for Stripe events relevant to block reservations

This Lambda is SEPARATE from the existing `payment-webhook` Lambda from Session 04 to keep the v2.x block reservation logic isolated. Stripe webhook routing is configured to send events with `metadata.reqId` set to this endpoint.

**Tests first:** Cover handlers for these Stripe events:
- `payment_intent.amount_capturable_updated` (auth succeeded → no-op, just logged; the `block-authorise` Lambda already handles this synchronously)
- `payment_intent.payment_failed` for the deferred authorisation (purpose=authorise) → logs the failure, schedules the 24h grace rule
- `payment_intent.succeeded` for the settlement capture (purpose=capture) → no-op, the `block-settle` Lambda handles this synchronously
- `payment_intent.canceled` (auth voided) → logs to BLOCKREQ#.auditLog
- `charge.dispute.created` for any block-related charge → opens a backoffice case, no automatic clawback
- `transfer.created` for block Connect Transfers → updates the BLOCKALLOC#.settlement.transferStatus to CREATED
- `transfer.failed` → updates BLOCKALLOC#.settlement.transferStatus to FAILED, sends PagerDuty alert

Implementation:
- Verify Stripe-Signature header using the webhook signing secret from Secrets Manager.
- Parse the event, dispatch on `event.type`.
- Each handler is a small function that updates the relevant DynamoDB record and optionally publishes a downstream event (e.g. `block.transfer.failed` for the alerting Lambda).

---

## PART D — Frontend screens

All Block Spotter frontend screens go in `frontend/app/block-requests/` and follow the design system from UIUX v10. The 8 screens correspond exactly to UC-BS01 through UC-BS08.

### D1 — Dashboard tab + persona switcher integration

The Block Spotter tab is added to the main navigation. It only appears when the user has at least one BLOCKREQ# row OR has used the persona switcher to activate the Block Spotter persona. Implementation lives in `frontend/components/Navigation.tsx`:

- New top-level tab "Block Requests" with route `/block-requests`
- Tab is persona-gated — appears only when `activePersona === 'BLOCK_SPOTTER'` or when the user has any BLOCKREQ# rows
- Persona switcher (the small persona pill next to the avatar) lists Block Spotter as a switchable persona for any user with at least one BLOCKREQ#

**Tests first:** `frontend/__tests__/navigation/block-requests-tab.test.tsx`

### D2 — UC-BS01 — Submit Block Reservation Request

**Route:** `/block-requests/new`
**Component:** `frontend/app/block-requests/new/page.tsx`

The form layout matches UIUX v10 UC-BS01 spec exactly. Component tests cover:

- First-time soft verification modal (companyName + Belgian VAT) — shows when `userProfile.companyName` is null, blocks form access until completed
- Soft verification VAT format validation (BE0XXXXXXXXX regex) — inline error
- Window picker validation: rejects `endsAt <= startsAt`, rejects `startsAt < now + 24h`, rejects 7+ day window
- BayCount stepper enforces 2-500 bounds
- Live cost preview updates on bayCount change
- Preferences panel collapsed by default, expands on toggle click
- Six preference fields render correctly (slider for rating, toggles, integer steppers, Mapbox location picker)
- Optional CSV guest upload with row-level validation preview
- Submit button disabled until all required fields valid
- On submit: POSTs to `/api/v1/block-requests`, redirects to `/block-requests/{reqId}` on 201
- On error: shows inline banner

### D3 — UC-BS02 — Review Plans

**Route:** `/block-requests/{reqId}` (when status is PLANS_PROPOSED)
**Component:** `frontend/app/block-requests/[reqId]/PlansReview.tsx`

Component tests cover:

- Shows 1-3 plan cards in tiebreak order
- Each plan card shows worst/best/projected cost with helper tooltips
- Each plan card shows allocation list (pool name, photo, contributedBayCount, walking distance, rating, per-bay price)
- Plan rationale chip ("Lowest cost", "Fewest counterparties", etc.)
- "Accept this plan" button opens validation charge modal
- "Edit request" button navigates back to UC-BS01 with current values
- "View on map" opens a Mapbox modal showing all pools
- Empty result state with edit/relax CTAs
- Plan freshness banner if `proposedPlansComputedAt > now − 30 minutes`
- Validation charge modal: small Stripe Elements card field, cancellation policy summary, "Confirm and authorise" button
- On confirm: POSTs to `/accept`, shows loading spinner, redirects to confirmation screen on success

### D4 — UC-BS03 — Confirmation and Auth Wait

**Route:** `/block-requests/{reqId}` (when status is CONFIRMED or AUTHORISED)
**Component:** `frontend/app/block-requests/[reqId]/Confirmation.tsx`

Component tests cover:

- Status timeline with 5 stops (Confirmed → Auth pending → Authorised → Window active → Settled)
- Allocation summary card showing the accepted plan
- Payment status card showing current state (validation charge status, auth status)
- Polling every 30 seconds for status updates while in transitional states
- Countdown to T-7d when status is CONFIRMED
- Auth pending banner (amber)
- Auth failed banner (brick red) with "Update payment method" + "Cancel" CTAs and 24h grace countdown
- Action shelf tabs: Guests / Settings / Cancel
- Edit pencil enabled in PENDING_MATCH/PLANS_PROPOSED, replaced with locked tooltip after CONFIRMED

### D5 — UC-BS04 — Bulk Upload Guests

**Route:** `/block-requests/{reqId}/guests`
**Component:** `frontend/app/block-requests/[reqId]/guests/page.tsx`

Component tests cover:

- Tabs for Bulk upload / Add one (last-used persistence via localStorage)
- CSV dropzone with file type and size validation
- CSV preview table with row-level validation status
- Allocation preview computed on the client (calls a `/preview` endpoint on the server) showing exact bay assignments
- Capacity warning if upload exceeds remaining bays
- Confirm bulk upload posts to `/guests` endpoint
- Single-add form with inline field validation
- Guest list table with sortable columns and per-row actions
- Allocation status sidebar with live progress bar
- Cutoff at windowStart: form disabled with tooltip

### D6 — UC-BS05 — Manual Reassignment Modal

**Component:** `frontend/components/block-requests/ReassignModal.tsx` (used inline from D5)

Component tests cover:

- Current assignment summary card
- Bay picker grouped by pool
- Cross-pool warning banner with confirm checkbox
- Reassign action: PATCH to guest endpoint, fresh magic link sent (server-side)
- Audit log side drawer

### D7 — UC-BS06 — Magic Link Landing Page

**Route:** `/claim/{token}`
**Component:** `frontend/app/claim/[token]/page.tsx`

This is a public route (no auth wrapper). Component tests cover:

- Loads booking data from `/api/v1/public/claim/{token}`
- Hero with pool name + Mapbox static map preview
- Bay info card (mint background, bay label, time window)
- Access instructions card
- Action shelf: "Open in maps" + "Add to wallet" (.pkpass / Google Wallet pass generation)
- Spotzy contact card (mediated, no Spot Manager direct contact)
- Returning visit "Welcome back" banner (detected via local storage flag set on first click)
- Expired link state (410 GONE response → red banner)
- "Add to wallet" generates a .pkpass file by calling `/api/v1/public/claim/{token}/wallet-pass`

### D8 — UC-BS07 — Cancellation Modal

**Component:** `frontend/components/block-requests/CancelModal.tsx`

Component tests cover:

- Three-tier policy timeline visualization with current position pin
- Tier-specific copy block (free / partial / locked)
- Required reason textarea (min 20 chars in partial tier)
- Tier-specific confirm button (Brick "Cancel" or "Cancel and capture 50%" or disabled with "Contact support" link)
- Confirm action: DELETEs to `/block-requests/{reqId}` with reason
- Success flow: closes modal, navigates to dashboard, shows toast

### D9 — UC-BS08 — Settlement Summary

**Route:** `/block-requests/{reqId}/settlement` (only accessible when status is SETTLED)
**Component:** `frontend/app/block-requests/[reqId]/settlement/page.tsx`

Component tests cover:

- Header card with totals (Authorised / Captured / Refund)
- Per-allocation breakdown cards
- Risk-share visualization (small horizontal bar charts)
- Line items table for accounting reconciliation
- PDF invoice download button (calls `/block-requests/{reqId}/invoice.pdf`)
- CSV export button
- Dispute action link

---

## PART E — CDK additions

### E1 — Lambda function definitions

Add to `lib/api-stack.ts` (or a new `lib/block-reservations-stack.ts` if you want to keep v2.x infrastructure isolated — the architecture doc §10.5 explicitly recommends a separate stack for AgentStack so following the same pattern for BlockReservationsStack is reasonable):

```typescript
// 14 new Lambda functions, one per Lambda from PART C
const blockRequestCreate = mkLambda('block-request-create', 'functions/block-reservations/request-create');
const blockRequestUpdate = mkLambda('block-request-update', 'functions/block-reservations/request-update');
// ... etc for all 14
```

Wire each Lambda to the appropriate API Gateway route from PART C. Use the existing Cognito JWT authorizer for the user-facing endpoints. The webhook endpoint uses Stripe signature verification (no Cognito).

### E2 — DynamoDB GSI additions

Add the following GSI projections to the existing `spotzy-main` table (in `lib/data-stack.ts`):

```typescript
// GSI1 — BLOCK_OWNER pattern (Block Spotter dashboard)
// PK: BLOCK_OWNER#{ownerUserId}
// SK: BLOCKREQ#{createdAt}#{reqId}
//
// This is technically already covered by the USER#{userId} BLOCKREQ#{reqId} reverse projection
// (a single Query on PK = USER#X BEGINS_WITH BLOCKREQ# returns all requests for the user).
// No new GSI needed if you go that route. The architecture doc §6.2 documents both options;
// the reverse projection is preferred because it doesn't increase index storage.

// GSI1 — POOL pattern (Spot Manager portfolio)
// PK: POOL#{poolListingId}
// SK: BLOCKALLOC#{createdAt}#{allocId}
//
// Similarly covered by the LISTING#{poolListingId} BLOCKALLOC#{allocId} reverse projection.
```

Both reverse projections are written by the relevant Lambdas (block-accept-plan writes the BLOCKALLOC# reverse, block-request-create writes the BLOCKREQ# reverse). No CDK changes needed for GSIs in this session — the projections live as additional rows on the same table.

### E3 — EventBridge Scheduler permissions

Add an IAM policy to the Lambda execution role allowing `block-accept-plan`, `block-authorise` (for the grace rule), and `block-request-cancel` to call:

```typescript
new iam.PolicyStatement({
  actions: [
    'scheduler:CreateSchedule',
    'scheduler:DeleteSchedule',
    'scheduler:UpdateSchedule',
    'scheduler:GetSchedule',
  ],
  resources: ['*'],  // Schedules are namespaced by name; ARN restrictions are difficult
});
```

Also create a single shared `SchedulerRole` (IAM role) that EventBridge Scheduler assumes when it invokes the target Lambdas. This role needs `lambda:InvokeFunction` for the four target Lambdas (block-authorise, block-settle, block-guest-anonymise, block-cancel-auth-failed).

### E4 — EventBridge bus rules

Add an EventBridge rule on the default event bus that routes `block.request.created` and `block.request.updated` events to the `block-match` Lambda:

```typescript
new events.Rule(this, 'BlockRequestCreatedRule', {
  eventPattern: {
    source: ['spotzy.block-reservations'],
    detailType: ['block.request.created', 'block.request.updated'],
  },
  targets: [new targets.LambdaFunction(blockMatch)],
});
```

### E5 — Stripe webhook endpoint configuration

Add the `block-payment-webhook` Lambda's URL to the Stripe webhook configuration via the Stripe dashboard or via an Application configuration step. Subscribe to:

- `payment_intent.amount_capturable_updated`
- `payment_intent.payment_failed`
- `payment_intent.succeeded`
- `payment_intent.canceled`
- `charge.dispute.created`
- `transfer.created`
- `transfer.failed`

### E6 — SES email templates

Add the following email templates in `infrastructure/email-templates/`:

- `block-confirmation.html` — sent on plan acceptance (UC-BS03 step 3)
- `block-magic-link.html` — sent to each guest with the magic link (UC-BS03 step 5, UC-BS04 step 9)
- `block-auth-success.html` — sent on T-7d authorisation success (UC-BS03 step 10)
- `block-auth-failed.html` — sent on T-7d authorisation failure (UC-BS03 step 12)
- `block-auto-cancelled.html` — sent on auto-cancel after grace period expiry
- `block-cancellation-receipt.html` — sent on UC-BS07 cancellation
- `block-settlement.html` — sent on UC-BS08 settlement completion

Each template uses the Spotzy brand header (forest #004526 band, white logo) and the standard footer with the Spotzy address and unsubscribe link.

### E7 — Secrets Manager

Add a new secret `spotzy/block-reservations/magic-link-signing-key` containing the JWT signing key for magic link tokens. The key is a 256-bit base64-encoded random value generated at deployment time. Used by `block-accept-plan` (signing) and `magic-link-claim` (verification).

---

## PART F — Integration tests

`backend/__tests__/integration/block-reservations.integration.test.ts`

These tests run against DynamoDB Local and use the real allocator. They cover the full lifecycle of a block reservation from creation through settlement.

```typescript
describe('Block reservation full lifecycle', () => {
  test('end-to-end: create → match → accept → authorise → settle', async () => {
    // 1. Seed two Spot Manager pools with available bays
    const pool1 = await seedSpotPool({ totalBayCount: 15, pricePerBayEur: 25, riskShareMode: 'PERCENTAGE' });
    const pool2 = await seedSpotPool({ totalBayCount: 10, pricePerBayEur: 30, riskShareMode: 'MIN_BAYS_FLOOR' });

    // 2. Create a block request for 20 bays
    const createResult = await blockRequestCreate.handler(mockAuthEvent('user-1', {
      body: { startsAt: '...', endsAt: '...', bayCount: 20, /* ... */ },
    }));
    const { reqId } = JSON.parse(createResult.body);

    // 3. Trigger matching
    await blockMatch.handler({ detail: { reqId } });

    // 4. Verify plans were computed
    const req = await getDynamoItem(`BLOCKREQ#${reqId}`, 'METADATA');
    expect(req.status).toBe('PLANS_PROPOSED');
    expect(req.proposedPlans.length).toBeGreaterThan(0);

    // 5. Accept the first plan
    const acceptResult = await blockAcceptPlan.handler(mockAuthEvent('user-1', {
      pathParameters: { reqId },
      body: { planIndex: 0 },
    }));
    expect(acceptResult.statusCode).toBe(200);

    // 6. Verify BLOCKALLOC# rows exist
    const allocs = await queryDynamo(`BLOCKREQ#${reqId}`, 'BLOCKALLOC#');
    expect(allocs.length).toBeGreaterThan(0);

    // 7. Add 18 guests via bulk upload
    const guests = Array.from({ length: 18 }, (_, i) => ({ name: `Guest ${i}`, email: `g${i}@example.com`, phone: '+32475111222' }));
    await blockGuestAdd.handler(mockAuthEvent('user-1', { pathParameters: { reqId }, body: { guests } }));

    // 8. Trigger T-7d authorisation
    await blockAuthorise.handler({ detail: { reqId } });
    const reqAfterAuth = await getDynamoItem(`BLOCKREQ#${reqId}`, 'METADATA');
    expect(reqAfterAuth.status).toBe('AUTHORISED');
    expect(reqAfterAuth.authorisationId).toBeDefined();

    // 9. Trigger settlement
    await blockSettle.handler({ detail: { reqId } });
    const reqAfterSettle = await getDynamoItem(`BLOCKREQ#${reqId}`, 'METADATA');
    expect(reqAfterSettle.status).toBe('SETTLED');
    expect(reqAfterSettle.settlementBreakdown).toBeDefined();
    expect(reqAfterSettle.settlementBreakdown.capturedEur).toBeGreaterThan(0);
  });

  test('cancellation in free tier voids nothing', async () => { /* ... */ });
  test('cancellation in 50% tier captures half and distributes', async () => { /* ... */ });
  test('over-allocation rejected at upload time', async () => { /* ... */ });
  test('plan stale handling', async () => { /* ... */ });
  test('auth failure → 24h grace → auto-cancel', async () => { /* ... */ });
});
```

---

## PART G — E2E tests (Playwright)

`e2e/block-reservations.spec.ts`

```typescript
test.describe('Block Spotter happy path', () => {
  test('user creates request, accepts plan, sees confirmation', async ({ page }) => {
    // Login as Block Spotter test user
    // Navigate to /block-requests/new
    // Fill in soft verification (first time only)
    // Fill in window picker
    // Set bayCount to 5
    // Tap "Find matching plans"
    // On plans review screen, tap "Accept this plan"
    // Confirm validation charge in Stripe Elements modal
    // Verify navigation to confirmation screen
    // Verify status timeline shows Confirmed
    // Verify payment status shows "Validation charge captured and voided"
  });

  test('user uploads bulk guests via CSV', async ({ page }) => { /* ... */ });
  test('user cancels in free tier', async ({ page }) => { /* ... */ });
  test('user views settlement summary after window end', async ({ page }) => { /* ... */ });
});
```

---

## PART H — Migration notes

Anyone running this session sequentially after the older session 24 (Corporate Guest) needs to be aware that **session 24 should NOT be run for v2.x**. The CORP#/MEMBER# entity model from session 24 is not part of the v2.x scope and would create stranded entities on the table. If you've already run session 24 in a development environment, you can leave the data in place — it's harmless — but no v2.x feature reads from those rows.

There is no data migration required from session 24 to session 27. They are unrelated entities.

---

## Acceptance criteria for this session

A successful Claude Code run of this session produces:

1. All 14 Lambda functions in `backend/src/functions/block-reservations/` with passing tests
2. Shared helpers in `backend/src/shared/block-reservations/` (constants, types, validation, allocator)
3. The bulk allocator passes all determinism, capacity, geo bias, and cost optimization tests
4. The Stripe Option C flow is wired end-to-end (validation charge, deferred auth, settlement capture, distribution)
5. EventBridge Scheduler rules are created and managed correctly (block-auth-, block-settle-, guest-anonymise-, block-auth-grace-)
6. Magic link claim endpoint is publicly accessible and returns the right payload
7. All 8 frontend screens (UC-BS01 through UC-BS08) are implemented and component-tested
8. The Block Requests navigation tab is persona-gated and shows up correctly
9. The integration test for the full lifecycle passes against DynamoDB Local
10. The Playwright E2E test for the happy path passes against staging
11. CDK synthesizes cleanly with all new Lambdas, IAM policies, EventBridge rules, and SES templates
12. The functional specs UC-BS01 through UC-BS08 are exhaustively covered — every "Main Flow" step has corresponding test coverage

Open questions to resolve at implementation time:

1. **Pool listing search filter** — the `block-match` Lambda needs to query all opted-in pools efficiently. Does the existing Spot Pool listing model from session 26 already include a `POOL_OPTED_IN` GSI, or does block-match need to scan? Verify with the session 26 prompt before starting.
2. **Stripe Customer ID** — the Block Spotter must have a `stripeCustomerId` set on their USER# PROFILE before accepting a plan. If they don't, where is the customer created? Either: (a) lazily by `block-accept-plan` (creates the customer on first acceptance), or (b) eagerly by the soft verification flow in `block-request-create`. Recommendation: lazy creation in block-accept-plan, since not every block request leads to acceptance.
3. **Magic link wallet pass generation** — the `.pkpass` and Google Wallet pass generation need a separate library. Recommendation: defer to a follow-up session if the implementation effort is high; ship UC-BS06 with just the "Open in maps" CTA in the first cut.
4. **Settlement failure recovery** — if the settlement capture or any individual transfer fails, what's the manual recovery path? The Lambda writes a `settlementError` field and notifies admin via PagerDuty, but there's no admin UI for manually retrying. This is open question Q10 in architecture v10 §13.

---

## Reading order for Claude Code

When feeding this file to Claude Code, the recommended sequence is:

1. PART A (constants, types, validation, allocator) — ground all the shared helpers
2. PART B (allocator tests + impl) — the most testable pure function, highest confidence
3. PART C, sub-parts in this order:
   - C1 + C2 + C3 + C4 (CRUD on BLOCKREQ#)
   - C5 (block-match) — depends on the allocator from B
   - C6 (block-accept-plan) — the most complex single Lambda, depends on C1-C5
   - C9 (cancel) — independent of payment lifecycle except for the 50% tier
   - C7 (block-authorise) — depends on C6
   - C8 (block-settle) — depends on C7
   - C10 + C11 (guest add/reassign) — depends on C6
   - C12 (anonymise) — independent
   - C13 (magic-link-claim) — depends on JWT signing config from C6
   - C14 (block-payment-webhook) — wires all the above into the Stripe event stream
4. PART D (frontend) — can run in parallel with backend but needs the API contracts stable first
5. PART E (CDK) — last, after all Lambdas are implemented
6. PART F (integration tests)
7. PART G (E2E)

Each Lambda is independently testable. Don't try to write all 14 in one shot — work through them one at a time, with the TDD red-green-refactor cycle on each.
