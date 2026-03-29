# Session 12 — Availability Feature (TDD: tests first, then implementation)

## What this session does
Fixes and completes the availability feature end-to-end:
1. Availability resolver shared helper (pure logic — most critical)
2. Availability rule CRUD Lambda (save / fetch / replace rules)
3. listing-search updated to filter by real availability
4. booking-create updated to hard-validate against rules
5. New API route for fetching a listing's availability calendar
6. Frontend availability grid component (edit + display)

## Feed to Claude Code
This file only. The scaffold from Session 00 and implementations from Sessions 02 and 03 must already exist.

## Instructions
Write the test file first for every unit. Confirm it fails. Then implement. Confirm it passes.

---

## Part 1 — Shared availability resolver

### Data types (add to `shared/types/availability.ts`)

```typescript
export type AvailabilityRuleType = 'ALWAYS' | 'WEEKLY';

export interface AvailabilityRule {
  ruleId: string;
  listingId: string;
  type: AvailabilityRuleType;
  daysOfWeek: number[];   // 0=Sun … 6=Sat. Empty array when type=ALWAYS
  startTime: string;      // "HH:mm" 24h. Ignored when type=ALWAYS
  endTime: string;        // "HH:mm" 24h. Ignored when type=ALWAYS
  createdAt: string;
  updatedAt: string;
}

export interface AvailabilityBlock {
  listingId: string;
  bookingId: string;
  date: string;           // "YYYY-MM-DD"
  startTime: string;      // ISO8601 full datetime
  endTime: string;        // ISO8601 full datetime
  status: 'CONFIRMED' | 'ACTIVE' | 'PENDING_PAYMENT';
}

export interface AvailabilityCheckResult {
  covered: boolean;
  uncoveredPeriods: Array<{ from: Date; to: Date }>;
}
```

### DynamoDB key patterns (add to `shared/db/keys.ts`)

```typescript
// Availability rules
export const availRuleKey = (listingId: string, ruleId: string) => ({
  PK: `LISTING#${listingId}`,
  SK: `AVAIL_RULE#${ruleId}`,
});

export const availRulesForListing = (listingId: string) => ({
  PK: `LISTING#${listingId}`,
  SK_prefix: 'AVAIL_RULE#',
});

// Availability blocks (already exist — confirm these match)
export const availBlockKey = (listingId: string, date: string, bookingId: string) => ({
  PK: `LISTING#${listingId}`,
  SK: `AVAIL_BLOCK#${date}#${bookingId}`,
});

