# Availability — Updated & New Use Cases

## Background

The following use cases replace and extend UC-H02 (Define Availability Schedule) and UC-H05 (Manage Real-Time Availability), and fix a gap in UC-S01 (Search) and UC-S04 (Booking) where availability windows were not properly checked. They also introduce the underlying data model that makes all of this work consistently.

---

## Availability Data Model

### AvailabilityRule record

Each Host defines their availability as a set of recurring weekly rules. These are stored as individual DynamoDB records — one per rule — linked to the listing.

```
PK  = LISTING#{listingId}
SK  = AVAIL_RULE#{ruleId}
```

| Field | Type | Description |
|---|---|---|
| `ruleId` | string (ulid) | Unique identifier for this rule |
| `listingId` | string | Parent listing |
| `type` | enum | `ALWAYS` \| `WEEKLY` |
| `daysOfWeek` | number[] | 0=Sun … 6=Sat. Empty when type=ALWAYS |
| `startTime` | string | HH:mm (24h). Ignored when type=ALWAYS |
| `endTime` | string | HH:mm (24h). Ignored when type=ALWAYS |
| `createdAt` | ISO8601 | |
| `updatedAt` | ISO8601 | |

**Examples:**
- `ALWAYS` rule → spot is available 24/7 with no time restrictions
- `WEEKLY` rule with `daysOfWeek=[1,2,3,4,5]`, `startTime=08:00`, `endTime=20:00` → available Monday–Friday 8am–8pm

A listing can have **multiple WEEKLY rules** (e.g. Mon–Fri 8am–6pm + Saturday 9am–1pm). A listing has **at most one ALWAYS rule** — if an ALWAYS rule exists, all other rules are ignored.

### AvailabilityBlock record (existing — from booking lifecycle)

When a booking is confirmed, availability-block Lambda writes one record per booked day:

```
PK  = LISTING#{listingId}
SK  = AVAIL_BLOCK#{date}#{bookingId}
```

These block records are the source of truth for "is this slot taken?" checks.

### Computed availability resolution

To determine whether a listing is available for a requested period `[startTime, endTime]`:

1. Fetch all `AVAIL_RULE#` records for the listing
2. For each day in the requested period, check if any rule covers that day and time
3. Fetch all `AVAIL_BLOCK#` records for the listing overlapping the period
4. A slot is **available** if: at least one rule covers it AND no block record exists for it

This logic is encapsulated in a shared helper `shared/availability/resolver.ts` used by both listing-search and booking-create.

---

## UC-H02 (revised) — Define Availability Schedule

| Field | Detail |
|---|---|
| **Goal** | Host defines when their parking spot is available for booking, as part of listing creation |
| **Primary Actor** | Host |
| **Precondition** | Draft listing exists (UC-H01 completed) |
| **Trigger** | Host opens the availability step in the listing creation wizard |

### Main Flow — Always available

1. Host selects "Always available (24/7)" option.
2. System creates one `AVAIL_RULE` record: type=`ALWAYS`, listingId, ruleId=ulid().
3. System displays a confirmation: "Your spot will be available around the clock."
4. Host proceeds to the next step (pricing / publish).

### Main Flow — Weekly schedule

1. Host selects "Set a weekly schedule" option.
2. System shows a weekly grid: 7 day columns, each with a start time and end time input.
3. Host toggles which days are active and sets start/end times per day.
4. Host can add **multiple rules for the same day** (e.g. Mon 8am–12pm and Mon 2pm–6pm) by clicking "Add time slot".
5. System validates each rule: `endTime` must be after `startTime`. Overlapping rules on the same day are not allowed — system warns and blocks saving.
6. Host saves the schedule.
7. System deletes all existing `AVAIL_RULE` records for this listing, then writes new records — one per defined rule — as a batch.
8. System displays a preview calendar showing the next 14 days with available slots highlighted green.

### Acceptance Criteria

- **AC1**: An ALWAYS rule means the listing appears in search for any requested date/time combination.
- **AC2**: A WEEKLY rule makes the listing appear in search only when the requested period falls within the defined days and times.
- **AC3**: Saving a new schedule replaces all previous rules atomically — no partial state possible.
- **AC4**: At least one rule must be saved before the listing can be published. The publish completeness check (UC-H04) fails with `failedChecks: ["availability"]` if no rules exist.
- **AC5**: Overlapping rules on the same day are rejected with a clear error message before saving.
- **AC6**: A listing may have a maximum of 14 weekly rules (2 per day × 7 days).

