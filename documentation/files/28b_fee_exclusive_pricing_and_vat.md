# Session 28b — Fee-Exclusive Pricing and VAT (v2.x)

## Corrective supplement to Session 28 — Model B pricing · Spot Manager VAT registration · Spotter price breakdown · Block reservation gross-with-fee display · Belgian compliance

> ⚠ **v2.x SCOPE — corrects gaps in Sessions 02, 04, 26, 27, and 28**
> Prerequisite sessions: 00–22, 26, 27, 28, 21b. Session 29 and Session 30 (localization) are NOT prerequisites — this session can be deployed before or after them, but if deployed before, the new translation strings will need to be added to the localization workflow afterward.
>
> **Why this session exists.** Sessions 28 and 04 implemented a fee-inclusive pricing model where the Host's `pricePerHourEur` was the price the Spotter paid, and the 15% platform fee was deducted at settlement. This created two gaps: (a) the Host had no idea what they actually earned (no breakdown shown on the form, just the gross input), and (b) the Spotter saw the gross price but no service-fee disclosure. Both are violations of Belgian and EU consumer transparency expectations and the Belgian "prix tout compris" / "totaalprijs" requirements from Code de droit économique Livre VI.
>
> Additionally, the original specs made no provision for VAT — neither how Hosts collect it (if they're VAT-registered) nor how Spotzy collects it on its platform fee. Both are mandatory for Belgian launch.
>
> **This session implements Model B (fee-exclusive) pricing with full VAT support across the four product surfaces:**
> 1. **Hosts enter their net rate** (what they earn). The form shows a live "≈ what the Spotter pays" preview that includes Spotzy's fee gross-up and any applicable VAT.
> 2. **Spotters see a single all-in price** as the headline (B1 model — the gross with fees and VAT). At the booking summary step, the breakdown is shown explicitly: base × duration, service fee, VAT, total.
> 3. **Block Spotters see worst-case / best-case / projected-case** figures that are gross-with-fee (the actual amount they'll be charged). The breakdown is available via an expander.
> 4. **Spot Managers self-declare VAT status** during the commitment gate (UC-SM00 step extension). The default for new accounts is `EXEMPT_FRANCHISE` (under €25k Belgian small enterprise threshold). Commercial Spot Managers can opt into `VAT_REGISTERED` and provide a Belgian VAT number.
>
> **Source of truth:** Functional specs v22 (this session updates v21 → v22), Architecture v10 §6.2 (entity model extensions), this prompt for the implementation details. After this session ships, FS v22 supersedes FS v21.

---

## Critical decisions locked in this session

These decisions were debated and decided before this session was written. They are not open for re-litigation during implementation — if they need to change, that's a v3+ task with its own decision process.

| Decision | Choice | Rationale |
|---|---|---|
| Pricing model | **Model B (fee-exclusive)** | Host enters net, system grosses up. Aligns with EU/Belgian consumer expectations and Airbnb/Booking.com convention. Spotter always sees what they pay. |
| Headline price display | **B1 (gross headline)** | Spotter sees the all-in number `spotterGrossTotal / hours` on listing cards and search results. The breakdown is shown only at the booking summary step. Different from Airbnb's net-headline approach but more honest in search results. |
| Block reservation worst-case display | **Gross-with-fee** | Block Spotters care about their own budget, not the Host's accounting. The figures shown in UC-BS03 plans are the actual amounts the Block Spotter will be charged. |
| VAT scenario | **Scenario 3 — mixed marketplace, default to exempt** | Most launch Hosts are casual individuals under the €25k Belgian small enterprise threshold. Commercial Spot Managers self-declare VAT status during the commitment gate. |
| VAT number validation | **Format + Mod-97 checksum** | Belgian VAT numbers are `BE0` + 9 digits with a Mod-97 checksum on the last 2 digits. Format-only validation lets typos through; live VIES lookup adds a runtime dependency we don't need for v2.x. Mod-97 catches typos at zero infrastructure cost. |
| VAT rate for parking | **Standard 21%** | Belgian VAT on parking rental is the standard rate. No reduced-rate edge cases apply to Spotzy's marketplace model (the residential-rental exemption requires the parking to be incidental to a dwelling rental, which never applies here). |
| Existing booking immunity | **Snapshot priceBreakdown at booking creation** | Future fee changes, VAT rate changes, and Host VAT status changes do NOT affect already-created bookings. Every booking carries its own complete price breakdown. |

---

## What this session builds

This is a corrective supplement that touches:

| Component | Files affected | Scope |
|---|---|---|
| Schema | USER PROFILE, LISTING METADATA, BOOKING METADATA, BLOCKALLOC METADATA | Add VAT status fields + rename pricing fields + add `priceBreakdown` snapshot |
| Pricing function | `backend/src/shared/pricing/tiered-pricing.ts` (from Session 28) | Add `computeFullPriceBreakdown()` helper + extend `generatePriceQuote()` |
| Validation | `backend/src/shared/pricing/validation.ts` (new) | Mod-97 Belgian VAT number checksum |
| Lambdas (5 updated) | `listing-create`, `listing-update`, `booking-quote`, `booking-create`, `booking-confirmed` | Use new pricing function, snapshot breakdown |
| Lambdas (3 updated from Session 27) | `block-confirm-plan`, `block-settle`, `block-cancel` | Snapshot breakdown at confirmation, use snapshot at settlement |
| Lambda (1 updated from Session 26) | `rc-submission-create` | Capture VAT status in commitment gate |
| Frontend (5 updated) | UC-H01 pricing form, UC-S04 booking summary, UC-S01/S02 listing card, UC-BS03 plan display, UC-SM00 commitment gate wizard | Show net→gross preview, breakdown at checkout, gross headline, VAT status step |
| Config | `CONFIG#VAT_RATES` singleton (new) | Belgian standard rate, admin-editable for future rate changes |
| Email templates (3 updated) | `booking-confirmed`, `block-confirmation`, `block-settlement` | Add breakdown lines including VAT |

This session does NOT add new use cases or new personas. It corrects existing ones.

---

## Critical constants

```typescript
// backend/src/shared/pricing/vat-constants.ts
// New file — extends the constants from Session 28

export type VATStatus = 'NONE' | 'EXEMPT_FRANCHISE' | 'VAT_REGISTERED';

export const VAT_STATUS_DEFAULT: VATStatus = 'EXEMPT_FRANCHISE';
// New accounts default to EXEMPT_FRANCHISE because the overwhelming majority of casual Hosts
// fall under the Belgian small enterprise threshold (€25,000 annual turnover, "régime de la
// franchise" / "vrijstellingsregeling"). Commercial Spot Managers can opt in to VAT_REGISTERED
// during the UC-SM00 commitment gate.

export const BELGIAN_SMALL_ENTERPRISE_THRESHOLD_EUR = 25_000;
// Reference value for documentation and for the help text in the VAT status form.
// Spotzy does NOT track Host turnover or enforce this threshold — it's the Host's
// responsibility to upgrade to VAT_REGISTERED when they exceed it.

export const BELGIAN_STANDARD_VAT_RATE = 0.21;
// 21% is the Belgian standard VAT rate as of April 2026. Used as the default seed
// for CONFIG#VAT_RATES METADATA.belgianStandardRate.

export const SPOTZY_VAT_RATE = 0.21;
// VAT rate Spotzy applies to its own platform fee. Spotzy is VAT-registered (it's a
// commercial marketplace, well above any threshold). This is always 21% regardless
// of the Host's status.

export const VAT_NUMBER_REGEX_BE = /^BE0\d{9}$/;
// Belgian VAT number format: BE0 followed by exactly 9 digits.
// The Mod-97 checksum is validated separately by validateBelgianVATNumber().

// Display thresholds for the breakdown UI
export const PRICE_DISPLAY_DECIMAL_PLACES = 2;
export const PRICE_DISPLAY_CURRENCY = 'EUR';
```

These constants live in a new file and are imported by the pricing function, the validation helpers, and the Lambdas. Hard-coding any of these inline is a code review failure.

---

## DynamoDB schema changes

All on the existing `spotzy-main` table. No new tables.

### USER PROFILE additions

```
PK: USER#{userId}                        SK: PROFILE
  // Existing fields unchanged.
  // New fields for VAT support:
  vatStatus (NONE | EXEMPT_FRANCHISE | VAT_REGISTERED)  // default NONE for new accounts pre-onboarding;
                                                         // set to EXEMPT_FRANCHISE on first listing creation
                                                         // unless the user explicitly chose VAT_REGISTERED
                                                         // during the UC-SM00 commitment gate
  vatNumber (string | null)                              // Belgian VAT number "BE0XXXXXXXXX", null unless
                                                         // vatStatus = VAT_REGISTERED
  vatRegisteredSince (ISO date | null)                   // date the user transitioned to VAT_REGISTERED;
                                                         // null if they never have. Used for historical
                                                         // accuracy when looking at old bookings.
  vatStatusLastChangedAt (ISO timestamp | null)          // audit trail for VAT status changes
  vatStatusLastChangedBy (userId | null)                 // self-change vs admin-change indicator
```

The `vatStatus` field is set in three places:

1. **Implicit on first listing creation**: if the user creates a listing and `vatStatus` is `NONE`, it transitions to `EXEMPT_FRANCHISE` automatically (the default for casual Hosts).
2. **Explicit during UC-SM00 commitment gate**: the Spot Manager onboarding flow asks the user to confirm or change their VAT status. They can pick `EXEMPT_FRANCHISE` (default) or `VAT_REGISTERED` (with a VAT number).
3. **Self-update via account settings**: the user can change their VAT status at any time from `/account/vat-settings`. Changing the status only affects FUTURE bookings and listings; existing bookings retain their snapshotted breakdown.

### LISTING METADATA additions and renames

```
PK: LISTING#{listingId}                  SK: METADATA
  // Existing fields unchanged EXCEPT the pricing field rename.

  // RENAMED:
  // pricePerHourEur (from Session 28) → hostNetPricePerHourEur
  hostNetPricePerHourEur (number, > 0, < 1000)   // The Host's net rate per hour, BEFORE VAT and BEFORE
                                                  // Spotzy's platform fee gross-up. This is what the Host
                                                  // sees on their pricing form as "what you earn".
                                                  // Replaces the old pricePerHourEur field — see migration
                                                  // notes below.

  // The three discount percentages are unchanged (dailyDiscountPct, weeklyDiscountPct, monthlyDiscountPct)

  // NEW:
  hostVatStatusAtCreation (NONE | EXEMPT_FRANCHISE | VAT_REGISTERED)
    // Snapshot of the Host's VAT status at the moment the listing was created.
    // This is REQUIRED on every listing — the field is set by listing-create from
    // USER#{userId}/PROFILE.vatStatus at creation time.
    //
    // Purpose: makes the listing's pricing display deterministic and immune to future
    // changes in the Host's VAT status. If a Host is EXEMPT today and the listing shows
    // €2.85/h to Spotters, then the Host upgrades to VAT_REGISTERED next month, the
    // listing should KEEP showing €2.85/h until the Host explicitly re-edits the listing
    // (which triggers a re-snapshot). New listings created after the status change use
    // the new status.
    //
    // Without this snapshot, a Host's VAT change would silently change the prices of all
    // their existing listings, which is bad for both Host UX and Belgian consumer law
    // ("the price advertised must be the price charged").
```

### BOOKING METADATA additions

```
PK: BOOKING#{bookingId}                  SK: METADATA
  // Existing fields unchanged.
  // NEW:
  priceBreakdown {
    // The complete price breakdown captured at booking creation time.
    // Once written, this object is IMMUTABLE — settlement uses these exact values,
    // not recomputed values. Future fee or VAT rate changes do not affect it.

    hostNetTotalEur: number,           // Host's earnings before VAT and before Spotzy's fee. This is
                                        // computed from hostNetPricePerHourEur × tier-aware duration math
                                        // (see pricing function).

    hostVatRate: number,               // 0.21 if the listing's hostVatStatusAtCreation is VAT_REGISTERED,
                                        // 0 otherwise. Snapshot — does not change after creation.

    hostVatEur: number,                // hostNetTotalEur × hostVatRate. The VAT collected on the Host's
                                        // portion. Goes to the Host (who then remits to the Belgian
                                        // tax authority via their own VAT return). Zero for exempt Hosts.

    hostGrossTotalEur: number,         // hostNetTotalEur + hostVatEur. The total amount that goes to
                                        // the Host's Stripe Connect account (before Spotzy's fee deduction
                                        // — but Spotzy never sees this money in its own account; the fee
                                        // is taken via Stripe's application_fee mechanism).

    platformFeePct: number,            // Snapshot of CONFIG#PLATFORM_FEE.singleShotPct at booking creation.
                                        // 0.15 by default. Used so that future fee changes do not affect
                                        // historical bookings.

    platformFeeEur: number,            // Spotzy's cut on the host gross. Computed via gross-up:
                                        // platformFeeEur = hostGrossTotalEur × (platformFeePct / (1 - platformFeePct))
                                        // (See pricing function for the derivation.)

    platformFeeVatRate: number,        // 0.21 — Spotzy's own VAT rate. Spotzy is VAT-registered; this is
                                        // always 21% regardless of the Host's status. Snapshotted from
                                        // CONFIG#VAT_RATES.belgianStandardRate at booking creation.

    platformFeeVatEur: number,         // platformFeeEur × platformFeeVatRate. The VAT Spotzy collects
                                        // on its own service fee.

    spotterGrossTotalEur: number,      // hostGrossTotalEur + platformFeeEur + platformFeeVatEur. THE
                                        // HEADLINE NUMBER. This is what the Spotter actually pays via
                                        // Stripe. This number must match the total displayed at the
                                        // booking summary screen.

    currency: 'EUR',
    breakdownComputedAt: string,       // ISO timestamp for audit. When the breakdown was computed.

    // Tier metadata from Session 28 — unchanged but folded into the breakdown for completeness:
    appliedTier: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY',
    tierUnitsBilled: number,
    tierRateEur: number,               // The host net rate at the applied tier (e.g. €28.80 for daily
                                        // at €2/h × 24 × 0.6).
    durationHours: number,
  }
```

The old fields from Session 28 — `appliedTier`, `tierUnitsBilled`, `tierRateEur`, `platformFeeEur`, `platformFeePct` written by Session 28 — are REPLACED by the structured `priceBreakdown` object. The migration is straightforward (the field names move into the nested object) and is described in the migration section below.

### BLOCKALLOC METADATA additions

```
PK: BLOCKREQ#{reqId}                     SK: BLOCKALLOC#{allocId}
  // Existing fields from Session 27 unchanged.
  // NEW:
  priceBreakdown {
    // Same structure as BOOKING METADATA.priceBreakdown, but for the entire allocation
    // (which spans multiple bays × duration). Captured at the moment the Block Spotter
    // accepts the plan (UC-BS03 step 6), making it immutable from confirmation onward.

    hostNetTotalEur, hostVatRate, hostVatEur, hostGrossTotalEur,
    platformFeePct, platformFeeEur, platformFeeVatRate, platformFeeVatEur,
    spotterGrossTotalEur,
    currency: 'EUR',
    breakdownComputedAt: string,

    // Block-specific fields:
    bayCount: number,                  // The contributedBayCount from the allocation
    pricePerBayPerHourEur: number,     // The Host's net rate per bay per hour, snapshotted from
                                        // LISTING METADATA.hostNetPricePerHourEur at confirmation
    durationHours: number,
    riskShareMode: 'PERCENTAGE' | 'MIN_BAYS_FLOOR',  // Snapshot from the allocation
    riskShareRate: number,                            // 0.30 or 0.55, snapshot

    // Three breakdown variants for the worst-case / best-case / projected-case display:
    worstCaseSpotterGrossEur: number,    // What the Block Spotter would pay if EVERY bay is unused
                                          // (full risk-share applied to all bays)
    bestCaseSpotterGrossEur: number,     // What the Block Spotter would pay if EVERY bay is allocated
                                          // (no risk-share penalty)
    projectedSpotterGrossEur: number,    // bestCase × historicalAllocationRate (default 0.7 for first-timers)
  }
```

The settlement Lambda (`block-settle` from Session 27) uses the snapshotted `pricePerBayPerHourEur` and the snapshotted VAT/fee rates to compute the FINAL settlement amount based on actual allocations. The math is deterministic and does not depend on current config values — only on the snapshotted values.

### CONFIG#VAT_RATES singleton (new)

```
PK: CONFIG#VAT_RATES                     SK: METADATA
  belgianStandardRate (number, default 0.21)
  // Editable by Spotzy admins via the backoffice in case the rate ever changes.
  // Belgium reduced VAT to 6% on some categories during COVID — having a config row
  // means future rate changes do not require code deployment, only a backoffice edit
  // and a redeployment of the new default value would happen via a manual override.

  lastModifiedBy (adminUserId | null)
  lastModifiedAt (ISO timestamp | null)
  historyLog [{ rate, modifiedBy, modifiedAt }]
  // Append-only history. Bounded to last 50 entries.
```

The VAT rate is read by the pricing function at booking creation time and snapshotted onto the `priceBreakdown.hostVatRate` (if applicable) and `priceBreakdown.platformFeeVatRate`. Future rate changes do NOT affect existing bookings — those keep their snapshot.

---

## PART A — Pricing function update

The pricing function from Session 28 (`backend/src/shared/pricing/tiered-pricing.ts`) gets a new top-level helper plus a critical change to how its existing functions are interpreted.

### A1 — Renaming and reinterpretation

The constants and types from Session 28 are extended:

```typescript
// backend/src/shared/pricing/types.ts (extended from Session 28)

import type { VATStatus } from './vat-constants';

export interface TieredPricing {
  // RENAMED from pricePerHourEur in Session 28.
  // The Host's NET rate per hour — what the Host receives, before VAT and before Spotzy's fee.
  hostNetPricePerHourEur: number;
  dailyDiscountPct: DiscountPct;
  weeklyDiscountPct: DiscountPct;
  monthlyDiscountPct: DiscountPct;
}

// New type — replaces the simpler PriceQuote from Session 28
export interface PriceBreakdown {
  hostNetTotalEur: number;
  hostVatRate: number;
  hostVatEur: number;
  hostGrossTotalEur: number;
  platformFeePct: number;
  platformFeeEur: number;
  platformFeeVatRate: number;
  platformFeeVatEur: number;
  spotterGrossTotalEur: number;
  currency: 'EUR';
  breakdownComputedAt: string;

  // From Session 28, preserved:
  appliedTier: PricingTier;
  tierUnitsBilled: number;
  tierRateEur: number;
  durationHours: number;
  cheaperAlternatives: CheaperAlternative[];
}

export interface CheaperAlternative {
  type: 'SHORTER' | 'LONGER';
  durationHours: number;
  // CHANGED from totalEur to spotterGrossTotalEur — the displayed alternative is the gross
  // figure the Spotter would actually save.
  spotterGrossTotalEur: number;
  savingsEur: number;
  description: string;
}
```

### A2 — New pricing function

Add to `backend/src/shared/pricing/tiered-pricing.ts`:

```typescript
import { SPOTZY_VAT_RATE, VATStatus } from './vat-constants';

interface ComputeBreakdownArgs {
  hostNetPricePerHourEur: number;
  dailyDiscountPct: DiscountPct;
  weeklyDiscountPct: DiscountPct;
  monthlyDiscountPct: DiscountPct;
  durationHours: number;
  hostVatStatus: VATStatus;
  belgianStandardVatRate: number;     // from CONFIG#VAT_RATES at the time of the call
  platformFeePct: number;             // from CONFIG#PLATFORM_FEE.singleShotPct at the time of the call
}

/**
 * Computes the full price breakdown for a single booking, including VAT and platform fee.
 *
 * Math (in order):
 *   1. hostNetTotal = strictTierTotal(durationHours, tieredPricing)  — the existing Session 28 function
 *   2. hostVatRate = (hostVatStatus === 'VAT_REGISTERED') ? belgianStandardVatRate : 0
 *   3. hostVat = round2(hostNetTotal × hostVatRate)
 *   4. hostGrossTotal = hostNetTotal + hostVat
 *   5. platformFee = round2(hostGrossTotal × platformFeePct / (1 - platformFeePct))
 *      // ^ This is the GROSS-UP formula. We want the Spotter's payment AFTER Spotzy takes the fee
 *      // to leave the Host with hostGrossTotal. If Spotzy charges P and keeps fee F = P × pct, then
 *      // Host receives P × (1 - pct). We want this to equal hostGrossTotal:
 *      //   P × (1 - pct) = hostGrossTotal
 *      //   P = hostGrossTotal / (1 - pct)
 *      //   F = P × pct = hostGrossTotal × pct / (1 - pct)
 *   6. platformFeeVatRate = SPOTZY_VAT_RATE (always 0.21 — Spotzy is VAT-registered)
 *   7. platformFeeVat = round2(platformFee × platformFeeVatRate)
 *   8. spotterGrossTotal = hostGrossTotal + platformFee + platformFeeVat
 *
 * Returns the full PriceBreakdown including cheaperAlternatives computed against
 * the spotterGrossTotal (so adjacent-duration suggestions reflect actual savings the
 * Spotter would experience, not host-side savings that include fee/VAT noise).
 */
export function computeFullPriceBreakdown(args: ComputeBreakdownArgs): PriceBreakdown {
  // Step 1: existing tier math (from Session 28)
  const tieredPricing: TieredPricing = {
    hostNetPricePerHourEur: args.hostNetPricePerHourEur,
    dailyDiscountPct: args.dailyDiscountPct,
    weeklyDiscountPct: args.weeklyDiscountPct,
    monthlyDiscountPct: args.monthlyDiscountPct,
  };
  const tier = selectTier(args.durationHours);
  const tierRateEur = computeTierRate(tier, tieredPricing);
  const tierUnitsBilled = computeTierUnits(args.durationHours, tier);
  const hostNetTotalEur = round2(tierUnitsBilled * tierRateEur);

  // Step 2-3: host VAT
  const hostVatRate = args.hostVatStatus === 'VAT_REGISTERED' ? args.belgianStandardVatRate : 0;
  const hostVatEur = round2(hostNetTotalEur * hostVatRate);

  // Step 4: host gross
  const hostGrossTotalEur = round2(hostNetTotalEur + hostVatEur);

  // Step 5: platform fee gross-up
  const platformFeeEur = round2(hostGrossTotalEur * args.platformFeePct / (1 - args.platformFeePct));

  // Step 6-7: platform fee VAT
  const platformFeeVatRate = SPOTZY_VAT_RATE;
  const platformFeeVatEur = round2(platformFeeEur * platformFeeVatRate);

  // Step 8: spotter gross total
  const spotterGrossTotalEur = round2(hostGrossTotalEur + platformFeeEur + platformFeeVatEur);

  // Cheaper alternatives — computed by varying durationHours and comparing spotterGrossTotalEur
  const cheaperAlternatives = computeCheaperAlternatives(args, spotterGrossTotalEur);

  return {
    hostNetTotalEur,
    hostVatRate,
    hostVatEur,
    hostGrossTotalEur,
    platformFeePct: args.platformFeePct,
    platformFeeEur,
    platformFeeVatRate,
    platformFeeVatEur,
    spotterGrossTotalEur,
    currency: 'EUR',
    breakdownComputedAt: new Date().toISOString(),
    appliedTier: tier,
    tierUnitsBilled,
    tierRateEur,
    durationHours: args.durationHours,
    cheaperAlternatives,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeCheaperAlternatives(
  args: ComputeBreakdownArgs,
  currentSpotterGross: number
): CheaperAlternative[] {
  // Same +/- 5 hour window heuristic as Session 28, but the comparison is against
  // spotterGrossTotalEur (not the Session 28 hostNetTotal).
  const alternatives: CheaperAlternative[] = [];

  // Try shorter durations (max 5 hours back, never below 1)
  let bestShorter: CheaperAlternative | null = null;
  for (let delta = 1; delta <= 5 && args.durationHours - delta >= 1; delta++) {
    const candidate = computeFullPriceBreakdown({ ...args, durationHours: args.durationHours - delta });
    const savings = round2(currentSpotterGross - candidate.spotterGrossTotalEur);
    if (savings >= CHEAPER_ALTERNATIVE_MIN_SAVINGS_EUR) {
      if (!bestShorter || savings > bestShorter.savingsEur) {
        bestShorter = {
          type: 'SHORTER',
          durationHours: args.durationHours - delta,
          spotterGrossTotalEur: candidate.spotterGrossTotalEur,
          savingsEur: savings,
          description: `Booking ${args.durationHours - delta} hours instead of ${args.durationHours} saves €${savings.toFixed(2)}`,
        };
      }
    }
  }
  if (bestShorter) alternatives.push(bestShorter);

  // Try longer durations (max 5 hours forward)
  let bestLonger: CheaperAlternative | null = null;
  for (let delta = 1; delta <= 5; delta++) {
    const candidate = computeFullPriceBreakdown({ ...args, durationHours: args.durationHours + delta });
    const savings = round2(currentSpotterGross - candidate.spotterGrossTotalEur);
    if (savings >= CHEAPER_ALTERNATIVE_MIN_SAVINGS_EUR) {
      if (!bestLonger || savings > bestLonger.savingsEur) {
        bestLonger = {
          type: 'LONGER',
          durationHours: args.durationHours + delta,
          spotterGrossTotalEur: candidate.spotterGrossTotalEur,
          savingsEur: savings,
          description: `Booking ${args.durationHours + delta} hours instead of ${args.durationHours} saves €${savings.toFixed(2)}`,
        };
      }
    }
  }
  if (bestLonger) alternatives.push(bestLonger);

  return alternatives;
}
```

### A3 — Tests for the new pricing function

**Tests first:** `backend/__tests__/shared/pricing/full-breakdown.test.ts`

```typescript
import { computeFullPriceBreakdown } from '../../../src/shared/pricing/tiered-pricing';
import { SPOTZY_VAT_RATE } from '../../../src/shared/pricing/vat-constants';

const baseArgs = {
  hostNetPricePerHourEur: 2.00,
  dailyDiscountPct: 0.60 as const,
  weeklyDiscountPct: 0.60 as const,
  monthlyDiscountPct: 0.60 as const,
  belgianStandardVatRate: 0.21,
  platformFeePct: 0.15,
};

describe('computeFullPriceBreakdown — exempt Host (most common case)', () => {
  test('25-hour booking on €2/hour exempt Host with 60% daily discount', () => {
    // Step 1: tier = DAILY, tierRate = 2 × 24 × 0.6 = €28.80, units = ceil(25/24) = 2
    //         hostNetTotalEur = 2 × 28.80 = €57.60
    // Step 2-3: hostVatRate = 0 (exempt), hostVatEur = €0
    // Step 4: hostGrossTotalEur = €57.60
    // Step 5: platformFeeEur = round2(57.60 × 0.15 / 0.85) = round2(10.1647...) = €10.16
    // Step 6-7: platformFeeVatRate = 0.21, platformFeeVatEur = round2(10.16 × 0.21) = €2.13
    // Step 8: spotterGrossTotalEur = 57.60 + 10.16 + 2.13 = €69.89

    const result = computeFullPriceBreakdown({
      ...baseArgs,
      durationHours: 25,
      hostVatStatus: 'EXEMPT_FRANCHISE',
    });

    expect(result.hostNetTotalEur).toBe(57.60);
    expect(result.hostVatRate).toBe(0);
    expect(result.hostVatEur).toBe(0);
    expect(result.hostGrossTotalEur).toBe(57.60);
    expect(result.platformFeeEur).toBe(10.16);
    expect(result.platformFeeVatRate).toBe(0.21);
    expect(result.platformFeeVatEur).toBe(2.13);
    expect(result.spotterGrossTotalEur).toBe(69.89);
    expect(result.appliedTier).toBe('DAILY');
    expect(result.tierUnitsBilled).toBe(2);
    expect(result.tierRateEur).toBe(28.80);
  });

  test('1-hour booking on €2/hour exempt Host', () => {
    // hostNet = 2.00, hostVat = 0, hostGross = 2.00
    // platformFee = round2(2.00 × 0.15 / 0.85) = round2(0.3529...) = 0.35
    // platformFeeVat = round2(0.35 × 0.21) = 0.07
    // spotterGross = 2.00 + 0.35 + 0.07 = 2.42

    const result = computeFullPriceBreakdown({
      ...baseArgs,
      durationHours: 1,
      hostVatStatus: 'EXEMPT_FRANCHISE',
    });

    expect(result.hostNetTotalEur).toBe(2.00);
    expect(result.platformFeeEur).toBe(0.35);
    expect(result.platformFeeVatEur).toBe(0.07);
    expect(result.spotterGrossTotalEur).toBe(2.42);
  });
});

describe('computeFullPriceBreakdown — VAT-registered Host', () => {
  test('25-hour booking on €2/hour VAT_REGISTERED Host', () => {
    // Step 1: hostNetTotalEur = €57.60 (same as exempt)
    // Step 2-3: hostVatRate = 0.21, hostVatEur = round2(57.60 × 0.21) = €12.10
    // Step 4: hostGrossTotalEur = 57.60 + 12.10 = €69.70
    // Step 5: platformFeeEur = round2(69.70 × 0.15 / 0.85) = round2(12.3) = €12.30
    //         (more precisely: 12.3, which rounds to 12.30)
    // Step 6-7: platformFeeVatRate = 0.21, platformFeeVatEur = round2(12.30 × 0.21) = €2.58
    // Step 8: spotterGrossTotalEur = 69.70 + 12.30 + 2.58 = €84.58

    const result = computeFullPriceBreakdown({
      ...baseArgs,
      durationHours: 25,
      hostVatStatus: 'VAT_REGISTERED',
    });

    expect(result.hostNetTotalEur).toBe(57.60);
    expect(result.hostVatRate).toBe(0.21);
    expect(result.hostVatEur).toBe(12.10);
    expect(result.hostGrossTotalEur).toBe(69.70);
    expect(result.platformFeeEur).toBe(12.30);
    expect(result.platformFeeVatEur).toBe(2.58);
    expect(result.spotterGrossTotalEur).toBe(84.58);
  });

  test('rounding precision — hostVatRate × hostNet always rounds to 2dp', () => {
    // Test a value that would have a long decimal expansion
    const result = computeFullPriceBreakdown({
      ...baseArgs,
      hostNetPricePerHourEur: 1.33,
      durationHours: 1,
      hostVatStatus: 'VAT_REGISTERED',
    });
    // hostNet = 1.33, hostVat = round2(1.33 × 0.21) = round2(0.2793) = 0.28
    // hostGross = 1.33 + 0.28 = 1.61
    // platformFee = round2(1.61 × 0.15 / 0.85) = round2(0.2841...) = 0.28
    // platformFeeVat = round2(0.28 × 0.21) = 0.06
    // spotterGross = 1.61 + 0.28 + 0.06 = 1.95
    expect(result.hostVatEur).toBe(0.28);
    expect(result.hostGrossTotalEur).toBe(1.61);
    expect(result.platformFeeEur).toBe(0.28);
    expect(result.platformFeeVatEur).toBe(0.06);
    expect(result.spotterGrossTotalEur).toBe(1.95);
  });
});

describe('computeFullPriceBreakdown — gross-up math invariant', () => {
  test('Spotzy keeps exactly the configured fee percentage of the host gross', () => {
    // The gross-up formula must satisfy: platformFee = (spotterGross - platformFeeVat) × platformFeePct
    // ... no wait. The invariant is: platformFee / (hostGross + platformFee) = platformFeePct
    // Because Spotzy keeps platformFee from a base of (hostGross + platformFee).

    const result = computeFullPriceBreakdown({
      ...baseArgs,
      durationHours: 25,
      hostVatStatus: 'EXEMPT_FRANCHISE',
    });

    const feePortionOfBase = result.platformFeeEur / (result.hostGrossTotalEur + result.platformFeeEur);
    expect(feePortionOfBase).toBeCloseTo(0.15, 2);
  });

  test('Host receives exactly hostGrossTotalEur (after Spotzy takes its fee from the spotter payment)', () => {
    // The invariant: (spotterGrossTotalEur - platformFeeVatEur - platformFeeEur) === hostGrossTotalEur
    // i.e., what's left after Spotzy takes its fee + the VAT on that fee equals what we promised the Host.
    const result = computeFullPriceBreakdown({
      ...baseArgs,
      durationHours: 25,
      hostVatStatus: 'EXEMPT_FRANCHISE',
    });

    const remainder = round2(result.spotterGrossTotalEur - result.platformFeeVatEur - result.platformFeeEur);
    expect(remainder).toBe(result.hostGrossTotalEur);
  });
});

describe('computeFullPriceBreakdown — fee config changes', () => {
  test('a 0% platform fee produces no fee and no fee VAT', () => {
    const result = computeFullPriceBreakdown({
      ...baseArgs,
      durationHours: 1,
      hostVatStatus: 'EXEMPT_FRANCHISE',
      platformFeePct: 0,
    });
    expect(result.platformFeeEur).toBe(0);
    expect(result.platformFeeVatEur).toBe(0);
    expect(result.spotterGrossTotalEur).toBe(2.00);   // exactly the host net
  });

  test('a 30% platform fee (max bound) produces correct gross-up', () => {
    const result = computeFullPriceBreakdown({
      ...baseArgs,
      durationHours: 1,
      hostVatStatus: 'EXEMPT_FRANCHISE',
      platformFeePct: 0.30,
    });
    // hostGross = 2.00, fee = 2.00 × 0.30 / 0.70 = 0.857... = 0.86
    // feeVat = 0.86 × 0.21 = 0.18
    // spotterGross = 2.00 + 0.86 + 0.18 = 3.04
    expect(result.platformFeeEur).toBe(0.86);
    expect(result.spotterGrossTotalEur).toBe(3.04);
  });
});

describe('computeFullPriceBreakdown — cheaperAlternatives use spotter gross', () => {
  test('25-hour booking suggests SHORTER 24h alternative with savings calculated on spotter gross', () => {
    const result = computeFullPriceBreakdown({
      ...baseArgs,
      durationHours: 25,
      hostVatStatus: 'EXEMPT_FRANCHISE',
    });

    const shorter = result.cheaperAlternatives.find((a) => a.type === 'SHORTER');
    expect(shorter).toBeDefined();
    expect(shorter!.durationHours).toBe(24);

    // For 24h: hostNet = 28.80, hostGross = 28.80, fee = 5.08, feeVat = 1.07, spotterGross = 34.95
    // For 25h: spotterGross = 69.89 (from previous test)
    // savings = 69.89 - 34.95 = 34.94
    expect(shorter!.spotterGrossTotalEur).toBeCloseTo(34.95, 1);
    expect(shorter!.savingsEur).toBeCloseTo(34.94, 1);
  });
});
```

Run the tests — they fail (red). Implement `computeFullPriceBreakdown`. Run the tests — they pass (green).


---

## PART B — Belgian VAT number validation

### B1 — Mod-97 validator

Belgian VAT numbers have the format `BE0XXXXXXXXX` (BE0 + 9 digits) where the last 2 digits are a Mod-97 checksum on the first 7 digits. The checksum rule:

> The first 7 digits form a 7-digit number N. The last 2 digits form C. The number is valid if and only if (97 - (N mod 97)) === C.

This is a standard ISO 7064 Mod-97 check, similar to IBAN validation. It catches the vast majority of typos at zero infrastructure cost (no API call, pure local computation).

Create `backend/src/shared/pricing/validation.ts`:

```typescript
import { VAT_NUMBER_REGEX_BE } from './vat-constants';

export function validateBelgianVATNumber(input: string): { valid: boolean; error?: string; normalized?: string } {
  if (!input) return { valid: false, error: 'VAT_NUMBER_REQUIRED' };

  // Normalize: trim whitespace, uppercase, remove dots and spaces (some users format as "BE 0123.456.789")
  const normalized = input.toUpperCase().replace(/[.\s-]/g, '');

  // Format check
  if (!VAT_NUMBER_REGEX_BE.test(normalized)) {
    return { valid: false, error: 'VAT_NUMBER_INVALID_FORMAT' };
  }

  // Strip "BE" prefix → 10 digits
  const digits = normalized.substring(2);
  // First 8 digits + 2 check digits — wait, Belgian VAT numbers are BE0 + 9 digits = 10 chars after BE.
  // The Mod-97 algorithm uses the first 8 of those 10 digits as N (the leading 0 is included),
  // and the last 2 as the check digits.

  const baseNumber = parseInt(digits.substring(0, 8), 10);
  const checkDigits = parseInt(digits.substring(8, 10), 10);

  const expectedCheck = 97 - (baseNumber % 97);
  if (expectedCheck !== checkDigits) {
    return { valid: false, error: 'VAT_NUMBER_INVALID_CHECKSUM' };
  }

  return { valid: true, normalized };
}
```

### B2 — Tests for VAT validator

**Tests first:** `backend/__tests__/shared/pricing/validation.test.ts`

```typescript
import { validateBelgianVATNumber } from '../../../src/shared/pricing/validation';

describe('validateBelgianVATNumber', () => {
  test('accepts valid Belgian VAT number BE0123456749', () => {
    // 01234567 mod 97 = 1234567 mod 97 = ... let me compute:
    // Actually use a known-valid example. Anthropic's Belgian entity (or similar real registered numbers)
    // Use the Belgian Federal Public Service example: BE0203201340
    // 02032013 mod 97 = 2032013 mod 97. 97 × 20948 = 2031956. 2032013 - 2031956 = 57. 97 - 57 = 40. ✓
    const result = validateBelgianVATNumber('BE0203201340');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('BE0203201340');
  });

  test('accepts formatted input with dots and spaces "BE 0203.201.340"', () => {
    const result = validateBelgianVATNumber('BE 0203.201.340');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('BE0203201340');
  });

  test('accepts lowercase "be0203201340"', () => {
    const result = validateBelgianVATNumber('be0203201340');
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('BE0203201340');
  });

  test('rejects empty input', () => {
    expect(validateBelgianVATNumber('').error).toBe('VAT_NUMBER_REQUIRED');
  });

  test('rejects wrong format (missing BE prefix)', () => {
    expect(validateBelgianVATNumber('0203201340').error).toBe('VAT_NUMBER_INVALID_FORMAT');
  });

  test('rejects wrong format (too few digits)', () => {
    expect(validateBelgianVATNumber('BE020320134').error).toBe('VAT_NUMBER_INVALID_FORMAT');
  });

  test('rejects wrong format (too many digits)', () => {
    expect(validateBelgianVATNumber('BE02032013401').error).toBe('VAT_NUMBER_INVALID_FORMAT');
  });

  test('rejects wrong format (does not start with 0)', () => {
    expect(validateBelgianVATNumber('BE1203201340').error).toBe('VAT_NUMBER_INVALID_FORMAT');
  });

  test('rejects valid format but failing checksum (typo)', () => {
    // BE0203201341 — last digit changed from 0 to 1
    expect(validateBelgianVATNumber('BE0203201341').error).toBe('VAT_NUMBER_INVALID_CHECKSUM');
  });

  test('rejects another checksum failure', () => {
    // BE0203201250 — middle digits changed
    expect(validateBelgianVATNumber('BE0203201250').error).toBe('VAT_NUMBER_INVALID_CHECKSUM');
  });

  test('accepts valid Belgian VAT number BE0476000273', () => {
    // Another known-valid checksum
    const result = validateBelgianVATNumber('BE0476000273');
    expect(result.valid).toBe(true);
  });
});
```

Run the tests (red), implement, run again (green). The implementer should hand-compute one or two Mod-97 checksums during development to verify the test cases — checksum bugs are easy to miss if the test cases are wrong.

---

## PART C — Lambda updates

### C1 — `listing-create` and `listing-update` updates

These two Lambdas (from Sessions 02 and 28) need three changes:

1. **Field rename**: accept `hostNetPricePerHourEur` instead of `pricePerHourEur`. Reject any request body containing the old field name with `400 LEGACY_PRICING_FIELD_REJECTED` (the field has been renamed).
2. **VAT status snapshot**: at creation time, read the user's current `vatStatus` from `USER#{userId}/PROFILE` and snapshot it onto `LISTING METADATA.hostVatStatusAtCreation`. If the user has `vatStatus = NONE`, transition them to `EXEMPT_FRANCHISE` in the same TransactWriteItems (this is the implicit assignment described above).
3. **Validation**: if `LISTING METADATA.hostVatStatusAtCreation` is `VAT_REGISTERED` but the user has no `vatNumber` set, reject the listing creation with `400 VAT_NUMBER_REQUIRED`. This is a defensive check — the VAT status form should have collected the number, but if someone bypasses the UI, the Lambda catches it.

**Tests first** (additions to existing Session 28 tests):

```typescript
describe('listing-create with VAT support', () => {
  test('exempt Host creates listing — hostVatStatusAtCreation snapshotted as EXEMPT_FRANCHISE', async () => {
    await seedUserProfile('host-1', { stripeConnectEnabled: true, vatStatus: 'EXEMPT_FRANCHISE' });
    const result = await listingCreate.handler(mockAuthEvent('host-1', {
      body: {
        hostNetPricePerHourEur: 2.00,
        dailyDiscountPct: 0.60,
        weeklyDiscountPct: 0.60,
        monthlyDiscountPct: 0.60,
        // ... other listing fields
      },
    }));
    expect(result.statusCode).toBe(201);
    const { listingId } = JSON.parse(result.body);
    const listing = await getDynamoItem(`LISTING#${listingId}`, 'METADATA');
    expect(listing.hostVatStatusAtCreation).toBe('EXEMPT_FRANCHISE');
    expect(listing.hostNetPricePerHourEur).toBe(2.00);
    expect(listing.pricePerHourEur).toBeUndefined(); // legacy field NOT set
  });

  test('VAT_REGISTERED Host creates listing — snapshotted correctly', async () => {
    await seedUserProfile('host-1', {
      stripeConnectEnabled: true,
      vatStatus: 'VAT_REGISTERED',
      vatNumber: 'BE0203201340',
    });
    const result = await listingCreate.handler(mockAuthEvent('host-1', {
      body: { hostNetPricePerHourEur: 2.00, /* ... */ },
    }));
    expect(result.statusCode).toBe(201);
    const listing = await getDynamoItem(`LISTING#${JSON.parse(result.body).listingId}`, 'METADATA');
    expect(listing.hostVatStatusAtCreation).toBe('VAT_REGISTERED');
  });

  test('Host with vatStatus = NONE gets implicit transition to EXEMPT_FRANCHISE', async () => {
    await seedUserProfile('host-1', { stripeConnectEnabled: true, vatStatus: 'NONE' });
    const result = await listingCreate.handler(mockAuthEvent('host-1', {
      body: { hostNetPricePerHourEur: 2.00, /* ... */ },
    }));
    expect(result.statusCode).toBe(201);

    // Profile updated
    const profile = await getDynamoItem('USER#host-1', 'PROFILE');
    expect(profile.vatStatus).toBe('EXEMPT_FRANCHISE');

    // Listing snapshotted with the new status
    const listing = await getDynamoItem(`LISTING#${JSON.parse(result.body).listingId}`, 'METADATA');
    expect(listing.hostVatStatusAtCreation).toBe('EXEMPT_FRANCHISE');
  });

  test('Host with VAT_REGISTERED status but no vatNumber → 400 VAT_NUMBER_REQUIRED', async () => {
    await seedUserProfile('host-1', {
      stripeConnectEnabled: true,
      vatStatus: 'VAT_REGISTERED',
      vatNumber: null,   // missing
    });
    const result = await listingCreate.handler(mockAuthEvent('host-1', {
      body: { hostNetPricePerHourEur: 2.00, /* ... */ },
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('VAT_NUMBER_REQUIRED');
  });

  test('legacy pricePerHourEur field rejected with LEGACY_PRICING_FIELD_REJECTED', async () => {
    await seedUserProfile('host-1', { stripeConnectEnabled: true, vatStatus: 'EXEMPT_FRANCHISE' });
    const result = await listingCreate.handler(mockAuthEvent('host-1', {
      body: { pricePerHourEur: 2.00, /* note the OLD field name */ },
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('LEGACY_PRICING_FIELD_REJECTED');
    expect(JSON.parse(result.body).details.field).toBe('pricePerHourEur');
    expect(JSON.parse(result.body).details.expectedField).toBe('hostNetPricePerHourEur');
  });
});
```

The implementation reads `USER#{userId}/PROFILE` first, validates the VAT prerequisites, then writes the LISTING# row in a TransactWriteItems together with the optional profile update (NONE → EXEMPT_FRANCHISE transition).

### C2 — `booking-quote` Lambda update

**Existing endpoint** (from Session 28): `POST /api/v1/bookings/quote`
**Implements**: the booking flow's quote step (UC-S04 step 5)

Update the response shape to return the full `PriceBreakdown` instead of the simpler quote object from Session 28:

```typescript
// Before (Session 28):
{
  totalEur: 57.60,
  appliedTier: 'DAILY',
  tierUnitsBilled: 2,
  tierRateEur: 28.80,
  durationHours: 25,
  cheaperAlternatives: [...],
}

// After (Session 28b):
{
  priceBreakdown: {
    hostNetTotalEur: 57.60,
    hostVatRate: 0,
    hostVatEur: 0,
    hostGrossTotalEur: 57.60,
    platformFeePct: 0.15,
    platformFeeEur: 10.16,
    platformFeeVatRate: 0.21,
    platformFeeVatEur: 2.13,
    spotterGrossTotalEur: 69.89,
    currency: 'EUR',
    breakdownComputedAt: '2026-04-15T10:23:00Z',
    appliedTier: 'DAILY',
    tierUnitsBilled: 2,
    tierRateEur: 28.80,
    durationHours: 25,
    cheaperAlternatives: [
      {
        type: 'SHORTER',
        durationHours: 24,
        spotterGrossTotalEur: 34.95,
        savingsEur: 34.94,
        description: 'Booking 24 hours instead of 25 saves €34.94',
      },
    ],
  },
}
```

The Lambda implementation:
1. Fetches the listing
2. Reads `LISTING METADATA.hostVatStatusAtCreation` (the snapshot, NOT the current Host status)
3. Reads `CONFIG#PLATFORM_FEE.singleShotPct` (current value at quote time)
4. Reads `CONFIG#VAT_RATES.belgianStandardRate` (current value at quote time)
5. Calls `computeFullPriceBreakdown()` with all of the above
6. Returns the full breakdown in the response

**Important**: the breakdown returned by `booking-quote` is NOT immediately persisted — quotes are ephemeral, only created bookings persist their breakdown. If the user gets a quote, waits an hour, then creates the booking, the breakdown is recomputed at booking-create time. If the platform fee or VAT rate changed in that hour, the actual booking will reflect the new values. This is intentional — quotes are previews, not commitments.

**Tests first** (additions to existing Session 28 quote tests):

```typescript
describe('booking-quote with full breakdown', () => {
  test('returns priceBreakdown for exempt Host listing', async () => {
    await seedListing('listing-1', {
      hostNetPricePerHourEur: 2.00,
      dailyDiscountPct: 0.60,
      weeklyDiscountPct: 0.60,
      monthlyDiscountPct: 0.60,
      hostVatStatusAtCreation: 'EXEMPT_FRANCHISE',
    });
    await seedConfig('CONFIG#PLATFORM_FEE', { singleShotPct: 0.15 });
    await seedConfig('CONFIG#VAT_RATES', { belgianStandardRate: 0.21 });

    const result = await bookingQuote.handler(mockAuthEvent('spotter-1', {
      body: { listingId: 'listing-1', durationHours: 25 },
    }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.priceBreakdown.hostNetTotalEur).toBe(57.60);
    expect(body.priceBreakdown.spotterGrossTotalEur).toBe(69.89);
    expect(body.priceBreakdown.hostVatRate).toBe(0);
  });

  test('returns priceBreakdown for VAT_REGISTERED Host listing with VAT included', async () => {
    await seedListing('listing-2', {
      hostNetPricePerHourEur: 2.00,
      dailyDiscountPct: 0.60,
      weeklyDiscountPct: 0.60,
      monthlyDiscountPct: 0.60,
      hostVatStatusAtCreation: 'VAT_REGISTERED',
    });
    const result = await bookingQuote.handler(mockAuthEvent('spotter-1', {
      body: { listingId: 'listing-2', durationHours: 25 },
    }));
    expect(JSON.parse(result.body).priceBreakdown.hostVatRate).toBe(0.21);
    expect(JSON.parse(result.body).priceBreakdown.hostVatEur).toBe(12.10);
    expect(JSON.parse(result.body).priceBreakdown.spotterGrossTotalEur).toBe(84.58);
  });

  test('uses snapshotted hostVatStatusAtCreation, not current Host vatStatus', async () => {
    // Listing created when Host was EXEMPT
    await seedListing('listing-3', {
      hostNetPricePerHourEur: 2.00,
      hostVatStatusAtCreation: 'EXEMPT_FRANCHISE',
      // ... rest
    });
    // Host has SINCE upgraded to VAT_REGISTERED
    await seedUserProfile('host-1', { vatStatus: 'VAT_REGISTERED', vatNumber: 'BE0203201340' });

    const result = await bookingQuote.handler(mockAuthEvent('spotter-1', {
      body: { listingId: 'listing-3', durationHours: 25 },
    }));
    // Quote should still treat the listing as EXEMPT
    expect(JSON.parse(result.body).priceBreakdown.hostVatRate).toBe(0);
    expect(JSON.parse(result.body).priceBreakdown.spotterGrossTotalEur).toBe(69.89);
  });
});
```

### C3 — `booking-create` Lambda update

The existing Session 28 booking-create stored `appliedTier`, `tierUnitsBilled`, `tierRateEur` on BOOKING# and let the Session 04 booking-confirmed Lambda compute the platform fee at settlement. Replace that with: at booking creation, compute the full `PriceBreakdown` and store it as `BOOKING METADATA.priceBreakdown`. Settlement uses the snapshot.

```typescript
// In booking-create handler, after availability validation and Stripe payment intent creation:

const listing = await getListing(listingId);
const platformFeeConfig = await readPlatformFeeConfig();
const vatRatesConfig = await readVatRatesConfig();

const priceBreakdown = computeFullPriceBreakdown({
  hostNetPricePerHourEur: listing.hostNetPricePerHourEur,
  dailyDiscountPct: listing.dailyDiscountPct,
  weeklyDiscountPct: listing.weeklyDiscountPct,
  monthlyDiscountPct: listing.monthlyDiscountPct,
  durationHours: computeDurationHours(startTime, endTime),
  hostVatStatus: listing.hostVatStatusAtCreation,
  belgianStandardVatRate: vatRatesConfig.belgianStandardRate,
  platformFeePct: platformFeeConfig.singleShotPct,
});

// Validate the Stripe payment intent amount matches priceBreakdown.spotterGrossTotalEur
// (defensive check — if these don't match, something went wrong upstream)
if (Math.abs(stripePaymentIntent.amount / 100 - priceBreakdown.spotterGrossTotalEur) > 0.01) {
  throw new Error('STRIPE_AMOUNT_MISMATCH');
}

await dynamodb.send(new TransactWriteCommand({
  TransactItems: [
    {
      Put: {
        TableName: TABLE,
        Item: {
          PK: `BOOKING#${bookingId}`,
          SK: 'METADATA',
          // ... existing fields
          priceBreakdown,
          // The stripePaymentIntentId field stores the original intent — Stripe knows the gross
        },
      },
    },
    // ... AvailabilityBlock writes
  ],
}));
```

**Tests** verify:
- `BOOKING METADATA.priceBreakdown` is written with all the right fields
- The Stripe payment intent amount equals `priceBreakdown.spotterGrossTotalEur × 100` (Stripe uses cents)
- A booking against a VAT_REGISTERED listing has the right `hostVatRate` and `hostVatEur` snapshotted
- The legacy fields from Session 28 (`appliedTier`, `tierUnitsBilled`, `tierRateEur`, `platformFeeEur`, `platformFeePct`) are NOT written as top-level fields — they're only inside `priceBreakdown`

### C4 — `booking-confirmed` Lambda update (settlement)

The existing Session 04/28 booking-confirmed Lambda ran the platform fee deduction math at settlement. Replace this with: read `BOOKING METADATA.priceBreakdown`, use the snapshotted values, transfer `priceBreakdown.hostGrossTotalEur` to the Host's Stripe Connect account, retain the rest as Spotzy revenue.

```typescript
// In booking-confirmed handler, at settlement:

const booking = await getBooking(bookingId);
const breakdown = booking.priceBreakdown;

if (!breakdown) {
  // Defensive — old bookings without a breakdown (pre-Session 28b migration) need fallback.
  // See migration section below.
  throw new Error('BOOKING_MISSING_PRICE_BREAKDOWN');
}

// Transfer the host gross total to the Host's Stripe Connect account.
// The remainder (platformFeeEur + platformFeeVatEur) stays in Spotzy's account
// for the platform fee + the VAT Spotzy collects on its fee.
await stripe.transfers.create({
  amount: Math.round(breakdown.hostGrossTotalEur * 100),
  currency: 'eur',
  destination: host.stripeConnectAccountId,
  source_transaction: booking.stripeChargeId,
  description: `Spotzy booking ${bookingId} — Host payout`,
  metadata: {
    bookingId,
    hostNetTotalEur: breakdown.hostNetTotalEur.toFixed(2),
    hostVatEur: breakdown.hostVatEur.toFixed(2),
    platformFeeEur: breakdown.platformFeeEur.toFixed(2),
    platformFeeVatEur: breakdown.platformFeeVatEur.toFixed(2),
  },
});
```

**Tests** verify:
- The Stripe transfer amount equals `priceBreakdown.hostGrossTotalEur` (in cents)
- The settlement does NOT recompute fees — even if `CONFIG#PLATFORM_FEE.singleShotPct` has changed since booking creation, the snapshotted value is used
- For a VAT_REGISTERED Host, the transfer amount includes the host VAT (which the Host then remits via their own VAT return)
- The Stripe transfer metadata includes all the breakdown fields for reconciliation