export const availBlocksForPeriod = (listingId: string, fromDate: string, toDate: string) => ({
  PK: `LISTING#${listingId}`,
  SK_between: [`AVAIL_BLOCK#${fromDate}`, `AVAIL_BLOCK#${toDate}~`],
});
```

---

### Tests first: `__tests__/shared/availability-resolver.test.ts`

This is a pure TypeScript unit test — no AWS mocks needed. Import and test the functions directly.

#### `isWithinAvailabilityRules` tests

```typescript
describe('isWithinAvailabilityRules', () => {

  describe('ALWAYS rule', () => {
    const alwaysRule: AvailabilityRule = {
      ruleId: 'r1', listingId: 'l1', type: 'ALWAYS',
      daysOfWeek: [], startTime: '', endTime: '',
      createdAt: '', updatedAt: '',
    };

    test('covers any period', () => {
      const result = isWithinAvailabilityRules(
        [alwaysRule],
        new Date('2026-04-14T10:00:00Z'),
        new Date('2026-04-14T12:00:00Z')
      );
      expect(result.covered).toBe(true);
      expect(result.uncoveredPeriods).toHaveLength(0);
    });

    test('covers multi-day period', () => {
      const result = isWithinAvailabilityRules(
        [alwaysRule],
        new Date('2026-04-14T10:00:00Z'),
        new Date('2026-04-16T10:00:00Z')
      );
      expect(result.covered).toBe(true);
    });
  });

  describe('WEEKLY rule — Mon–Fri 08:00–18:00', () => {
    const weekdayRule: AvailabilityRule = {
      ruleId: 'r1', listingId: 'l1', type: 'WEEKLY',
      daysOfWeek: [1, 2, 3, 4, 5], // Mon=1 … Fri=5
      startTime: '08:00', endTime: '18:00',
      createdAt: '', updatedAt: '',
    };

    // 2026-04-14 is a Tuesday
    test('Tuesday 10:00–12:00 is covered', () => {
      const result = isWithinAvailabilityRules(
        [weekdayRule],
        new Date('2026-04-14T10:00:00Z'),
        new Date('2026-04-14T12:00:00Z')
      );
      expect(result.covered).toBe(true);
    });

    test('Saturday 10:00–12:00 is NOT covered', () => {
      // 2026-04-18 is Saturday
      const result = isWithinAvailabilityRules(
        [weekdayRule],
        new Date('2026-04-18T10:00:00Z'),
        new Date('2026-04-18T12:00:00Z')
      );
      expect(result.covered).toBe(false);
      expect(result.uncoveredPeriods).toHaveLength(1);
    });

    test('period starting before rule start (07:00–10:00) is NOT covered', () => {
      const result = isWithinAvailabilityRules(
        [weekdayRule],
        new Date('2026-04-14T07:00:00Z'),
        new Date('2026-04-14T10:00:00Z')
      );
      expect(result.covered).toBe(false);
    });

    test('period ending after rule end (16:00–19:00) is NOT covered', () => {
      const result = isWithinAvailabilityRules(
        [weekdayRule],
        new Date('2026-04-14T16:00:00Z'),
        new Date('2026-04-14T19:00:00Z')
      );
      expect(result.covered).toBe(false);
    });

    test('period spanning Mon–Wed is covered (all days covered by rule)', () => {
      const result = isWithinAvailabilityRules(
        [weekdayRule],
        new Date('2026-04-13T09:00:00Z'),  // Monday
        new Date('2026-04-15T17:00:00Z')   // Wednesday
      );
      expect(result.covered).toBe(true);
    });

    test('period spanning Fri–Mon is NOT fully covered (weekend not covered)', () => {
      const result = isWithinAvailabilityRules(
        [weekdayRule],
        new Date('2026-04-17T09:00:00Z'),  // Friday
        new Date('2026-04-20T17:00:00Z')   // Monday
      );
      expect(result.covered).toBe(false);
      // Saturday and Sunday should appear in uncoveredPeriods
      expect(result.uncoveredPeriods.length).toBeGreaterThan(0);
    });
  });

  describe('multiple WEEKLY rules', () => {
    const morningRule: AvailabilityRule = {
      ruleId: 'r1', listingId: 'l1', type: 'WEEKLY',
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '07:00', endTime: '12:00',
      createdAt: '', updatedAt: '',
    };
    const afternoonRule: AvailabilityRule = {
      ruleId: 'r2', listingId: 'l1', type: 'WEEKLY',
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '14:00', endTime: '20:00',
      createdAt: '', updatedAt: '',
    };

    test('Tuesday 09:00–11:00 covered by morning rule', () => {
      const result = isWithinAvailabilityRules([morningRule, afternoonRule],
        new Date('2026-04-14T09:00:00Z'), new Date('2026-04-14T11:00:00Z'));
      expect(result.covered).toBe(true);
    });

    test('Tuesday 15:00–18:00 covered by afternoon rule', () => {
      const result = isWithinAvailabilityRules([morningRule, afternoonRule],
        new Date('2026-04-14T15:00:00Z'), new Date('2026-04-14T18:00:00Z'));
      expect(result.covered).toBe(true);
    });

    test('Tuesday 11:00–15:00 spans the gap — NOT covered', () => {
      const result = isWithinAvailabilityRules([morningRule, afternoonRule],
        new Date('2026-04-14T11:00:00Z'), new Date('2026-04-14T15:00:00Z'));
      expect(result.covered).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('empty rules array → not covered', () => {
      const result = isWithinAvailabilityRules([],
        new Date('2026-04-14T10:00:00Z'), new Date('2026-04-14T12:00:00Z'));
      expect(result.covered).toBe(false);
    });

    test('startTime === endTime → not covered (zero-length period)', () => {
      const alwaysRule: AvailabilityRule = { ruleId: 'r1', listingId: 'l1', type: 'ALWAYS', daysOfWeek: [], startTime: '', endTime: '', createdAt: '', updatedAt: '' };
      const result = isWithinAvailabilityRules([alwaysRule],
        new Date('2026-04-14T10:00:00Z'), new Date('2026-04-14T10:00:00Z'));
      expect(result.covered).toBe(false);
    });
  });
});
```

#### `findNextAvailableSlot` tests

```typescript
describe('findNextAvailableSlot', () => {
  const alwaysRule: AvailabilityRule = { ruleId: 'r1', listingId: 'l1', type: 'ALWAYS', daysOfWeek: [], startTime: '', endTime: '', createdAt: '', updatedAt: '' };

  test('no blocks → returns fromDate rounded up to next hour', () => {
    const from = new Date('2026-04-14T09:30:00Z');
    const slot = findNextAvailableSlot([alwaysRule], [], from, 30);
    expect(slot).not.toBeNull();
    expect(slot!.getTime()).toBeGreaterThanOrEqual(from.getTime());
  });

  test('all next 30 days blocked → returns null', () => {
    const from = new Date('2026-04-14T00:00:00Z');
    // Generate a block for every day in the next 30 days
    const blocks: AvailabilityBlock[] = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      return {
        listingId: 'l1', bookingId: `b${i}`,
        date: d.toISOString().split('T')[0],
        startTime: new Date(d.setHours(0,0,0,0)).toISOString(),
        endTime: new Date(d.setHours(23,59,59,0)).toISOString(),
        status: 'CONFIRMED',
      };
    });
    const slot = findNextAvailableSlot([alwaysRule], blocks, from, 30);
    expect(slot).toBeNull();
  });

  test('WEEKLY rule with gap — finds next available day within look-ahead', () => {
    const weekdayRule: AvailabilityRule = {
      ruleId: 'r1', listingId: 'l1', type: 'WEEKLY',
      daysOfWeek: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '18:00',
      createdAt: '', updatedAt: '',
    };
    // fromDate is a Saturday (no availability until Monday)
    const from = new Date('2026-04-18T10:00:00Z'); // Saturday
    const slot = findNextAvailableSlot([weekdayRule], [], from, 30);
    expect(slot).not.toBeNull();
    expect(slot!.getDay()).toBe(1); // Should be Monday
  });

  test('PENDING_PAYMENT blocks count (not just CONFIRMED)', () => {
    const alwaysRule: AvailabilityRule = { ruleId: 'r1', listingId: 'l1', type: 'ALWAYS', daysOfWeek: [], startTime: '', endTime: '', createdAt: '', updatedAt: '' };
    const blocks: AvailabilityBlock[] = [{
      listingId: 'l1', bookingId: 'b1',
      date: '2026-04-14',
      startTime: '2026-04-14T00:00:00Z',
      endTime: '2026-04-14T23:59:59Z',
      status: 'PENDING_PAYMENT', // Should still block
    }];
    const from = new Date('2026-04-14T00:00:00Z');
    const slot = findNextAvailableSlot([alwaysRule], blocks, from, 2);
    // Should find slot on April 15
    expect(slot?.toISOString().startsWith('2026-04-15')).toBe(true);
  });
});
```

#### `computeFreeSlots` tests

```typescript
describe('computeFreeSlots', () => {
  test('ALWAYS rule, no blocks → returns continuous slots for the full day', () => {
    const alwaysRule: AvailabilityRule = { ruleId: 'r1', listingId: 'l1', type: 'ALWAYS', daysOfWeek: [], startTime: '', endTime: '', createdAt: '', updatedAt: '' };
    const slots = computeFreeSlots(
      [alwaysRule], [],
      new Date('2026-04-14T00:00:00Z'),
      new Date('2026-04-14T23:59:59Z'),
      1 // 1-hour slots
    );
    expect(slots.length).toBe(24);
  });

  test('block in the middle of the day splits available slots', () => {
    const alwaysRule: AvailabilityRule = { ruleId: 'r1', listingId: 'l1', type: 'ALWAYS', daysOfWeek: [], startTime: '', endTime: '', createdAt: '', updatedAt: '' };
    const blocks: AvailabilityBlock[] = [{
      listingId: 'l1', bookingId: 'b1',
      date: '2026-04-14',
      startTime: '2026-04-14T10:00:00Z',
      endTime: '2026-04-14T12:00:00Z',
      status: 'CONFIRMED',
    }];
    const slots = computeFreeSlots(
      [alwaysRule], blocks,
      new Date('2026-04-14T08:00:00Z'),
      new Date('2026-04-14T14:00:00Z'),
      1
    );
    // Should have slots 08-10 and 12-14 but NOT 10-12
    const blockedSlot = slots.find(s =>
      s.start.getHours() === 10 && s.end.getHours() === 11
    );
    expect(blockedSlot).toBeUndefined();
    expect(slots.length).toBe(4); // 08, 09, 12, 13
  });

  test('WEEKLY rule — only returns slots on matching days', () => {
    const weekdayRule: AvailabilityRule = {
      ruleId: 'r1', listingId: 'l1', type: 'WEEKLY',
      daysOfWeek: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '18:00',
      createdAt: '', updatedAt: '',
    };
    // Request covers Mon–Sun
    const slots = computeFreeSlots(
      [weekdayRule], [],
      new Date('2026-04-13T00:00:00Z'), // Monday
      new Date('2026-04-19T23:59:59Z'), // Sunday
      1
    );
    // Only Mon–Fri 08–18 = 5 days × 10 slots = 50 slots
    expect(slots.length).toBe(50);
    // No Saturday or Sunday slots
    const weekendSlot = slots.find(s => s.start.getDay() === 0 || s.start.getDay() === 6);
    expect(weekendSlot).toBeUndefined();
  });
});
```

### Implementation: `shared/availability/resolver.ts`

Implement all three functions to pass the above tests. Key implementation notes:

- All date arithmetic must use UTC to avoid timezone bugs. Never use `getHours()` / `getDay()` directly — always use UTC equivalents (`getUTCHours()`, `getUTCDay()`).
- `isWithinAvailabilityRules`: decompose the requested period into 1-hour chunks. For each chunk, check that at least one rule covers it. Return `covered=true` only if ALL chunks are covered.
- `findNextAvailableSlot`: iterate hour by hour from `fromDate`, check each 1-hour slot against rules and blocks, return the first free slot's start time.
- `computeFreeSlots`: iterate hour by hour through the requested range, return slots that are both rule-covered and not blocked.

---

## Part 2 — Availability rules Lambda

### New function: `listing-availability` (handles CRUD for rules)

#### Tests first: `__tests__/listings/availability.test.ts`

**GET /api/v1/listings/{id}/availability**
```typescript
test('returns all AVAIL_RULE records for the listing', async () => { ... });
test('public access — no auth required', async () => { ... });
test('listing not found → 404', async () => { ... });
test('listing with no rules → returns empty rules array', async () => { ... });
```

**PUT /api/v1/listings/{id}/availability (replaces all rules)**
```typescript
test('ALWAYS type — creates single ALWAYS rule, deletes all previous rules', async () => {
  // Setup: listing has 3 existing WEEKLY rules
  // Action: PUT with { type: 'ALWAYS' }
  // Assert: DynamoDB batch-delete called for old rules, single ALWAYS rule written
});

