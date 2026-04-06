# Session 23 — Spot Manager (Post-MVP)
## UC-SM01 · UC-SM02 · UC-SM03

> ⚠ **POST-MVP** — Do not start until the MVP is stable and validated with real users.
> Prerequisite sessions: 00–22 complete.

## What this session builds
The Spot Manager persona allows a user to manage a **portfolio of parking spots** as a unified pool. Instead of managing individual listings, a Spot Manager creates a named pool (e.g. "Résidence Bruxelles — 12 spots"), adds individual spots to it, sets pool-level pricing and availability, and assigns bookings across available spots automatically.

This is targeted at small property managers, syndics, and multi-spot owners — not individual hosts with one spot.

---

## Personas and glossary (post-MVP additions)
- **Spot Manager**: A Host with 2+ spots who opts into pool management. Has all Host capabilities plus pool management dashboard.
- **Spot Pool**: A named collection of individual listings managed as a unit. Spotters book the pool, not a specific spot.
- **Pool assignment**: The system automatically assigns an available spot within the pool to a confirmed booking.

---

## PART A — Backend: Pool data model

### A1 — DynamoDB schema additions

```
PK: POOL#{poolId}           SK: METADATA
  poolId, managerId (userId), name, description, address,
  spotType, evCharging, pricePerHour, pricePerDay,
  minDurationHours, maxDurationHours,
  status (ACTIVE | ARCHIVED), createdAt

PK: POOL#{poolId}           SK: SPOT#{listingId}
  listingId, addedAt, active (bool)

PK: POOL#{poolId}           SK: BOOKING#{bookingId}
  bookingId, assignedListingId, startTime, endTime, status

PK: USER#{userId}           SK: POOL#{poolId}   (GSI reverse lookup)
```

### A2 — pool-create Lambda (POST /api/v1/pools)

**Tests first: `__tests__/pools/create.test.ts`**
```typescript
test('creates pool with valid data', async () => {
  const result = await handler(mockAuthEvent('user-1', {
    body: {
      name: 'Résidence Bruxelles',
      address: 'Rue de la Loi 42, 1000 Bruxelles',
      spotType: 'COVERED_GARAGE',
      pricePerHour: 3.50,
      minDurationHours: 1,
    }
  }));
  expect(result.statusCode).toBe(201);
  const body = JSON.parse(result.body);
  expect(body.poolId).toBeDefined();
  expect(body.status).toBe('ACTIVE');
});

test('requires at least name and address', async () => {
  const result = await handler(mockAuthEvent('user-1', { body: { name: 'Test' } }));
  expect(result.statusCode).toBe(400);
  expect(JSON.parse(result.body).error).toBe('VALIDATION_ERROR');
});

test('user must have Host persona (stripeConnectEnabled=true)', async () => {
  const result = await handler(mockAuthEvent('guest-only-user', { body: validPool }));
  expect(result.statusCode).toBe(403);
  expect(JSON.parse(result.body).error).toBe('HOST_PERSONA_REQUIRED');
});
```

### A3 — pool-spot-add Lambda (POST /api/v1/pools/{poolId}/spots)

```typescript
test('adds an existing listing to a pool', async () => {
  const pool = await seedPool({ managerId: 'user-1' });
  const listing = await seedListing({ hostId: 'user-1', status: 'LIVE' });
  const result = await handler(mockAuthEvent('user-1', {
    pathParameters: { poolId: pool.poolId },
    body: { listingId: listing.listingId }
  }));
  expect(result.statusCode).toBe(200);
  const poolSpot = await getPoolSpot(pool.poolId, listing.listingId);
  expect(poolSpot).toBeDefined();
  expect(poolSpot.active).toBe(true);
});

test('cannot add listing owned by another user', async () => {
  const pool = await seedPool({ managerId: 'user-1' });
  const listing = await seedListing({ hostId: 'user-2' });
  const result = await handler(mockAuthEvent('user-1', {
    pathParameters: { poolId: pool.poolId },
    body: { listingId: listing.listingId }
  }));
  expect(result.statusCode).toBe(403);
});

test('cannot add same listing to pool twice', async () => {
  const { pool, listing } = await seedPoolWithSpot('user-1');
  const result = await handler(mockAuthEvent('user-1', {
    pathParameters: { poolId: pool.poolId },
    body: { listingId: listing.listingId }
  }));
  expect(result.statusCode).toBe(409);
  expect(JSON.parse(result.body).error).toBe('SPOT_ALREADY_IN_POOL');
});
```

### A4 — pool-booking-create Lambda (POST /api/v1/pools/{poolId}/bookings)

The key difference from regular booking: the Spotter books the **pool**, and the system assigns the first available spot.

