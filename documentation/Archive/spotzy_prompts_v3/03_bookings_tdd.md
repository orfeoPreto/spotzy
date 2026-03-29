# Session 03 — Bookings Domain (TDD: tests first, then implementation)

## What this session does
Writes Jest unit tests for all booking business rules first, then implements the Lambda functions.

## Feed to Claude Code
This file only.

## Instructions for Claude Code
For every function: write the test file first → confirm tests fail → write implementation → confirm tests pass.
Mock all AWS SDK calls. Use test factories for listing/booking/user objects.

---

## Test factories (create in `__tests__/factories/`)

**`__tests__/factories/listing.factory.ts`**
```typescript
import { ulid } from 'ulid';
export const buildListing = (overrides = {}) => ({
  listingId: ulid(),
  hostId: 'test-host-1',
  address: 'Rue de la Loi 1, Brussels',
  addressLat: 50.8503,
  addressLng: 4.3517,
  spotType: 'COVERED_GARAGE',
  dimensions: 'STANDARD',
  evCharging: false,
  pricePerHour: 3.50,
  minDurationHours: 1,
  maxDurationHours: 720,
  reclaimNoticeHours: 2,
  status: 'LIVE',
  availabilityWindows: [{ dayOfWeek: '*', startTime: '00:00', endTime: '23:59' }],
  ...overrides,
});
```

**`__tests__/factories/booking.factory.ts`**
```typescript
export const buildBooking = (overrides = {}) => ({
  bookingId: ulid(),
  listingId: 'listing-1',
  spotterId: 'spotter-1',
  hostId: 'host-1',
  startTime: new Date(Date.now() + 86400000).toISOString(), // tomorrow
  endTime: new Date(Date.now() + 86400000 + 7200000).toISOString(), // tomorrow + 2h
  totalPrice: 7.00,
  platformFeePercent: 15,
  hostPayout: 5.95,
  status: 'CONFIRMED',
  cancellationPolicy: { gt48h: 100, between24and48h: 50, lt24h: 0 },
  version: 1,
  ...overrides,
});
```

---

## Function 1 — booking-create

### Tests first: `__tests__/bookings/create.test.ts`

**Happy path:**
- Valid booking request → returns 201, status=PENDING_PAYMENT, bookingId generated
- `totalPrice` correctly calculated: 2-hour booking at €3.50/hr → €7.00
- `hostPayout` = totalPrice × 0.85 = €5.95
- Cancellation policy stored on booking record at creation time
- EventBridge `booking.created` emitted with correct payload
- DynamoDB writes: BOOKING#{id} METADATA record + LISTING#{listingId} BOOKING#{id} record

**Idempotency:**
- Same `idempotencyKey` sent twice → second request returns existing booking (200, not 201)
- Different `idempotencyKey` → new booking created normally