test('WEEKLY type — saves multiple rules correctly', async () => {
  // Body: { rules: [{ daysOfWeek: [1,2,3,4,5], startTime: '08:00', endTime: '18:00' }] }
  // Assert: one DynamoDB record written per rule
});

test('overlapping rules on same day → 400 OVERLAPPING_RULES', async () => {
  // Mon 08:00–12:00 and Mon 10:00–14:00 overlap
});

test('endTime before startTime → 400 INVALID_TIME_RANGE', async () => { ... });

test('no rules provided with WEEKLY type → 400 NO_RULES_PROVIDED', async () => { ... });

test('more than 14 rules → 400 TOO_MANY_RULES', async () => { ... });

test('LIVE listing with confirmed booking in affected period → 409 BOOKING_CONFLICT', async () => {
  // Setup: listing has WEEKLY rule Mon-Fri 08-18
  //        confirmed booking exists Mon 10:00-12:00
  // Action: PUT with ALWAYS type (expansion — allowed) → 200
  // Action: PUT with WEEKLY Sat-Sun only (removes Mon) → 409
});

test('switching from WEEKLY to ALWAYS with existing booking → 200 (expansion allowed)', async () => { ... });

test('not the listing owner → 403', async () => { ... });
```

**Conflict check implementation detail:**
- Fetch all bookings for the listing with status IN (CONFIRMED, ACTIVE) using GSI1 query
- Filter to bookings within the next 90 days
- For each such booking, check whether it would still be covered by the NEW rules
- If any booking is NOT covered by the new rules → 409, include the conflicting bookings in response body

#### Implementation: `functions/listings/availability/index.ts`

```typescript
// GET handler
export const getAvailability: APIGatewayProxyHandler = async (event) => {
  const { id: listingId } = event.pathParameters!;
  // Fetch all AVAIL_RULE# records for the listing
  // Return { listingId, rules: AvailabilityRule[], type: 'ALWAYS' | 'WEEKLY' | 'NONE' }
};