### C5 — Block reservation Lambdas (Session 27 updates)

Three Session 27 Lambdas need similar treatment:

**`block-confirm-plan`** (UC-BS03 step 6 — Block Spotter accepts a plan): when the plan is accepted, the Lambda walks each allocation and computes a `priceBreakdown` for each, snapshotting onto `BLOCKALLOC METADATA.priceBreakdown`. The breakdown includes the worst-case, best-case, and projected-case `spotterGrossTotalEur` figures so the dashboard can show all three without recomputation.

The block-specific math:
- `hostNetTotalEur` for an allocation = `pricePerBayPerHourEur × bayCount × durationHours` (with risk-share applied)
  - For PERCENTAGE mode: `hostNetTotalEur = bayCount × durationHours × pricePerBayPerHourEur × (allocatedRatio + (1 - allocatedRatio) × riskShareRate)`
  - For MIN_BAYS_FLOOR mode: `hostNetTotalEur = max(allocatedBayCount, riskShareRate × bayCount) × durationHours × pricePerBayPerHourEur`
- The rest of the breakdown follows the same VAT and fee gross-up math as single-shot bookings
- For the worst-case figure, set `allocatedBayCount = 0` (no guests show up); for best-case, set `allocatedBayCount = bayCount` (everyone shows up); for projected, use `bayCount × historicalAllocationRate` (default 0.7 from Session 27).