```typescript
test('assigns first available spot in pool to booking', async () => {
  const pool = await seedPool({ managerId: 'user-1' });
  const spot1 = await addSpotToPool(pool.poolId, 'listing-1'); // available
  const spot2 = await addSpotToPool(pool.poolId, 'listing-2'); // available
  // Block spot1 for overlapping period
  await seedBooking({ listingId: 'listing-1', startTime: requestedStart, endTime: requestedEnd });

  const result = await handler(mockAuthEvent('spotter-1', {
    pathParameters: { poolId: pool.poolId },
    body: { startTime: requestedStart, endTime: requestedEnd }
  }));
  expect(result.statusCode).toBe(201);
  const body = JSON.parse(result.body);
  expect(body.assignedListingId).toBe('listing-2'); // spot1 was blocked
  expect(body.poolId).toBe(pool.poolId);
});

test('returns 409 POOL_FULLY_BOOKED when no spots available', async () => {
  const pool = await seedPoolWithAllSpotsBooked();
  const result = await handler(mockAuthEvent('spotter-1', {
    pathParameters: { poolId: pool.poolId },
    body: { startTime: '...', endTime: '...' }
  }));
  expect(result.statusCode).toBe(409);
  expect(JSON.parse(result.body).error).toBe('POOL_FULLY_BOOKED');
});

test('pool search shows available spots count correctly', async () => {
  // Pool with 3 spots, 1 booked → shows "2 of 3 available"
  const pool = await seedPoolWith3Spots();
  await bookOneSpot(pool.poolId);
  const result = await searchHandler(mockEvent({ queryStringParameters: { lat: '50.8', lng: '4.3' } }));
  const poolResult = JSON.parse(result.body).results.find(r => r.poolId === pool.poolId);
  expect(poolResult.availableSpots).toBe(2);
  expect(poolResult.totalSpots).toBe(3);
});
```

### A5 — pool-swap Lambda (POST /api/v1/pools/{poolId}/bookings/{bookingId}/swap)
**UC-SM02 — Swap a Pool Spot Assignment**

```typescript
test('swaps booking from one pool spot to another', async () => {
  const { pool, booking } = await seedPoolBooking({ assignedListingId: 'listing-1' });
  // listing-1 needs to be reclaimed, listing-2 is free
  const result = await handler(mockAuthEvent('manager-1', {
    pathParameters: { poolId: pool.poolId, bookingId: booking.bookingId },
    body: { newListingId: 'listing-2', reason: 'Maintenance on spot 1' }
  }));
  expect(result.statusCode).toBe(200);
  const updated = await getBooking(booking.bookingId);
  expect(updated.assignedListingId).toBe('listing-2');
});

test('notifies spotter of swap via SMS + in-app message', async () => {
  const { pool, booking } = await seedPoolBooking();
  await handler(mockAuthEvent('manager-1', {
    pathParameters: { poolId: pool.poolId, bookingId: booking.bookingId },
    body: { newListingId: 'listing-2', reason: 'Access issue' }
  }));
  expect(mockSNS.publish).toHaveBeenCalledWith(expect.objectContaining({
    Message: expect.stringContaining('listing-2'), // new spot info
  }));
});

test('cannot swap to spot not in pool', async () => {
  const { pool, booking } = await seedPoolBooking();
  const result = await handler(mockAuthEvent('manager-1', {
    pathParameters: { poolId: pool.poolId, bookingId: booking.bookingId },
    body: { newListingId: 'listing-outside-pool' }
  }));
  expect(result.statusCode).toBe(400);
  expect(JSON.parse(result.body).error).toBe('SPOT_NOT_IN_POOL');
});

test('cannot swap to spot that is already booked for the same period', async () => {
  const { pool, booking } = await seedPoolBooking({ assignedListingId: 'listing-1' });
  await seedBooking({ listingId: 'listing-2', startTime: booking.startTime, endTime: booking.endTime });
  const result = await handler(mockAuthEvent('manager-1', {
    pathParameters: { poolId: pool.poolId, bookingId: booking.bookingId },
    body: { newListingId: 'listing-2' }
  }));
  expect(result.statusCode).toBe(409);
  expect(JSON.parse(result.body).error).toBe('TARGET_SPOT_UNAVAILABLE');
});
```

### A6 — pool-dashboard Lambda (GET /api/v1/pools/{poolId}/dashboard)
**UC-SM03 — Manage Portfolio Dashboard**