### Alternate Flows

- **No days selected**: Host tries to save a weekly schedule with no days toggled → system blocks save, shows "Select at least one day."
- **End time before start time**: Inline validation error on the affected row, save blocked.

**Postcondition**: One or more `AVAIL_RULE` records exist for the listing. The listing can proceed to publish.

---

## UC-H05 (revised) — Edit Availability Schedule Post-Publish

| Field | Detail |
|---|---|
| **Goal** | Host modifies their availability schedule after the listing is live |
| **Primary Actor** | Host |
| **Precondition** | Listing is published (status=LIVE); host is authenticated as owner |
| **Trigger** | Host selects "Edit availability" from the listing management screen |

### Main Flow

1. System fetches all existing `AVAIL_RULE` records for the listing.
2. System displays the current schedule in the weekly grid (pre-populated).
3. Host makes changes — toggles days, adjusts times, switches between ALWAYS and WEEKLY.
4. Host clicks "Save changes".
5. System checks whether any confirmed or active bookings exist **within the next 90 days** that would fall outside the new availability rules.
6. **No conflicts found**: System replaces all `AVAIL_RULE` records with the new set. Displays "Schedule updated."
7. **Conflicts found**: System blocks the save. Displays a conflict list: "The following bookings fall in periods you are removing: [booking list with dates and Spotter names]." Host cannot proceed until conflicts are resolved (bookings must be completed or cancelled first).

### Acceptance Criteria

- **AC1**: A host cannot remove an availability window that contains a confirmed or active booking. The save is blocked, not warned.
- **AC2**: A host CAN change availability for periods that contain only PENDING_PAYMENT bookings — those are not yet confirmed.
- **AC3**: Switching from WEEKLY to ALWAYS is always permitted regardless of existing bookings (it is an expansion of availability, never a reduction).
- **AC4**: Switching from ALWAYS to WEEKLY is subject to conflict checking.
- **AC5**: The conflict check window is 90 days. Bookings beyond 90 days are not checked (edge case — acceptable for MVP).
- **AC6**: After a successful save, the updated rules take effect immediately — new searches reflect the new schedule within seconds.
- **AC7**: The listing's `availabilityUpdatedAt` timestamp is set on every successful save.

### Alternate Flows

- **Host switches to ALWAYS with no conflicts**: Instant save, all weekly rules replaced by a single ALWAYS rule.
- **Host removes one time slot that has no bookings**: Removed cleanly, other slots unaffected.

**Postcondition**: Updated `AVAIL_RULE` records replace the previous ones. Listing search results and booking validation immediately reflect the change.

---

## UC-S01 (revised) — Search with Availability Filtering

| Field | Detail |
|---|---|
| **Goal** | Spotter finds listings that are actually available for their intended period |
| **Primary Actor** | Spotter |
| **Precondition** | Spotter is on the search screen; Mapbox map loaded |
| **Trigger** | Spotter enters a destination (with or without dates) |

### Main Flow — Search without dates

1. Spotter enters a destination but does not specify dates.
2. System queries listings by geohash (as before).
3. For each LIVE listing returned, system checks whether it has **at least one available slot in the next 30 days**: fetches its `AVAIL_RULE` records and checks if any rule produces at least one slot not blocked by an `AVAIL_BLOCK` record in the next 30 days.
4. Listings with no availability in the next 30 days are **excluded** from results.
5. Results are sorted by distance. Each result shows an "Available from [earliest available date]" label.
6. Spotter can tap a listing to view its availability calendar before booking.

### Main Flow — Search with dates

1. Spotter enters a destination and specifies `startTime` + `endTime`.
2. System queries listings by geohash.
3. For each listing, system runs the availability resolver:
   a. Fetch `AVAIL_RULE` records — check the requested period falls within the rules.
   b. Fetch `AVAIL_BLOCK` records — check no confirmed booking blocks the period.
   c. Listing is **included** only if both checks pass.
4. Results display with "Available [dates]" confirmation badge.
5. A listing that passes the rule check but has a partial block (some hours blocked but not all) is shown with "Limited availability — check calendar."

### Acceptance Criteria