**`block-settle`** (UC-BS08 — at windowEnd): reads the snapshotted `priceBreakdown` and recomputes ONLY the actual settlement amount based on actual `allocatedBayCount`. The fee percentage, VAT rate, and per-bay rate all come from the snapshot. The resulting Stripe transfer amount is the Host's share of the actual settlement.

**`block-cancel`** (UC-BS07): for cancellations between T-7d and T-24h, the 50% capture amount is computed from the snapshotted worst-case (50% × `worstCaseSpotterGrossEur`). The Host's share of that capture is computed using the same snapshotted ratios.

**Tests** verify:
- Plan acceptance writes `priceBreakdown` to every BLOCKALLOC# row in the plan
- Worst-case, best-case, projected-case figures are all gross-with-fee (the spotter actually pays these amounts)
- Settlement uses snapshotted values, not current config
- Cancellation 50% capture uses snapshotted worst-case
- VAT_REGISTERED Spot Manager pools have the host VAT folded into the breakdown

### C6 — Spot Manager commitment gate update (Session 26)

The Session 26 `rc-submission-create` Lambda needs to capture the VAT status as part of the commitment gate.

UC-SM00 currently has 3 steps (RC insurance upload, access checklist, T&Cs). Add a sub-step to step 1: VAT status declaration. The form shows two radio options:

- **"I am NOT VAT-registered (small enterprise franchise)"** — the default. Helper text: "Most casual hosts choose this option. The Belgian small enterprise threshold is €25,000 in annual revenue. If you exceed this threshold, you must register for VAT."
- **"I am VAT-registered"** — requires a Belgian VAT number input. Helper text: "If you are operating commercially and have a Belgian VAT number, select this option. The platform will collect the appropriate 21% VAT on your behalf."

When the user selects "VAT-registered", a text input appears for the VAT number. The number is validated client-side using `validateBelgianVATNumber` (which is duplicated to the frontend — see PART D2 below).

The Lambda update writes the VAT status and number to `USER#{userId}/PROFILE` as part of the same TransactWriteItems that creates the RCSUBMISSION# record:

```typescript
// In rc-submission-create handler, addition to the existing TransactWriteItems:

if (body.vatStatus === 'VAT_REGISTERED') {
  const vatValidation = validateBelgianVATNumber(body.vatNumber);
  if (!vatValidation.valid) {
    return errorResponse(400, vatValidation.error);
  }
  body.vatNumber = vatValidation.normalized;
}

const profileUpdate = {
  Update: {
    TableName: TABLE,
    Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
    UpdateExpression: 'SET vatStatus = :vs, vatNumber = :vn, vatStatusLastChangedAt = :now, vatStatusLastChangedBy = :by, ' +
      (body.vatStatus === 'VAT_REGISTERED' ? 'vatRegisteredSince = if_not_exists(vatRegisteredSince, :now), ' : '') +
      // ... existing PROFILE updates
      'spotManagerStatus = :staged',
    ExpressionAttributeValues: {
      ':vs': body.vatStatus,
      ':vn': body.vatStatus === 'VAT_REGISTERED' ? body.vatNumber : null,
      ':now': new Date().toISOString(),
      ':by': userId,
      ':staged': 'STAGED',
    },
  },
};
```