```typescript
test('returns pool summary with occupancy metrics', async () => {
  const pool = await seedPoolWithBookings();
  const result = await handler(mockAuthEvent('manager-1', {
    pathParameters: { poolId: pool.poolId },
    queryStringParameters: { period: '30d' }
  }));
  const body = JSON.parse(result.body);
  expect(body.totalSpots).toBeDefined();
  expect(body.activeBookings).toBeDefined();
  expect(body.occupancyRate).toBeGreaterThanOrEqual(0);
  expect(body.occupancyRate).toBeLessThanOrEqual(1);
  expect(body.earningsTotal).toBeDefined();
  expect(body.upcomingBookings).toBeInstanceOf(Array);
  expect(body.spots).toBeInstanceOf(Array); // per-spot breakdown
});

test('occupancyRate = booked hours / (total spots × period hours)', async () => {
  const pool = await seedPool({ totalSpots: 2 });
  // 1 spot booked for 10h out of 24h period
  await seedBooking({ poolId: pool.poolId, durationHours: 10 });
  const result = await dashboardHandler(pool.poolId, '1d');
  const { occupancyRate } = JSON.parse(result.body);
  expect(occupancyRate).toBeCloseTo(10 / (2 * 24)); // 10 / 48 ≈ 0.208
});
```

---

## PART B — Search: pool-aware listing search

The search Lambda must return both individual listings AND pools, with pool results showing available spot count.

**Tests: add to `__tests__/listings/search.test.ts`**
```typescript
test('search results include active pools in the area', async () => {
  await seedPool({ address: 'Rue de la Loi 42', lat: 50.844, lng: 4.370, status: 'ACTIVE' });
  const result = await handler(mockEvent({
    queryStringParameters: { lat: '50.845', lng: '4.370', start: '...', end: '...' }
  }));
  const body = JSON.parse(result.body);
  const poolResult = body.results.find(r => r.type === 'POOL');
  expect(poolResult).toBeDefined();
  expect(poolResult.availableSpots).toBeDefined();
  expect(poolResult.totalSpots).toBeDefined();
});

test('pool card shows "X of Y spots available" when partially booked', async () => {
  const pool = await seedPoolWith3Spots();
  await bookOneSpot(pool.poolId); // 1 of 3 booked
  const result = await searchHandler({ lat: pool.lat, lng: pool.lng });
  const poolCard = JSON.parse(result.body).results.find(r => r.poolId === pool.poolId);
  expect(poolCard.availableSpots).toBe(2);
  expect(poolCard.totalSpots).toBe(3);
});

test('fully booked pool not returned in search results', async () => {
  const pool = await seedFullyBookedPool();
  const result = await searchHandler({ lat: pool.lat, lng: pool.lng, start: bookedPeriod.start, end: bookedPeriod.end });
  const poolCard = JSON.parse(result.body).results.find(r => r.poolId === pool.poolId);
  expect(poolCard).toBeUndefined();
});
```

---

## PART C — Frontend: Spot Manager dashboard

### C1 — Pool creation page (`app/pools/new/page.tsx`)

```typescript
test('pool creation form has required fields', () => {
  render(<NewPoolPage />);
  expect(screen.getByLabelText(/pool name/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/address/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/spot type/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/price per hour/i)).toBeInTheDocument();
});

test('cannot submit without name and address', async () => {
  render(<NewPoolPage />);
  fireEvent.click(screen.getByRole('button', { name: /create pool/i }));
  await waitFor(() => {
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('successful creation navigates to /pools/{poolId}', async () => {
  mockFetch({ poolId: 'pool-1', status: 'ACTIVE' });
  render(<NewPoolPage />);
  await fillAndSubmitPoolForm();
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/pools/pool-1'));
});
```

### C2 — Pool dashboard page (`app/pools/[poolId]/page.tsx`)

```typescript
test('shows occupancy rate, earnings, and spot breakdown', async () => {
  mockFetch({
    totalSpots: 3, activeBookings: 2,
    occupancyRate: 0.65, earningsTotal: 450.00,
    spots: [{ listingId: 'l1', address: 'Spot A', status: 'BOOKED' }, ...]
  });
  render(<PoolDashboardPage poolId="pool-1" />);
  await waitFor(() => {
    expect(screen.getByText('65%')).toBeInTheDocument(); // occupancy
    expect(screen.getByText('€450.00')).toBeInTheDocument(); // earnings
    expect(screen.getByText('2 / 3')).toBeInTheDocument(); // active bookings
  });
});

test('spot row shows swap button for active bookings', async () => {
  mockFetch({ spots: [{ listingId: 'l1', status: 'BOOKED', bookingId: 'b1' }] });
  render(<PoolDashboardPage poolId="pool-1" />);
  await waitFor(() => expect(screen.getByRole('button', { name: /swap/i })).toBeInTheDocument());
});
```

### C3 — Swap modal