// PUT handler
export const putAvailability: APIGatewayProxyHandler = async (event) => {
  // 1. Parse and validate body
  // 2. Verify ownership
  // 3. Check for booking conflicts with new rules
  // 4. Atomically replace all AVAIL_RULE records (batch delete old, batch write new)
  // 5. Update listing record: availabilityUpdatedAt, hasAvailability=true
  // 6. Return 200 with new rules
};
```

Add two new routes to the CDK ApiStack:
```
GET  /api/v1/listings/{id}/availability  → listing-availability-get   (public)
PUT  /api/v1/listings/{id}/availability  → listing-availability-put   (auth required)
```

---

## Part 3 — Update listing-search

### Tests first: add to `__tests__/listings/search.test.ts`

**Availability filtering:**
```typescript
test('listing with no AVAIL_RULE records → excluded from results', async () => {
  // Mock DynamoDB to return a listing but no AVAIL_RULE records for it
  // Search results should be empty
});

test('listing with ALWAYS rule and no blocks → included in date-filtered search', async () => { ... });

test('listing with WEEKLY rule Mon-Fri, search on Saturday → excluded', async () => {
  // startTime = next Saturday 10:00, endTime = next Saturday 12:00
  // Listing has WEEKLY rule daysOfWeek=[1,2,3,4,5] only
  // → excluded
});