**Availability conflict (→ 409):**
- A CONFIRMED booking already exists overlapping the requested period → 409 `SPOT_UNAVAILABLE`
- An ACTIVE booking overlapping the period → 409 `SPOT_UNAVAILABLE`
- A CANCELLED booking overlapping the period → allowed (cancelled doesn't block)
- A PENDING_PAYMENT booking overlapping → 409 (holds the slot)

**Availability window (→ 400):**
- Requested period outside host's defined availability windows → 400 `OUTSIDE_AVAILABILITY`
- Requested period partially inside window → 400

**Duration rules (→ 400):**
- Duration < listing's `minDurationHours` → 400 `BELOW_MINIMUM_DURATION`
- Duration > listing's `maxDurationHours` → 400 `EXCEEDS_MAXIMUM_DURATION`

**Time validation (→ 400):**
- `startTime` in the past → 400 `START_TIME_IN_PAST`
- `endTime` before `startTime` → 400 `INVALID_TIME_RANGE`

**Price calculation tests (unit test the `calculatePrice` helper separately):**
- 2h at €3.50/hr → €7.00
- 25h with day rate €20/day → €20.00 (rounds up to 1 day)
- 2h, no hourly rate, day rate only → uses day rate pro-rated? No — returns 400 if no applicable rate
- 35 days with monthly rate €300/month → €300.00

**Auth:**
- Missing auth → 401

### Implementation: `functions/bookings/create/index.ts`

- Authenticated. Extract `spotterId` from JWT `sub`.
- Body: `{ listingId, startTime, endTime, vehicleId, idempotencyKey }`.
- All validations as described in tests above.
- Idempotency check via DynamoDB query.
- Conditional write with `attribute_not_exists(PK)`.
- Emit EventBridge `booking.created`.
- Return 201.

---

## Function 2 — booking-get

### Tests first: `__tests__/bookings/get.test.ts`

**Happy path:**
- Spotter of the booking requests it → 200 with full booking
- Host of the listing requests it → 200 with full booking

**Access control:**
- Unrelated user requests → 403
- Missing auth → 401

**Not found:**
- Non-existent bookingId → 404

### Implementation: `functions/bookings/get/index.ts`

Fetch booking. Verify requester is spotter or host. Return 200 or appropriate error.

---

## Function 3 — booking-modify

### Tests first: `__tests__/bookings/modify.test.ts`

**START_TIME change — happy path:**
- New start time within availability, no conflict → booking updated, price recalculated
- New duration longer than original → `requiresAdditionalPayment: true` + `priceDifference` in response
- New duration shorter than original → `pendingRefundAmount` stored on booking
- EventBridge `booking.modified` emitted

**START_TIME change — failures:**
- Booking status is ACTIVE (already started) → 400 `CANNOT_MODIFY_ACTIVE_BOOKING`
- New start time is less than 2 hours from now → 400 `TOO_CLOSE_TO_START`
- New start time is in the past → 400
- New start time creates conflict with another booking → 409 `SLOT_UNAVAILABLE`

**END_TIME change — happy path:**
- Extending end time, slot available → updated, charge difference
- Reducing end time, above min duration → updated, refund amount stored

**END_TIME change — failures:**
- Extension conflicts with another booking → 409 `SLOT_UNAVAILABLE`
- Reduction would bring duration below `minDurationHours` → 400

**Optimistic locking:**
- Version mismatch on DynamoDB write → retry up to 3 times
- All 3 retries fail → 409 `CONCURRENT_MODIFICATION`

### Implementation: `functions/bookings/modify/index.ts`

Implement start time and end time modification flows. Use optimistic locking with version attribute.

---

## Function 4 — booking-cancel

### Tests first: `__tests__/bookings/cancel.test.ts`

**Refund calculation (test `calculateRefund` helper separately):**
- Spotter cancels, >48h before start → refundPercent=100, refundAmount=totalPrice
- Spotter cancels, 36h before start → refundPercent=50, refundAmount=totalPrice×0.5
- Spotter cancels, 12h before start → refundPercent=0, refundAmount=0
- Spotter cancels after booking has started → refundPercent=0
- Host cancels at any time → refundPercent=100 always

**Happy path:**
- Valid cancellation → status=CANCELLED, cancelledBy set, refundAmount stored
- EventBridge `booking.cancelled` emitted with correct refundAmount

**Failures:**
- Booking status is COMPLETED → 400 `CANNOT_CANCEL_COMPLETED`
- Booking status is already CANCELLED → 400 `ALREADY_CANCELLED`
- Requester is neither spotter nor host → 403

### Implementation: `functions/bookings/cancel/index.ts`

Apply refund calculation. Update booking status. Emit event.

---

## Function 5 — availability-block

### Tests first: `__tests__/bookings/availability-block.test.ts`

**Happy path:**
- `booking.created` event with 3-day booking → 3 DynamoDB records written (one per day)
- `booking.modified` event → old period records deleted, new period records written
- Correct PK/SK pattern: PK=`LISTING#{listingId}`, SK=`AVAIL#{date}#{bookingId}`

**Edge cases:**
- Single-day booking → 1 record written
- Booking crossing month boundary → records written for each day correctly

### Implementation: `functions/availability/block/index.ts`

EventBridge consumer. Write one DynamoDB record per day in the booking period.

---

## Function 6 — availability-release

### Tests first: `__tests__/bookings/availability-release.test.ts`

**Happy path:**
- `booking.cancelled` event → all availability records for that bookingId deleted
- `booking.modified` event (time change) → old period deleted, new period written

**Idempotency:**
- Release called twice for same booking → second call is a no-op (records already deleted)

### Implementation: `functions/availability/release/index.ts`

EventBridge consumer. Delete availability records for the booking period.

---

## Price calculation — unit test the helper in isolation

**`__tests__/bookings/price-calculator.test.ts`** — test `calculatePrice(listing, startTime, endTime)`:

| Scenario | Expected |
|---|---|
| 1h, hourly rate €3 | €3.00 |
| 1.5h, hourly rate €3 | €4.50 (rounds up to 2h) |
| 24h, daily rate €15 | €15.00 |
| 25h, daily rate €15 | €30.00 (rounds up to 2 days) |
| 30 days, monthly rate €200 | €200.00 |
| 31 days, monthly rate €200 | €400.00 |
| 2h, no hourly rate, daily rate €15 | €15.00 (uses day rate, minimum 1 day) |
| No rates set | throws `NoPriceConfiguredError` |