**Tests** verify:
- Submission with `vatStatus = EXEMPT_FRANCHISE` and no `vatNumber` → success, profile updated
- Submission with `vatStatus = VAT_REGISTERED` and valid `vatNumber` → success, profile updated, `vatRegisteredSince` set
- Submission with `vatStatus = VAT_REGISTERED` and invalid `vatNumber` (bad checksum) → 400 VAT_NUMBER_INVALID_CHECKSUM
- Submission with `vatStatus = VAT_REGISTERED` and missing `vatNumber` → 400 VAT_NUMBER_REQUIRED
- Idempotent re-submission preserves `vatRegisteredSince` (does not overwrite the original date)

### C7 — Account settings VAT update endpoint (new)

A new Lambda `user-vat-status-update` (`PATCH /api/v1/users/me/vat-status`) lets the user change their VAT status outside the commitment gate. This handles two scenarios:

1. A regular Host (not a Spot Manager) wants to opt into VAT_REGISTERED — they can do this from `/account/vat-settings` without going through the full Spot Manager onboarding.
2. A Spot Manager wants to update their VAT status (e.g., they crossed the threshold and need to upgrade from EXEMPT to REGISTERED).

The Lambda:
- Validates the new VAT number (if applicable) using the Mod-97 checksum
- Updates `USER#{userId}/PROFILE` with the new status, number, and `vatStatusLastChangedAt`
- If transitioning to VAT_REGISTERED for the first time, sets `vatRegisteredSince`
- Does NOT touch any existing listings — those keep their `hostVatStatusAtCreation` snapshot
- Sends the user an email confirming the change (template: `vat-status-changed`)

**Important**: the user is informed in the response and the email that "this change applies to FUTURE listings and bookings only. Your existing listings will continue to display prices according to their original VAT status. To update prices on existing listings, edit each listing individually — this will re-snapshot the VAT status."

**Tests** cover:
- Happy path EXEMPT → VAT_REGISTERED with valid VAT number
- Happy path VAT_REGISTERED → EXEMPT (rare but possible — Host falls below threshold)
- Bad VAT number rejected
- Email sent on every change
- Existing listings NOT mutated by the update


---

## PART D — Frontend updates

### D1 — UC-H01 Pricing form (Host net + Spotter preview)

The existing pricing step component (`frontend/app/listings/new/PricingStep.tsx` from Session 28) is updated to show the Host their net rate prominently AND a live preview of what the Spotter will pay.

**New form layout:**

```
┌─ Pricing ─────────────────────────────────────────────────────┐
│                                                                │
│  Your hourly rate (you keep this amount):                      │
│  ┌──────────────────┐                                          │
│  │ €  2.00          │                                          │
│  └──────────────────┘                                          │
│                                                                │
│  Tier discounts:                                               │
│  Daily   ◯ 50%  ●  60%  ◯ 70%                                 │
│  Weekly  ◯ 50%  ●  60%  ◯ 70%                                 │
│  Monthly ◯ 50%  ●  60%  ◯ 70%                                 │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Your earnings ladder (what you receive):                 │ │
│  │   Hourly  €2.00/h                                        │ │
│  │   Daily   €28.80/day  (€1.20/h)                          │ │
│  │   Weekly  €120.96/week (€0.72/h)                         │ │
│  │   Monthly €290.30/month (€0.43/h)                        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ ℹ What the Spotter sees (gross with fees and VAT):       │ │
│  │   Hourly  €2.42/h    (you keep €2.00)                    │ │
│  │   Daily   €34.95/day (you keep €28.80)                   │ │
│  │   Weekly  €146.84/week                                   │ │
│  │   Monthly €352.51/month                                  │ │
│  │                                                          │ │
│  │ Spotzy adds a 15% service fee + 21% VAT on its fee.      │ │
│  │ Your VAT status: Not VAT-registered (small enterprise).  │ │
│  │ [Change VAT status →]                                    │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Implementation notes:**

- The "you keep this amount" label is critical — it tells the Host immediately and unambiguously that the number they're entering is their net.
- The "earnings ladder" panel below the form uses the existing tiered-pricing function (`deriveTierRates` from Session 28) — unchanged.
- The "What the Spotter sees" panel calls `computeFullPriceBreakdown` (ported to the frontend, see D2) for each of the 4 tier durations (1h, 24h, 168h, 672h) and shows the resulting `spotterGrossTotalEur`. Recomputes on every input change.
- The "your VAT status" line shows the current status from the user's profile, with a link to `/account/vat-settings` to change it.
- For VAT_REGISTERED Hosts, the line reads "Your VAT status: VAT-registered (BE0203201340) — 21% VAT will be added to your prices."

**Tests first** (additions to the existing Session 28 PricingStep tests):

- Renders both the "earnings ladder" and the "Spotter preview" panels
- Updates both panels live as the user changes the rate or the discounts
- Shows the VAT status line correctly for both EXEMPT and VAT_REGISTERED
- For VAT_REGISTERED, the spotter preview includes the host VAT in its math
- Submit posts `hostNetPricePerHourEur` (not `pricePerHourEur`) to the listing-create endpoint
- The "Change VAT status" link navigates to `/account/vat-settings`

### D2 — Frontend port of the pricing function

The pricing function lives in `backend/src/shared/pricing/tiered-pricing.ts`. The frontend pricing form needs the same math for the live preview. Two options:

1. **Port the function to `frontend/src/lib/pricing.ts`** — a copy of the relevant functions (`computeFullPriceBreakdown`, `deriveTierRates`, `selectTier`, `computeStrictTierTotal`). Keep them in sync manually.
2. **Make a debounced API call to `/api/v1/listings/preview-pricing`** — a new lightweight Lambda that just runs the pricing function and returns the breakdown. One extra round-trip per keystroke (debounced to 300ms).

**Recommendation: port the function.** The math is small (~100 lines), pure (no I/O), and unlikely to change frequently. Keeping a frontend copy avoids the round-trip and makes the form responsive. The two copies should be kept in sync via a shared test suite that runs against both.

Create `frontend/src/lib/pricing.ts` as a TypeScript port of:
- `computeFullPriceBreakdown`
- `deriveTierRates`
- `selectTier`
- `computeStrictTierTotal`
- `validateBelgianVATNumber` (also needed for the VAT settings form, see D6)

The frontend port has the same interface and the same test cases. Run the same test file against both implementations to verify parity.

### D3 — UC-S04 Booking summary (Spotter breakdown)

The booking summary screen (`frontend/app/listings/[id]/BookingSummary.tsx` from Session 08) is updated to show the full breakdown returned by the `booking-quote` Lambda.

**New layout:**

```
┌─ Booking summary ─────────────────────────────────────────────┐
│                                                                │
│  Garage Avenue Louise                                          │
│  Brussels, Belgium                                             │
│                                                                │
│  Friday, 17 April 2026, 9:00 AM                                │
│  to                                                            │
│  Saturday, 18 April 2026, 10:00 AM                             │
│  (25 hours)                                                    │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Daily rate × 2 days        €57.60                        │ │
│  │   (€28.80 × 2)                                           │ │
│  │                                                          │ │
│  │ Service fee                €10.16                        │ │
│  │ VAT 21%                     €2.13                        │ │
│  │                            ──────                        │ │
│  │ Total                      €69.89                        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  💡 Did you know? Booking 24 hours instead of 25 saves €34.94 │
│     [Adjust dates]                                             │
│                                                                │
│  Payment method: ● Visa ending in 4242                         │
│                                                                │
│  [Cancel]                          [Confirm and pay €69.89]    │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Behavior notes:**

- The `priceBreakdown` is fetched from `POST /api/v1/bookings/quote` when the user lands on this screen.
- The headline "Total" uses `priceBreakdown.spotterGrossTotalEur`.
- The line items display `priceBreakdown.tierUnitsBilled × tierRateEur` for the base, then `platformFeeEur` and `platformFeeVatEur` separately.
- For VAT_REGISTERED Host listings, an additional line appears between the base and the service fee:
  ```
  Daily rate × 2 days        €57.60
    (€28.80 × 2)
  Host VAT 21%               €12.10
  
  Service fee                €12.30
  VAT 21%                     €2.58
                             ──────
  Total                      €84.58
  ```
- The "Confirm and pay" button shows the total inline so the user is never surprised at the Stripe checkout.
- The cheaperAlternatives banner from Session 28 is preserved, but the "savings" amount is now the spotter-gross savings (matches the new pricing function output).

**Tests first:**
- Renders the breakdown for an EXEMPT Host listing
- Renders the breakdown WITH the host VAT line for a VAT_REGISTERED Host listing
- Total displayed matches `spotterGrossTotalEur`
- Cheaper alternative banner shows correctly when present
- "Confirm and pay" button is labeled with the total amount in the user's locale (€69,89 in fr-BE, €69.89 in en)
- All amounts are formatted with 2 decimal places and the EUR currency symbol

### D4 — UC-S01/UC-S02 Listing card (gross headline)

The listing card component (`frontend/components/listings/ListingCard.tsx` from Session 07) shows the listing's headline price. Per Model B1, this is the GROSS price the Spotter will pay (including fees and VAT).

The card needs to compute a representative "per hour" price for the headline. Three approaches:

1. **Show the hourly tier price gross**: `computeFullPriceBreakdown({ durationHours: 1, ... }).spotterGrossTotalEur`. This is the cheapest tier and the simplest. Drawback: most bookings are not 1 hour, so the displayed price doesn't match what most users actually pay.
2. **Show the daily tier price-per-hour gross**: `computeFullPriceBreakdown({ durationHours: 24 }).spotterGrossTotalEur / 24`. Uses the daily rate as the headline. More representative for typical bookings.
3. **Show the hourly tier price gross AND a "from" badge**: "From €2.42/h" with smaller text. Indicates that the price varies by duration.

**Recommendation: option 3 (hourly with "from" badge)**. It's the most honest — the "from" tells the user the price can be lower for longer bookings, and the hourly rate is the price floor. This matches how Booking.com and Airbnb show their prices.

The card displays:

```
┌──────────────────────┐
│ [photo]              │
│                      │
│ Garage Avenue Louise │
│ Brussels             │
│                      │
│ ★ 4.8 (32 reviews)   │
│                      │
│ From €2.42/h         │
│  (incl. fees & VAT)  │
└──────────────────────┘
```

The "From €2.42/h" + "(incl. fees & VAT)" caption is the only price text on the card. No breakdown, no host net rate, no platform fee disclosure — those are all visible at the booking summary step.

**Tests first:**
- Card renders the gross headline for an EXEMPT Host listing
- Card renders the gross headline for a VAT_REGISTERED Host listing (price is higher because of the host VAT)
- Card uses the hourly tier (1 hour × hostNet × markup) for the headline
- "incl. fees & VAT" caption is always present
- The card price never shows the legacy `pricePerHourEur` field

### D5 — UC-BS03 Block reservation plans (gross-with-fee)

The block reservation plan display (`frontend/app/block-spotter/plans/PlansList.tsx` from Session 27) shows worst-case, best-case, and projected-case figures. Per the locked decision, all three are gross-with-fee — they reflect what the Block Spotter actually pays.

**New plan card layout:**