test('listing with WEEKLY rule Mon-Fri, search on Monday → included', async () => { ... });

test('listing with ALWAYS rule but confirmed booking for requested period → excluded', async () => {
  // Mock: AVAIL_RULE = ALWAYS, AVAIL_BLOCK covers entire requested period
  // → excluded
});

test('search without dates → only listings with slot in next 30 days included', async () => {
  // Listing A: ALWAYS rule, no blocks → included
  // Listing B: WEEKLY Mon-Fri, today is Sunday, no slots until Monday → included (Monday in 30 days)
  // Listing C: WEEKLY Mon-Fri, all Mon-Fri slots blocked for next 30 days → excluded
});

test('availability check does not exceed 200ms for 20 listings', async () => {
  // Performance test — mock 20 listings, verify resolver called efficiently
});
```

**Updated listing-search implementation changes:**

After fetching candidate listings from GSI2 (geohash search), for each listing:

1. Batch-fetch all `AVAIL_RULE#` records (single DynamoDB `BatchGetItem` call for all listings)
2. If dates provided: run `isWithinAvailabilityRules(rules, startTime, endTime)` — exclude if not covered
3. If dates provided: batch-fetch `AVAIL_BLOCK#` records for the period across all listings
4. If dates provided: exclude listings where the entire requested period is blocked
5. If no dates provided: run `findNextAvailableSlot(rules, blocks, now, 30)` per listing — exclude if null; add `nextAvailableAt` to result
6. Return filtered, sorted results