- **AC1**: A listing with no `AVAIL_RULE` records is **never** returned in search results — it cannot be booked.
- **AC2**: A listing with an ALWAYS rule and no blocks is always returned (unless filtered out by other filters).
- **AC3**: A listing with a WEEKLY rule is returned in a date-filtered search **only if the entire requested period falls within rule coverage**. Partial overlap is not enough.
- **AC4**: When no dates are specified, a listing is returned only if it has at least one free slot in the next 30 days.
- **AC5**: Confirmed bookings (status=CONFIRMED or ACTIVE) block the relevant slots. PENDING_PAYMENT bookings also block slots (to prevent double-booking during payment). CANCELLED bookings do not block.
- **AC6**: The availability check adds no more than 200ms to search response time (achieved by batching DynamoDB reads).
- **AC7**: Walking distance and all other existing filters still apply on top of availability filtering.

### Alternate Flows

- **All nearby listings are fully booked**: System expands radius and retries. If still none, shows "No spots available for these dates — try different dates or a wider area."
- **Requested period partially within rule**: Listing excluded. No partial matches surfaced.

**Postcondition**: Every listing returned in search results is confirmed available for at least the duration specified (or the next 30 days if no dates given).

---

## UC-S04 (revised) — Availability Re-validation at Booking Time

The availability check at search time is a best-effort filter. At booking time, a hard re-validation is mandatory because availability can change between search and booking.

### Additional steps inserted into UC-S04 Main Flow (after step 1 — date selection):

**Step 1a** — Hard availability re-validation:
- System fetches `AVAIL_RULE` records for the listing.
- System checks the requested `[startTime, endTime]` falls fully within the rules.
- System fetches `AVAIL_BLOCK` records for the listing overlapping the requested period, using a **strongly consistent DynamoDB read**.
- If any conflict: return 409 `SPOT_UNAVAILABLE` before any payment is initiated.
- If rules do not cover the period: return 400 `OUTSIDE_AVAILABILITY_WINDOW` with a message describing which part of the period is not covered.

### Updated Acceptance Criteria for UC-S04

- **AC-NEW-1**: A booking can never be created for a period not covered by the listing's `AVAIL_RULE` records — even if the listing appeared in search results (race condition protection).
- **AC-NEW-2**: The availability check at booking time uses strongly consistent reads to prevent double-booking.
- **AC-NEW-3**: The error response for `OUTSIDE_AVAILABILITY_WINDOW` includes `coveredWindows: [...]` so the frontend can display what windows are actually available.

---

## Shared helper — `shared/availability/resolver.ts`

This module is used by listing-search, booking-create, and booking-modify. It must be tested in complete isolation.

### Functions to implement

```typescript
/**
 * Checks whether a requested period is fully covered by at least one availability rule.
 * Does NOT check for booking blocks — that is a separate concern.
 */
export function isWithinAvailabilityRules(
  rules: AvailabilityRule[],
  startTime: Date,
  endTime: Date
): { covered: boolean; uncoveredPeriods: Array<{ from: Date; to: Date }> }

/**
 * Returns the earliest available slot for a listing within a look-ahead window.
 * Used by search-without-dates to determine "Available from [date]".
 */
export function findNextAvailableSlot(
  rules: AvailabilityRule[],
  blocks: AvailabilityBlock[],
  fromDate: Date,
  lookAheadDays: number
): Date | null

/**
 * Given a set of rules and blocks, returns all free slots within a date range.
 * Used by the availability calendar on the listing detail page.
 */
export function computeFreeSlots(
  rules: AvailabilityRule[],
  blocks: AvailabilityBlock[],
  fromDate: Date,
  toDate: Date,
  slotDurationHours: number
): Array<{ start: Date; end: Date }>
```

### Key behaviours to test

- ALWAYS rule + no blocks → `isWithinAvailabilityRules` returns `covered: true` for any period
- WEEKLY rule Mon–Fri 8–18 → Wednesday 10:00–12:00 is covered; Saturday 10:00–12:00 is not
- WEEKLY rule Mon–Fri 8–18 → Monday 7:00–10:00 is NOT covered (starts before rule start)
- WEEKLY rule Mon–Fri 8–18 → Monday 16:00–19:00 is NOT covered (ends after rule end)
- Period spanning midnight → correctly split across two days and both day-rules checked
- Period spanning multiple days → all days in the span must be covered by rules
- `findNextAvailableSlot` with all slots blocked → returns null
- `findNextAvailableSlot` with first slot free → returns that slot's start
- `computeFreeSlots` with a 2h block in the middle of a day → returns two slots either side of the block