```
┌─ Plan A ─ 3 counterparties ───────────────────────────────────┐
│                                                                │
│  Garage North      20 bays                                     │
│  Garage Center     15 bays                                     │
│  Garage South      15 bays                                     │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Worst case (no guests show)         €1,234.56            │ │
│  │ Projected (70% allocation)            €882.45            │ │
│  │ Best case (all bays used)             €651.34            │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  All amounts include service fees and applicable VAT.          │
│  [View detailed breakdown ▾]                                   │
│                                                                │
│  [Accept this plan]                                            │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

The "View detailed breakdown" expander reveals:

```
┌─ Detailed breakdown ──────────────────────────────────────────┐
│                                                                │
│  Worst case (no guests show):                                  │
│    Host net total              €875.00                         │
│    Host VAT (mixed)             €52.50  (some pools are        │
│                                          VAT-registered)       │
│    Service fee (15%)           €163.66                         │
│    VAT on service fee (21%)     €34.37                         │
│                               ─────────                        │
│    Total worst case          €1,125.53                         │
│                                                                │
│  Best case (all bays used):                                    │
│    [same breakdown layout]                                     │
│                                                                │
│  Projected case (70% allocation):                              │
│    [same breakdown layout]                                     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Behavior notes:**

- The three figures shown on the plan card are `worstCaseSpotterGrossEur`, `projectedSpotterGrossEur`, `bestCaseSpotterGrossEur` from the BLOCKALLOC priceBreakdown summed across all allocations in the plan.
- Mixed-VAT pools (some pools are VAT_REGISTERED, others are EXEMPT) sum correctly because the breakdown is per-allocation. The detail view shows the aggregate.
- When the Block Spotter clicks "Accept this plan", the system writes the priceBreakdown for each BLOCKALLOC# in the plan and shows the confirmation screen with the final total.

**Tests first:**
- Plan card displays all three figures gross-with-fee
- Detailed breakdown expander shows per-component values
- Mixed-VAT plans sum correctly
- Total on the plan card equals the sum of allocation totals

### D6 — Account VAT settings page (new)

A new page at `/account/vat-settings` (`frontend/app/account/vat-settings/page.tsx`) lets the user view and update their VAT status outside the Spot Manager onboarding flow.

**Layout:**

```
┌─ VAT settings ────────────────────────────────────────────────┐
│                                                                │
│  Current VAT status: Not VAT-registered (small enterprise)     │
│                                                                │
│  Belgian small enterprise franchise (vrijstellingsregeling /   │
│  régime de la franchise) applies if your annual turnover from  │
│  parking rental is below €25,000. Most casual hosts qualify.   │
│                                                                │
│  ── Update your VAT status ──                                  │
│                                                                │
│  ◯ Not VAT-registered (small enterprise)                       │
│  ●  VAT-registered                                             │
│      Belgian VAT number:                                       │
│      ┌────────────────────┐                                    │
│      │ BE0                │                                    │
│      └────────────────────┘                                    │
│      Format: BE0 followed by 9 digits (e.g. BE0123456749)      │
│                                                                │
│  ⚠ Important: Changing your VAT status applies to FUTURE       │
│    listings and bookings only. Your existing listings will     │
│    continue to display prices according to their original     │
│    VAT status. To update prices on existing listings, you     │
│    must edit each listing individually.                        │
│                                                                │
│  [Save changes]                                                │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Behavior notes:**

- The page reads the current VAT status from the user's profile via `GET /api/v1/users/me`.
- Selecting a different option enables the "Save changes" button.
- For "VAT-registered", the VAT number input is shown and validated client-side using `validateBelgianVATNumber` from the frontend port (see D2).
- The "Save changes" button calls `PATCH /api/v1/users/me/vat-status` (the new endpoint from C7).
- On success, the page shows a confirmation banner and an email is sent (template: `vat-status-changed`).
- The "⚠ Important" warning is always visible — users need to understand that the change is forward-only.

**Tests first:**
- Renders current VAT status
- Selecting "VAT-registered" reveals the VAT number input
- Bad VAT number fails client-side validation with the right error
- Good VAT number enables the save button
- Save calls the correct API endpoint
- Success banner shown after save

---

## PART E — CDK and email templates

### E1 — CDK additions

Add to the existing API stack:

1. **New Lambda**: `user-vat-status-update` for the PATCH endpoint (C7)
2. **CDK custom resource**: seed `CONFIG#VAT_RATES METADATA` with `belgianStandardRate: 0.21` on first deploy. Idempotent via `attribute_not_exists` condition (same pattern as `CONFIG#PLATFORM_FEE` from Session 28).
3. **IAM permissions**: the `listing-create`, `listing-update`, `booking-quote`, `booking-create`, `booking-confirmed`, `block-confirm-plan`, `block-settle`, `block-cancel`, and `rc-submission-create` Lambdas all need read access to `CONFIG#VAT_RATES`. Most already have read access to `CONFIG#PLATFORM_FEE` from Session 28 — extend the existing IAM policies.

```typescript
new cr.AwsCustomResource(this, 'SeedVatRatesConfig', {
  onCreate: {
    service: 'DynamoDB',
    action: 'putItem',
    parameters: {
      TableName: this.spotzyMainTable.tableName,
      Item: {
        PK: { S: 'CONFIG#VAT_RATES' },
        SK: { S: 'METADATA' },
        belgianStandardRate: { N: '0.21' },
        lastModifiedBy: { NULL: true },
        lastModifiedAt: { NULL: true },
        historyLog: { L: [] },
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    },
    physicalResourceId: cr.PhysicalResourceId.of('VatRatesConfigSeed'),
  },
  policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
    resources: [this.spotzyMainTable.tableArn],
  }),
});
```

### E2 — Email template updates

Three existing email templates from Session 26/27 need new line items in their breakdown sections. The template family naming convention from §10 of the localization spec applies (`{family}-{locale}`).

**`booking-confirmed-{locale}`** (29 templates total — already exists from Session 04, just needs body update):

Replace the simple total line with a breakdown table. Pseudocode for the template body:

```handlebars
<table>
  <tr><td>{{tierLabel}} × {{tierUnits}}</td><td>{{format hostNetTotal}}</td></tr>
  {{#if hostVatRate}}
    <tr><td>Host VAT ({{percent hostVatRate}})</td><td>{{format hostVatEur}}</td></tr>
  {{/if}}
  <tr><td>{{i18n 'service_fee'}}</td><td>{{format platformFeeEur}}</td></tr>
  <tr><td>{{i18n 'vat_on_service_fee'}} ({{percent platformFeeVatRate}})</td><td>{{format platformFeeVatEur}}</td></tr>
  <tr class="total"><td><strong>{{i18n 'total'}}</strong></td><td><strong>{{format spotterGrossTotalEur}}</strong></td></tr>
</table>
```

The template parameters (`tierLabel`, `tierUnits`, `hostNetTotal`, etc.) are passed in the SES `TemplateData` JSON by the booking-confirmed Lambda. Since SES templates use Handlebars, the `{{#if}}` conditional handles the VAT_REGISTERED vs EXEMPT cases.

**`block-confirmation-{locale}`** (Session 27): same treatment — show the breakdown for the worst-case authorisation amount with VAT lines.

**`block-settlement-{locale}`** (Session 27): show the final settled breakdown with all lines.

**New email template family**: `vat-status-changed-{locale}` (3 templates: en, fr-BE, nl-BE). Sent when the user changes their VAT status via the new endpoint (C7). Body: confirmation of the new status, the date it takes effect ("from now on, applies to future listings and bookings"), and the warning that existing listings retain their original status until manually re-edited.

### E3 — Localization file updates

Three of the localization spec's 23 namespaces need new keys. These are added to `frontend/src/locales/en/{namespace}.yaml` as part of this session, then translated to fr-BE and nl-BE via the Session 30 translation script.

**`pricing.yaml`** — new keys:

```yaml
hostNetLabel: "Your hourly rate (you keep this amount)"
earningsLadderTitle: "Your earnings ladder (what you receive)"
spotterPreviewTitle: "What the Spotter sees (gross with fees and VAT)"
spotzyFeeNote: "Spotzy adds a {feePct, number, ::percent} service fee + {vatPct, number, ::percent} VAT on its fee."
yourVatStatus: "Your VAT status: {status}"
vatStatusExempt: "Not VAT-registered (small enterprise)"
vatStatusRegistered: "VAT-registered ({vatNumber}) — {hostVatPct, number, ::percent} VAT will be added to your prices"
changeVatStatus: "Change VAT status →"
inclFeesAndVat: "(incl. fees & VAT)"
fromPrice: "From {price}"
```

**`booking.yaml`** — new keys:

```yaml
breakdown:
  tierLine: "{tierLabel} × {tierUnits}"
  hostVat: "Host VAT {rate, number, ::percent}"
  serviceFee: "Service fee"
  vatOnServiceFee: "VAT {rate, number, ::percent}"
  total: "Total"
confirmAndPay: "Confirm and pay {amount}"
allAmountsIncludeFeesAndVat: "All amounts include service fees and applicable VAT."
```

**`errors.yaml`** — new error codes:

```yaml
LEGACY_PRICING_FIELD_REJECTED: "The pricing field {field} has been renamed to {expectedField}. Please update your request."
VAT_NUMBER_REQUIRED: "A Belgian VAT number is required to register as VAT-registered."
VAT_NUMBER_INVALID_FORMAT: "Invalid Belgian VAT number format. Expected: BE0 followed by 9 digits."
VAT_NUMBER_INVALID_CHECKSUM: "The Belgian VAT number checksum is invalid. Please check for typos."
VAT_STATUS_REQUIRED_FOR_SPOT_MANAGER: "You must declare your VAT status to become a Spot Manager."
STRIPE_AMOUNT_MISMATCH: "The payment amount does not match the booking total. Please try again or contact support."
BOOKING_MISSING_PRICE_BREAKDOWN: "This booking is missing pricing information. Contact support to resolve."
```

**`spot_manager.yaml`** — new keys for the commitment gate VAT step:

```yaml
commitmentGate:
  vatStep:
    title: "VAT status"
    description: "Tell us about your VAT registration status. This determines how prices are displayed to Spotters and Block Spotters."
    optionExempt: "I am NOT VAT-registered (small enterprise franchise)"
    optionExemptHelp: "Most casual hosts choose this option. The Belgian small enterprise threshold is €25,000 in annual revenue. If you exceed this threshold, you must register for VAT."
    optionRegistered: "I am VAT-registered"
    optionRegisteredHelp: "If you are operating commercially and have a Belgian VAT number, select this option. The platform will collect the appropriate {rate, number, ::percent} VAT on your behalf."
    vatNumberLabel: "Belgian VAT number"
    vatNumberPlaceholder: "BE0123456749"
    vatNumberFormatHint: "Format: BE0 followed by 9 digits"
```

These keys are added to `en/` first. The Session 30 translation script (or a manual run of `npm run i18n:translate`) generates the fr-BE and nl-BE versions afterward.

---

## PART F — Migration from Session 28 (one-time)

Sessions 28 and 04 already deployed the original fee-inclusive model. If this corrective supplement is shipped after launch (or after any test deployments of Session 28), there will be existing data with the old field names and missing `priceBreakdown` snapshots. This part handles that migration.

### F1 — Listing field rename migration

Existing LISTING# rows have `pricePerHourEur` (the old field). After this session, they need `hostNetPricePerHourEur` AND `hostVatStatusAtCreation` populated.

**Migration script:** `backend/scripts/migrate-listings-to-vat-aware.ts`