**Performance requirement**: all DynamoDB reads for availability must be batched, not sequential. Use `BatchGetItem` and `Query` with `IN` operator. Never call DynamoDB in a loop per listing.

---

## Part 4 — Update booking-create

### Tests first: add to `__tests__/bookings/create.test.ts`

```typescript
test('requested period not within AVAIL_RULE → 400 OUTSIDE_AVAILABILITY_WINDOW with coveredWindows', async () => {
  // Listing has WEEKLY rule Mon-Fri 08:00-18:00
  // Request is for Saturday
  // → 400, response includes coveredWindows showing Mon-Fri 08-18
});

test('requested period within AVAIL_RULE → proceeds to booking', async () => {
  // Listing has WEEKLY rule Mon-Fri 08:00-18:00
  // Request is for next Tuesday 09:00-11:00
  // → no availability error, proceeds to conflict check
});

test('availability check uses STRONGLY CONSISTENT read for AVAIL_BLOCK', async () => {
  // Verify DynamoDB GetItem is called with ConsistentRead: true
  // (prevents race condition where two bookings created simultaneously)
});

test('AVAIL_RULE check happens BEFORE payment initiation', async () => {
  // Verify that when availability check fails, no Stripe call is made
});
```

**Updated booking-create implementation change** — insert after step 1 (date validation):

```typescript
// Step 1a: Fetch AVAIL_RULE records and validate period
const rules = await fetchAvailabilityRules(listingId); // Query PK=LISTING#{id} SK begins_with AVAIL_RULE#
const ruleCheck = isWithinAvailabilityRules(rules, new Date(startTime), new Date(endTime));
if (!ruleCheck.covered) {
  return badRequest('OUTSIDE_AVAILABILITY_WINDOW', {
    uncoveredPeriods: ruleCheck.uncoveredPeriods,
    coveredWindows: rules.map(r => ({
      type: r.type, daysOfWeek: r.daysOfWeek,
      startTime: r.startTime, endTime: r.endTime,
    })),
  });
}

// Step 1b: Strongly consistent availability block check
const blocks = await fetchAvailabilityBlocksConsistent(listingId, startTime, endTime);
if (hasBlockConflict(blocks, startTime, endTime)) {
  return conflict('SPOT_UNAVAILABLE');
}
```

---

## Part 5 — Frontend availability components

### Tests first: `__tests__/components/AvailabilityGrid.test.tsx`