```typescript
test('swap modal shows available spots in pool', async () => {
  mockFetch({ availableSpots: [{ listingId: 'l2', address: 'Spot B' }] });
  render(<SwapModal poolId="pool-1" bookingId="b1" currentListingId="l1" />);
  await waitFor(() => expect(screen.getByText('Spot B')).toBeInTheDocument());
});

test('confirms swap and shows success notification', async () => {
  render(<SwapModal poolId="pool-1" bookingId="b1" currentListingId="l1" />);
  await selectNewSpot('l2');
  fireEvent.click(screen.getByRole('button', { name: /confirm swap/i }));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/pools/pool-1/bookings/b1/swap'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});
```

### C4 — Search results — pool card

```typescript
test('pool search card shows "X of Y spots available"', () => {
  render(<PoolListingCard pool={{ ...mockPool, availableSpots: 2, totalSpots: 3 }} />);
  expect(screen.getByText('2 of 3 spots available')).toBeInTheDocument();
});

test('pool card "Book" navigates to /pools/{poolId}/book', () => {
  render(<PoolListingCard pool={mockPool} />);
  expect(screen.getByRole('link', { name: /book/i })).toHaveAttribute(
    'href', `/pools/${mockPool.poolId}/book`
  );
});
```

---

## PART D — CDK additions (in existing or new stack)

```typescript
// New API routes
const pools = api.root.getResource('api').getResource('v1').addResource('pools');
pools.addMethod('POST', new apigateway.LambdaIntegration(poolCreateLambda), { authorizer: cognitoAuthorizer });

const poolById = pools.addResource('{poolId}');
poolById.addMethod('GET', new apigateway.LambdaIntegration(poolGetLambda), { authorizer: cognitoAuthorizer });
poolById.addResource('spots').addMethod('POST', new apigateway.LambdaIntegration(poolSpotAddLambda), { authorizer: cognitoAuthorizer });
poolById.addResource('dashboard').addMethod('GET', new apigateway.LambdaIntegration(poolDashboardLambda), { authorizer: cognitoAuthorizer });

const poolBookings = poolById.addResource('bookings');
poolBookings.addMethod('POST', new apigateway.LambdaIntegration(poolBookingCreateLambda), { authorizer: cognitoAuthorizer });
poolBookings.addResource('{bookingId}').addResource('swap').addMethod('POST', new apigateway.LambdaIntegration(poolSwapLambda), { authorizer: cognitoAuthorizer });
```

---

## PART E — E2E

**`e2e/journeys/spot-manager.spec.ts`**
```typescript
test('Spot Manager: create pool, add spots, receive booking', async ({ page }) => {
  await loginAsSpotManager(page);

  // Create pool
  await page.goto('/pools/new');
  await page.fill('[name="name"]', 'Résidence Bruxelles');
  await page.fill('[name="address"]', 'Rue de la Loi 42');
  await page.click('[data-testid="spot-type-covered"]');
  await page.fill('[name="pricePerHour"]', '3.50');
  await page.click('[role="button"][name="Create pool"]');
  await expect(page).toHaveURL(/\/pools\/.+/);

  // Add an existing listing to pool
  await page.click('[data-testid="add-spot-btn"]');
  await page.click(`[data-listing-id="${TEST_LISTING_ID}"]`);
  await page.click('[data-testid="confirm-add-spot"]');
  await expect(page.getByText('1 spot in pool')).toBeVisible();
});

test('Spotter: books pool and is assigned an available spot', async ({ page }) => {
  await loginAsGuest(page);
  await page.goto('/search');
  const poolCard = page.locator('[data-type="POOL"]').first();
  await expect(poolCard.getByText(/\d of \d spots available/)).toBeVisible();
  await poolCard.getByRole('link', { name: /book/i }).click();
  await fillBookingDates(page);
  await proceedToPayment(page);
  // Confirmation shows assigned spot address
  await expect(page.getByTestId('assigned-spot-address')).toBeVisible();
});

test('Spot Manager: swaps spot assignment for active booking', async ({ page }) => {
  await loginAsSpotManager(page);
  await page.goto(`/pools/${TEST_POOL_ID}`);
  const bookingRow = page.locator('[data-booking-id]').first();
  await bookingRow.getByRole('button', { name: /swap/i }).click();
  await expect(page.getByRole('dialog', { name: /swap spot/i })).toBeVisible();
  await page.click('[data-testid="select-spot-l2"]');
  await page.click('[data-testid="confirm-swap"]');
  await expect(page.getByText(/spot swapped/i)).toBeVisible();
});

test('pool search result disappears when fully booked', async ({ page }) => {
  // Seed: fully booked pool for requested period
  await loginAsGuest(page);
  await page.goto('/search');
  await selectDates(page, FULLY_BOOKED_PERIOD);
  await expect(page.locator(`[data-pool-id="${FULL_POOL_ID}"]`)).not.toBeVisible();
});
```