```typescript
async function migrateListings() {
  let lastEvaluatedKey: any | undefined;
  let processed = 0;

  do {
    const result = await dynamo.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :p) AND SK = :sk AND attribute_exists(pricePerHourEur)',
      ExpressionAttributeValues: { ':p': 'LISTING#', ':sk': 'METADATA' },
      Limit: 100,
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    for (const item of result.Items ?? []) {
      // Read the host's current vatStatus to use as the snapshot for this listing.
      // For the migration, we assume EXEMPT_FRANCHISE for everyone unless they explicitly
      // have VAT_REGISTERED on their profile (which would be unusual at this stage but
      // possible if someone ran Session 26 with a VAT-aware profile before this script).
      const profile = await getDynamoItem(`USER#${item.ownerUserId}`, 'PROFILE');
      const vatStatus = profile?.vatStatus === 'VAT_REGISTERED' ? 'VAT_REGISTERED' : 'EXEMPT_FRANCHISE';

      await dynamo.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: item.PK, SK: item.SK },
        UpdateExpression: 'SET hostNetPricePerHourEur = :hp, hostVatStatusAtCreation = :vs REMOVE pricePerHourEur',
        ExpressionAttributeValues: {
          ':hp': item.pricePerHourEur,
          ':vs': vatStatus,
        },
        ConditionExpression: 'attribute_exists(pricePerHourEur)',  // idempotent: skip if already migrated
      }));
      processed++;
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log(`Migrated ${processed} listings to VAT-aware schema.`);
}
```

The script is idempotent (re-running it skips already-migrated listings via the `ConditionExpression`). It supports a `--dry-run` mode that prints what would be changed without writing.

### F2 — Existing booking handling

Existing BOOKING# rows from Session 28 have `appliedTier`, `tierUnitsBilled`, `tierRateEur`, `platformFeeEur`, `platformFeePct` as top-level fields but no nested `priceBreakdown`. The booking-confirmed Lambda needs to handle these gracefully.

Two options:

**Option A: Migrate the existing rows.** Walk all BOOKING# rows, read the legacy fields, compute the breakdown using the EXEMPT defaults (since pre-Session-28b bookings have no VAT context), and write the `priceBreakdown` field.

**Option B: Fallback in the settlement Lambda.** When booking-confirmed reads a booking and finds no `priceBreakdown`, it constructs one on the fly from the legacy fields, treating it as EXEMPT_FRANCHISE / no VAT.

**Recommendation: Option B.** It avoids a database migration, handles edge cases (cancelled bookings that were never settled, partially-settled bookings) without special-casing, and the fallback code can be removed in a future cleanup session once all pre-Session-28b bookings are settled.

```typescript
// In booking-confirmed handler:

const booking = await getBooking(bookingId);
let breakdown = booking.priceBreakdown;

if (!breakdown) {
  // Legacy booking from Session 28 — construct a breakdown from the legacy fields
  // using EXEMPT defaults.
  const hostNetTotal = booking.tierUnitsBilled * booking.tierRateEur;
  const platformFeePct = booking.platformFeePct ?? 0.15;
  const platformFee = round2(hostNetTotal * platformFeePct);   // Note: this is the OLD math (not gross-up)
  // Pre-28b bookings used fee-inclusive pricing, so the spotter paid hostNetTotal,
  // and the host receives hostNetTotal - platformFee. Reconstruct accordingly:
  breakdown = {
    hostNetTotalEur: hostNetTotal - platformFee,
    hostVatRate: 0,
    hostVatEur: 0,
    hostGrossTotalEur: hostNetTotal - platformFee,
    platformFeePct,
    platformFeeEur: platformFee,
    platformFeeVatRate: 0,                  // Pre-28b had no VAT on the platform fee
    platformFeeVatEur: 0,
    spotterGrossTotalEur: hostNetTotal,     // What the spotter actually paid (legacy)
    currency: 'EUR',
    breakdownComputedAt: new Date().toISOString(),
    appliedTier: booking.appliedTier,
    tierUnitsBilled: booking.tierUnitsBilled,
    tierRateEur: booking.tierRateEur,
    durationHours: booking.durationHours,
    cheaperAlternatives: [],
  };
}

// Continue with settlement using `breakdown` …
```

This is a temporary compatibility shim. It can be removed once the metric `count(BOOKING# with no priceBreakdown)` reaches zero (typically a few weeks after Session 28b ships, depending on booking duration distribution).

### F3 — Migration order

The recommended deployment order:

1. Deploy Session 28b code (Lambdas + frontend) WITHOUT the listing migration script
2. Verify new bookings get the full `priceBreakdown` (CloudWatch logs / DynamoDB inspection)
3. Run the listing migration script in `--dry-run` mode against staging, review the output
4. Run the listing migration script for real against staging
5. Validate via the Spot Manager dashboard that listings show the right prices
6. Repeat steps 3–5 against production
7. After 30 days, audit how many bookings still rely on the F2 fallback shim. If zero, schedule a cleanup session to remove the shim code.

---

## PART G — Acceptance criteria

A successful Claude Code run produces:

1. **`computeFullPriceBreakdown`** in `tiered-pricing.ts` with all PART A3 tests passing.
2. **`validateBelgianVATNumber`** in `validation.ts` with Mod-97 checksum implementation and PART B2 tests passing.
3. **`CONFIG#VAT_RATES METADATA` singleton** seeded by CDK custom resource, idempotent.
4. **`USER PROFILE` schema** has `vatStatus`, `vatNumber`, `vatRegisteredSince`, `vatStatusLastChangedAt`, `vatStatusLastChangedBy` fields.
5. **`LISTING METADATA` schema** has `hostNetPricePerHourEur` (renamed from `pricePerHourEur`) and `hostVatStatusAtCreation` (snapshot).
6. **`BOOKING METADATA` schema** has `priceBreakdown` (replacing the flat fields from Session 28).
7. **`BLOCKALLOC METADATA` schema** has `priceBreakdown` with worst/best/projected case figures.
8. **`listing-create` and `listing-update`** reject `pricePerHourEur` with `LEGACY_PRICING_FIELD_REJECTED`, accept `hostNetPricePerHourEur`, snapshot `hostVatStatusAtCreation`, transition `vatStatus = NONE → EXEMPT_FRANCHISE` implicitly.
9. **`booking-quote`** returns `priceBreakdown` in the response, uses snapshotted `hostVatStatusAtCreation` from the listing.
10. **`booking-create`** writes the full `priceBreakdown` snapshot to BOOKING METADATA.
11. **`booking-confirmed`** uses the snapshotted breakdown for Stripe Connect transfer math; falls back gracefully for pre-Session-28b bookings via the F2 shim.
12. **`block-confirm-plan`, `block-settle`, `block-cancel`** snapshot priceBreakdown at confirmation, use snapshot at settlement, support both EXEMPT and VAT_REGISTERED Spot Manager pools.
13. **`rc-submission-create`** captures VAT status during the commitment gate, validates the VAT number with Mod-97 checksum, sets `vatRegisteredSince` on first transition.
14. **`user-vat-status-update`** Lambda handles standalone VAT status changes outside the commitment gate, sends confirmation email, does NOT touch existing listings.
15. **UC-H01 pricing form** shows the host net rate prominently, the earnings ladder, and the spotter preview with fees and VAT included.
16. **UC-S04 booking summary** shows the full breakdown including host VAT (when applicable), service fee, VAT on service fee, and the total.
17. **UC-S01/S02 listing card** displays `From €X.XX/h (incl. fees & VAT)` as the headline price.
18. **UC-BS03 plan display** shows worst/best/projected case figures gross-with-fee with a detailed breakdown expander.
19. **UC-SM00 commitment gate** has a VAT status sub-step in step 1, validates the VAT number client-side.
20. **Account VAT settings page** lets the user view and update their VAT status outside the Spot Manager flow.
21. **Frontend pricing function** (`frontend/src/lib/pricing.ts`) is a port of the backend function with parity tests.
22. **3 email templates** (`booking-confirmed`, `block-confirmation`, `block-settlement`) updated to show the full breakdown including VAT lines.
23. **1 new email template family** (`vat-status-changed`) for VAT status change notifications.
24. **New translation keys** added to `en/pricing.yaml`, `en/booking.yaml`, `en/errors.yaml`, `en/spot_manager.yaml`. (Translations to fr-BE and nl-BE generated separately by Session 30.)
25. **Listing migration script** (`migrate-listings-to-vat-aware.ts`) idempotent and dry-run-capable.
26. **booking-confirmed fallback shim** for pre-Session-28b bookings — works correctly for EXEMPT-defaulted reconstruction.
27. **All existing Session 28 tests still pass** with the renamed field. Update the test fixtures to use `hostNetPricePerHourEur`.

### Open questions for implementation time

1. **Spot Manager's pool listing pricing**: when a Spot Manager creates a Spot Pool listing (UC-SM01), the pool has a single price shared across all bays (pool pricing is shared per Session 26). The `hostNetPricePerHourEur` and `hostVatStatusAtCreation` fields apply to the parent LISTING# row (the pool). All bays inherit this. Confirm this matches the expected behavior — yes per Session 26's "Pool pricing is shared across all bays" rule.

2. **Block Spotter VAT status**: Block Spotters provide a `vatNumber` at registration (Session 27 UC-BS01), but the spec doesn't explicitly say whether they're "consumers" or "businesses" for VAT purposes. For v2.x, treat all Block Spotters as B2B (they always have a VAT number, by design). The breakdown shown to them includes the VAT line because they need it for their own VAT recovery. The legal basis: a Block Spotter who provides a valid VAT number has self-identified as a business and can recover Spotzy's fee VAT through their own VAT return.

3. **Currency formatting in Belgian locales**: Belgian French uses `1 234,56 €` (space thousands separator, comma decimal, € after the number with a space). Belgian Dutch uses `€ 1.234,56` (€ before with space, period thousands separator, comma decimal). The frontend uses `Intl.NumberFormat` with `fr-BE` and `nl-BE` locale codes which handles this automatically. Tests verify the formatting in each locale.

4. **Reverse charge for cross-border B2B**: if a non-Belgian Block Spotter (e.g., a French event organizer with a French VAT number) books a Belgian parking spot via Spotzy, EU reverse-charge rules MAY apply — meaning Spotzy charges no VAT and the Block Spotter accounts for it via their own VAT return. This is an edge case for v2.x. Treat all bookings as Belgian-domestic for v2.x and validate VAT numbers as Belgian only. Cross-border reverse charge is a v3+ task that requires VIES integration to verify the foreign VAT number.

5. **Fee config changes mid-quote**: if `CONFIG#PLATFORM_FEE.singleShotPct` changes between when a Spotter sees a quote and when they create the booking, the booking will have the new fee but the quote showed the old. Two options: (a) accept the discrepancy as an edge case (the quote is a preview, the booking confirms the actual price), (b) include a `quoteValidUntil` timestamp in the quote response. Recommendation: (a) for v2.x. The discrepancy window is small and changes are rare.

---

## Reading order for Claude Code

1. **PART A** — pricing function. Most of this session's correctness depends on getting the math right. TDD red-green-refactor through every test.
2. **PART B** — VAT validator. Independent of A, can run in parallel.
3. **PART C1, C2, C3, C4** — single-shot Lambdas in dependency order: listing-create → booking-quote → booking-create → booking-confirmed.
4. **PART C5** — block reservation Lambdas. Depends on Sessions 27 being deployed.
5. **PART C6** — commitment gate VAT step.
6. **PART C7** — VAT settings update endpoint.
7. **PART D** — frontend updates. D2 (frontend pricing function port) first, then D1 (Host form), D3 (booking summary), D4 (listing card), D5 (block plans), D6 (VAT settings page).
8. **PART E** — CDK + email templates + translation keys.
9. **PART F** — migration script (only run AFTER PART C is deployed and validated).
10. **Verify acceptance criteria.**

The single most important thing to get right is the gross-up math in `computeFullPriceBreakdown`. Verify by hand: for a €2/hour exempt Host with a 1-hour booking:
- hostNet = 2.00, hostVat = 0, hostGross = 2.00
- platformFee = 2.00 × 0.15 / 0.85 = 0.3529… → 0.35 (rounded)
- platformFeeVat = 0.35 × 0.21 = 0.0735 → 0.07
- spotterGross = 2.00 + 0.35 + 0.07 = 2.42

Check the invariant: spotterGross - platformFee - platformFeeVat = 2.42 - 0.35 - 0.07 = 2.00 = hostGross ✓
Check the fee proportion: platformFee / (hostGross + platformFee) = 0.35 / 2.35 = 0.1489 ≈ 0.15 ✓ (small rounding error from the 2dp rounding, acceptable)

If your implementation produces different numbers, the math is wrong. Stop and debug.