```typescript
describe('<AvailabilityGrid /> — edit mode (host)', () => {
  test('renders 7 day columns', () => { ... });

  test('"Always available" toggle shows/hides weekly grid', () => {
    render(<AvailabilityGrid mode="edit" />);
    const toggle = screen.getByLabelText('Always available');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('weekly-grid')).not.toBeInTheDocument();
  });

  test('toggling a day enables its time inputs', () => {
    render(<AvailabilityGrid mode="edit" />);
    const mondayToggle = screen.getByLabelText('Monday');
    fireEvent.click(mondayToggle);
    expect(screen.getByLabelText('Monday start time')).not.toBeDisabled();
  });

  test('overlapping rules on same day shows inline error', () => {
    render(<AvailabilityGrid mode="edit" rules={[
      { daysOfWeek: [1], startTime: '08:00', endTime: '12:00' },
      { daysOfWeek: [1], startTime: '10:00', endTime: '14:00' }, // overlaps
    ]} />);
    expect(screen.getByText(/overlapping/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  test('end time before start time shows inline error', () => { ... });

  test('"Save" calls onSave with correct rules payload', async () => {
    const onSave = jest.fn();
    render(<AvailabilityGrid mode="edit" onSave={onSave} />);
    // Configure Mon–Fri 08:00–18:00
    // Click save
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      type: 'WEEKLY',
      rules: [{ daysOfWeek: [1,2,3,4,5], startTime: '08:00', endTime: '18:00' }],
    }));
  });
});

describe('<AvailabilityGrid /> — display mode (spotter, listing detail)', () => {
  test('shows available slots in green', () => { ... });
  test('shows booked slots in navy', () => { ... });
  test('shows unavailable days in grey', () => { ... });
  test('clicking an available date fires onDateSelect', () => { ... });
  test('clicking a booked date does nothing', () => { ... });
});
```

### Implementation: `components/AvailabilityGrid.tsx`

Props:
```typescript
interface AvailabilityGridProps {
  mode: 'edit' | 'display';
  rules?: AvailabilityRule[];                    // Pre-populated for edit mode
  blocks?: AvailabilityBlock[];                  // For display mode
  onSave?: (payload: SaveAvailabilityPayload) => void;  // Edit mode
  onDateSelect?: (date: Date) => void;           // Display mode
  selectedRange?: { start: Date; end: Date };    // Display mode
}
```

**Edit mode behaviour:**
- Toggle "Always available (24/7)" → show/hides weekly grid, updates type in local state
- Weekly grid: 7 day toggles, each with start/end time inputs (disabled when day not toggled)
- "Add time slot" per day for multiple rules
- Real-time overlap validation using `isWithinAvailabilityRules`-equivalent logic
- "Save" button disabled while validation errors exist
- Calls `PUT /api/v1/listings/{id}/availability` on save

**Display mode behaviour:**
- Shows a 2-week rolling calendar
- Computes free/busy slots using `computeFreeSlots` (call client-side with fetched rules + blocks)
- Available slots: green background
- Booked slots: navy background
- Days with no availability from rules: grey, non-interactive
- Selected range: amber highlight
- Clicking a free slot → calls `onDateSelect`

---

## Part 6 — Integration: wire up in listing wizard and listing detail

**Listing wizard (Session 09's `app/listings/new/page.tsx`):**
- Step 4 (Availability) now uses `<AvailabilityGrid mode="edit" />` 
- On save: call `PUT /api/v1/listings/{id}/availability`
- "Next" / "Publish" blocked until availability is saved (check `hasAvailability` on listing record)

**Host dashboard listing management:**
- "Edit availability" action on listing card → navigates to `/listings/{id}/availability`
- New page `app/listings/[id]/availability/page.tsx`:
  - Fetches current rules via `GET /api/v1/listings/{id}/availability`
  - Renders `<AvailabilityGrid mode="edit" rules={existingRules} />`
  - On save success: shows toast "Availability updated", navigates back to dashboard

**Listing detail page (Session 08's `app/listing/[id]/page.tsx`):**
- Replace the placeholder calendar with `<AvailabilityGrid mode="display" rules={listing.rules} blocks={listing.blocks} />`
- Fetch blocks via `GET /api/v1/listings/{id}/availability?from=today&to=+60days` (extend the GET endpoint to include block data when a date range is provided)
- When Spotter selects a date range → validate client-side with `isWithinAvailabilityRules` before enabling "Book this spot"

**Search screen (Session 07's `app/search/page.tsx`):**
- When no dates selected: result cards show "Available from [nextAvailableAt]" label
- When dates selected: result cards show "Available [dates]" green badge
- Listings with `nextAvailableAt=null` are filtered from results (handled by backend, but also filter client-side as safety net)
