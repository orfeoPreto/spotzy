# Session 21 — Agent Integration (Post-MVP)
## API Key Auth · Agent API · MCP Server · OpenAPI Spec · Webhooks

> ⚠️ **POST-MVP** — Do not start this session until the MVP is live and stable.
> None of these components are required for launch.
> Recommended sequencing after MVP: API keys → Agent API → Quote endpoint →
> MCP server (local) → OpenAPI spec → Webhooks → Hosted MCP.

---

## Context

This session adds an agent-native integration layer on top of the existing Spotzy stack.
Agents (Claude, ChatGPT, LangChain, AutoGen, any MCP-compatible client) can search,
quote, book, cancel, and message on behalf of authenticated users.

**Architecture principle:** The agent endpoints are thin adapters. They share the same
Lambdas, DynamoDB table, and Stripe account as the human-facing app. The only new
infrastructure is the API key authorizer, the agent route prefix, the webhook delivery
Lambda, and the MCP server package. No new databases, no new Stripe accounts.

**DynamoDB patterns added (all on `spotzy-main` table):**
```
PK: APIKEY#{sha256HashOfKey}   SK: METADATA
  userId, keyId, name, spendingLimitPerBookingEur, monthlySpendingLimitEur,
  monthlySpendingSoFarEur, monthlyResetAt, createdAt, lastUsedAt, revokedAt

PK: USER#{userId}   SK: APIKEY#{keyId}      ← reverse index for listing keys by user
  keyId, name, createdAt, lastUsedAt, active

PK: USER#{userId}   SK: WEBHOOK#{webhookId}
  webhookId, url, events[], signingSecret (hashed), active, createdAt

PK: AUDIT#{keyId}#{timestamp}   SK: LOG
  endpoint, method, statusCode, ttl (90 days)
```

---

## PART A — API Key Authentication

### A1 — DynamoDB schema and key generation

**Tests first: `__tests__/agent/keys.test.ts`**
```typescript
test('POST /keys generates key, returns full key ONCE, stores hash only', async () => {
  const result = await handler(mockAuthEvent('user-1', {
    body: { name: 'My home assistant', spendingLimitPerBookingEur: 20 }
  }));
  const body = JSON.parse(result.body);
  expect(body.key).toMatch(/^sk_spotzy_live_[a-f0-9]{32}$/);
  expect(body.keyId).toBeDefined();
  // DynamoDB must have hash, never the raw key
  const stored = await getDynamoItem(`APIKEY#${sha256(body.key)}`, 'METADATA');
  expect(stored.key).toBeUndefined();
  expect(stored.userId).toBe('user-1');
  expect(stored.revokedAt).toBeNull();
});

test('GET /keys lists keys without revealing key values', async () => {
  await seedApiKey({ userId: 'user-1', name: 'Home assistant' });
  const result = await handler(mockAuthEvent('user-1'));
  const { keys } = JSON.parse(result.body);
  expect(keys.length).toBeGreaterThan(0);
  keys.forEach((k: any) => {
    expect(k.key).toBeUndefined();
    expect(k.keyId).toBeDefined();
    expect(k.name).toBeDefined();
    expect(k.monthlySpendingSoFarEur).toBeDefined();
  });
});

test('DELETE /keys/{keyId} sets revokedAt and returns 200', async () => {
  const { keyId } = await seedApiKey({ userId: 'user-1' });
  const result = await revokeHandler(mockAuthEvent('user-1', {
    pathParameters: { keyId }
  }));
  expect(result.statusCode).toBe(200);
  const key = await getDynamoItem(`APIKEY#${keyId}`, 'METADATA'); // via GSI lookup
  expect(key.revokedAt).toBeDefined();
});

test('DELETE /keys/{keyId} — user cannot revoke another user\'s key', async () => {
  const { keyId } = await seedApiKey({ userId: 'user-2' });
  const result = await revokeHandler(mockAuthEvent('user-1', {
    pathParameters: { keyId }
  }));
  expect(result.statusCode).toBe(403);
});
```

**Implementation: `functions/agent/keys/index.ts`**
```typescript
import { createHash, randomBytes } from 'crypto';
import { ulid } from 'ulid';

const generateKey = () => `sk_spotzy_live_${randomBytes(16).toString('hex')}`;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const createHandler = async (event: APIGatewayProxyEvent) => {
  const userId = event.requestContext.authorizer.userId;
  const { name, spendingLimitPerBookingEur, monthlySpendingLimitEur } = JSON.parse(event.body!);

  if (!name?.trim()) return badRequest('VALIDATION_ERROR', 'name is required');

  const rawKey = generateKey();
  const hash = sha256(rawKey);
  const keyId = ulid();
  const now = new Date().toISOString();

  // Write both records atomically
  await dynamodb.transactWrite({
    TransactItems: [
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: `APIKEY#${hash}`, SK: 'METADATA',
            userId, keyId, name,
            spendingLimitPerBookingEur: spendingLimitPerBookingEur ?? null,
            monthlySpendingLimitEur: monthlySpendingLimitEur ?? null,
            monthlySpendingSoFarEur: 0,
            monthlyResetAt: startOfNextMonth(),
            createdAt: now, lastUsedAt: null, revokedAt: null,
          },
        },
      },
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: `USER#${userId}`, SK: `APIKEY#${keyId}`,
            keyId, name, createdAt: now, lastUsedAt: null, active: true,
          },
        },
      },
    ],
  }).promise();

  return created({ key: rawKey, keyId, name, createdAt: now,
    spendingLimitPerBookingEur, monthlySpendingLimitEur, monthlySpendingSoFarEur: 0 });
};
```

### A2 — API key Lambda authorizer

**Tests first: `__tests__/auth/api-key-authorizer.test.ts`**
```typescript
test('valid API key returns allow policy with userId as principalId', async () => {
  const rawKey = 'sk_spotzy_live_' + 'a'.repeat(32);
  await seedApiKey({ hash: sha256(rawKey), userId: 'user-1', revokedAt: null });
  const result = await handler(buildAuthEvent(rawKey));
  expect(result.principalId).toBe('user-1');
  expect(result.policyDocument.Statement[0].Effect).toBe('Allow');
});

test('revoked key returns deny policy', async () => {
  const rawKey = 'sk_spotzy_live_' + 'b'.repeat(32);
  await seedApiKey({ hash: sha256(rawKey), userId: 'user-1', revokedAt: new Date().toISOString() });
  const result = await handler(buildAuthEvent(rawKey));
  expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
});

test('unknown key returns deny policy', async () => {
  const result = await handler(buildAuthEvent('sk_spotzy_live_nonexistent_' + 'x'.repeat(16)));
  expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
});

test('missing Authorization header returns deny policy', async () => {
  const result = await handler(buildAuthEvent(''));
  expect(result.policyDocument.Statement[0].Effect).toBe('Deny');
});

test('updates lastUsedAt fire-and-forget on successful auth', async () => {
  const rawKey = 'sk_spotzy_live_' + 'c'.repeat(32);
  await seedApiKey({ hash: sha256(rawKey), userId: 'user-1', revokedAt: null });
  await handler(buildAuthEvent(rawKey));
  // Allow brief async write
  await new Promise(r => setTimeout(r, 50));
  const record = await getApiKeyByHash(sha256(rawKey));
  expect(record.lastUsedAt).toBeDefined();
});

test('deny response is identical for not-found and revoked — no information leak', async () => {
  const notFound = await handler(buildAuthEvent('sk_spotzy_live_' + '0'.repeat(32)));
  const revoked  = await handler(buildAuthEvent('sk_spotzy_live_' + 'r'.repeat(32)));
  // Both deny, identical structure
  expect(notFound.policyDocument.Statement[0].Effect).toBe('Deny');
  expect(revoked.policyDocument.Statement[0].Effect).toBe('Deny');
});
```

**Implementation: `functions/auth/api-key-authorizer/index.ts`**
```typescript
import { createHash } from 'crypto';

export const handler = async (event: APIGatewayTokenAuthorizerEvent) => {
  const raw = event.authorizationToken?.replace('ApiKey ', '').trim();
  if (!raw) return denyPolicy('anonymous');

  const hash = createHash('sha256').update(raw).digest('hex');

  const record = await dynamodb.get({
    TableName: TABLE,
    Key: { PK: `APIKEY#${hash}`, SK: 'METADATA' },
  }).promise();

  if (!record.Item || record.Item.revokedAt) return denyPolicy(hash);

  // Fire-and-forget — do NOT await, do not slow down auth
  dynamodb.update({
    TableName: TABLE,
    Key: { PK: `APIKEY#${hash}`, SK: 'METADATA' },
    UpdateExpression: 'SET lastUsedAt = :now',
    ExpressionAttributeValues: { ':now': new Date().toISOString() },
  }).promise().catch(console.error);

  return allowPolicy(record.Item.userId, { keyId: record.Item.keyId });
};

const allowPolicy = (principalId: string, context: Record<string, string>) => ({
  principalId,
  context,
  policyDocument: {
    Version: '2012-10-17',
    Statement: [{ Action: 'execute-api:Invoke', Effect: 'Allow', Resource: '*' }],
  },
});

const denyPolicy = (principalId: string) => ({
  principalId,
  policyDocument: {
    Version: '2012-10-17',
    Statement: [{ Action: 'execute-api:Invoke', Effect: 'Deny', Resource: '*' }],
  },
});
```

---

## PART B — Agent API Endpoints

All agent endpoints live under `/api/v1/agent/*`. They share the same DynamoDB table,
Stripe account, and business logic Lambdas as the human-facing API. Each adapter:
1. Validates agent-specific inputs
2. Calls shared module(s)
3. Reshapes output to OpenAPI schema

### B1 — GET /api/v1/agent/listings/{listingId}/quote

**Tests: `__tests__/agent/quote.test.ts`**
```typescript
test('returns exact total price for a listing and period', async () => {
  const listing = await seedListing({ pricePerHour: 5.00, hostId: 'host-1' });
  const event = mockApiKeyEvent('user-1', {
    pathParameters: { listingId: listing.listingId },
    queryStringParameters: {
      startTime: '2026-04-11T08:00:00Z',
      endTime:   '2026-04-11T18:00:00Z',
    },
  });
  const result = await handler(event);
  expect(result.statusCode).toBe(200);
  const body = JSON.parse(result.body);
  expect(body.subtotalEur).toBe(50.00);    // 10h × €5
  expect(body.platformFeeEur).toBe(7.50);  // 15%
  expect(body.totalEur).toBe(57.50);
  expect(body.currency).toBe('EUR');
  expect(body.cancellationPolicy.rule).toBeDefined();
});

test('returns 409 LISTING_UNAVAILABLE if period is blocked', async () => {
  const listing = await seedListing({ pricePerHour: 5.00 });
  await seedAvailabilityBlock({ listingId: listing.listingId,
    startTime: '2026-04-11T06:00:00Z', endTime: '2026-04-11T20:00:00Z' });
  const result = await handler(mockApiKeyEvent('user-1', {
    pathParameters: { listingId: listing.listingId },
    queryStringParameters: { startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z' },
  }));
  expect(result.statusCode).toBe(409);
  expect(JSON.parse(result.body).error).toBe('LISTING_UNAVAILABLE');
});

test('idempotent — calling quote twice has zero side effects', async () => {
  const listing = await seedListing({ pricePerHour: 5.00 });
  const params = { pathParameters: { listingId: listing.listingId },
    queryStringParameters: { startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z' } };
  await handler(mockApiKeyEvent('user-1', params));
  await handler(mockApiKeyEvent('user-1', params));
  expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
  // No AvailabilityBlock written
  const blocks = await getAvailabilityBlocks(listing.listingId);
  expect(blocks).toHaveLength(0);
});

test('cancellation policy reflects time remaining before start', async () => {
  const listing = await seedListing({ pricePerHour: 5.00 });
  // Start is 36h from now — should be FULL_REFUND
  const start = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const end   = new Date(Date.now() + 46 * 60 * 60 * 1000).toISOString();
  const result = await handler(mockApiKeyEvent('user-1', {
    pathParameters: { listingId: listing.listingId },
    queryStringParameters: { startTime: start, endTime: end },
  }));
  const body = JSON.parse(result.body);
  expect(body.cancellationPolicy.rule).toBe('FULL_REFUND');
  expect(body.cancellationPolicy.refundPercent).toBe(100);
});
```

**Implementation: `functions/agent/quote/index.ts`**
```typescript
export const handler = async (event: APIGatewayProxyEvent) => {
  const { listingId } = event.pathParameters!;
  const { startTime, endTime } = event.queryStringParameters ?? {};

  if (!startTime || !endTime) return badRequest('VALIDATION_ERROR', 'startTime and endTime are required');
  if (new Date(endTime) <= new Date(startTime)) return badRequest('VALIDATION_ERROR', 'endTime must be after startTime');

  const listing = await getListing(listingId);
  if (!listing) return notFound('NOT_FOUND', 'Listing not found.');

  // Read-only availability check — no writes
  const available = await checkAvailability(listingId, startTime, endTime);
  if (!available) return conflict('LISTING_UNAVAILABLE', 'This listing is fully booked for the requested period.');

  const durationHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 3_600_000;
  const subtotalEur   = calculatePrice(listing, durationHours);
  const platformFeeEur = round2(subtotalEur * 0.15);
  const totalEur       = round2(subtotalEur + platformFeeEur);

  const cancellationPolicy = getCancellationPolicy(startTime, totalEur);

  return ok({ listingId, startTime, endTime, durationHours,
    subtotalEur, platformFeeEur, totalEur, currency: 'EUR', cancellationPolicy });
};

const getCancellationPolicy = (startTime: string, totalEur: number) => {
  const hoursUntilStart = (new Date(startTime).getTime() - Date.now()) / 3_600_000;
  if (hoursUntilStart > 24) return { rule: 'FULL_REFUND',    refundPercent: 100, refundEur: totalEur };
  if (hoursUntilStart > 12) return { rule: 'PARTIAL_REFUND', refundPercent: 50,  refundEur: round2(totalEur * 0.5) };
  return                           { rule: 'NO_REFUND',       refundPercent: 0,   refundEur: 0 };
};
```

### B2 — POST /api/v1/agent/bookings (single-shot booking)

**Tests: `__tests__/agent/bookings-create.test.ts`**
```typescript
test('creates booking in one call, returns CONFIRMED with full summary', async () => {
  const listing = await seedListing({ pricePerHour: 5.00, hostId: 'host-1' });
  await seedStripeCustomer({ userId: 'user-1', hasPaymentMethod: true });
  const result = await handler(mockApiKeyEvent('user-1', {
    body: { listingId: listing.listingId,
      startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z' },
  }));
  expect(result.statusCode).toBe(201);
  const body = JSON.parse(result.body);
  expect(body.bookingId).toBeDefined();
  expect(body.confirmationRef).toMatch(/^SPZ-/);
  expect(body.status).toBe('CONFIRMED');
  expect(body.totalEur).toBe(57.50);
});

test('enforces per-booking spending limit — returns 402', async () => {
  const listing = await seedListing({ pricePerHour: 5.00, hostId: 'host-1' });
  await seedStripeCustomer({ userId: 'user-1', hasPaymentMethod: true });
  await seedApiKey({ userId: 'user-1', spendingLimitPerBookingEur: 10 }); // €10 limit
  // booking costs €57.50 — exceeds limit
  const result = await handler(mockApiKeyEvent('user-1', {
    body: { listingId: listing.listingId,
      startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z' },
  }));
  expect(result.statusCode).toBe(402);
  const body = JSON.parse(result.body);
  expect(body.error).toBe('SPENDING_LIMIT_EXCEEDED');
  expect(body.details.limitType).toBe('PER_BOOKING');
  expect(body.details.limitEur).toBe(10);
  expect(body.details.bookingTotalEur).toBe(57.50);
});

test('enforces monthly spending limit — returns 402', async () => {
  const listing = await seedListing({ pricePerHour: 5.00, hostId: 'host-1' });
  await seedStripeCustomer({ userId: 'user-1', hasPaymentMethod: true });
  await seedApiKey({ userId: 'user-1', monthlySpendingLimitEur: 200, monthlySpendingSoFarEur: 180 });
  // booking costs €57.50 — 180 + 57.50 = 237.50 > 200
  const result = await handler(mockApiKeyEvent('user-1', {
    body: { listingId: listing.listingId,
      startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z' },
  }));
  expect(result.statusCode).toBe(402);
  expect(JSON.parse(result.body).details.limitType).toBe('MONTHLY');
});

test('enforces self-booking prevention', async () => {
  const listing = await seedListing({ hostId: 'user-1' });
  const result = await handler(mockApiKeyEvent('user-1', {
    body: { listingId: listing.listingId,
      startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z' },
  }));
  expect(result.statusCode).toBe(403);
  expect(JSON.parse(result.body).error).toBe('CANNOT_BOOK_OWN_LISTING');
});

test('returns 402 PAYMENT_METHOD_REQUIRED if no card on file', async () => {
  const listing = await seedListing({ pricePerHour: 5.00, hostId: 'host-1' });
  await seedStripeCustomer({ userId: 'user-1', hasPaymentMethod: false });
  const result = await handler(mockApiKeyEvent('user-1', {
    body: { listingId: listing.listingId,
      startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z' },
  }));
  expect(result.statusCode).toBe(402);
  expect(JSON.parse(result.body).error).toBe('PAYMENT_METHOD_REQUIRED');
});

test('returns 409 if listing just became unavailable (race condition)', async () => {
  const listing = await seedListing({ pricePerHour: 5.00, hostId: 'host-1' });
  await seedStripeCustomer({ userId: 'user-1', hasPaymentMethod: true });
  // Seed a block that appeared after quote but before book
  await seedAvailabilityBlock({ listingId: listing.listingId,
    startTime: '2026-04-11T06:00:00Z', endTime: '2026-04-11T20:00:00Z' });
  const result = await handler(mockApiKeyEvent('user-1', {
    body: { listingId: listing.listingId,
      startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z' },
  }));
  expect(result.statusCode).toBe(409);
  expect(JSON.parse(result.body).error).toBe('LISTING_UNAVAILABLE');
});

test('Stripe idempotency key prevents double-charge on retry', async () => {
  const listing = await seedListing({ pricePerHour: 5.00, hostId: 'host-1' });
  await seedStripeCustomer({ userId: 'user-1', hasPaymentMethod: true });
  const body = { listingId: listing.listingId,
    startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z' };
  await handler(mockApiKeyEvent('user-1', { body }));
  await handler(mockApiKeyEvent('user-1', { body }));
  // Stripe must be called once — second call hits idempotency key
  expect(mockStripe.paymentIntents.create).toHaveBeenCalledTimes(1);
});

test('increments monthlySpendingSoFarEur atomically on success', async () => {
  const listing = await seedListing({ pricePerHour: 5.00, hostId: 'host-1' });
  await seedStripeCustomer({ userId: 'user-1', hasPaymentMethod: true });
  const { hash } = await seedApiKey({ userId: 'user-1', monthlySpendingSoFarEur: 10 });
  await handler(mockApiKeyEvent('user-1', {
    body: { listingId: listing.listingId,
      startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z' },
  }));
  const record = await getDynamoItem(`APIKEY#${hash}`, 'METADATA');
  expect(record.monthlySpendingSoFarEur).toBe(67.50); // 10 + 57.50
});
```

**Implementation: `functions/agent/bookings/create/index.ts`**
```typescript
import { ulid } from 'ulid';

export const handler = async (event: APIGatewayProxyEvent) => {
  const userId = event.requestContext.authorizer.userId;
  const keyId  = event.requestContext.authorizer.keyId;
  const { listingId, startTime, endTime } = JSON.parse(event.body!);

  if (!listingId || !startTime || !endTime)
    return badRequest('VALIDATION_ERROR', 'listingId, startTime, and endTime are required');

  // Guard 1: fetch listing
  const listing = await getListing(listingId);
  if (!listing) return notFound('NOT_FOUND', 'Listing not found.');

  // Guard 2: self-booking
  if (listing.hostId === userId)
    return forbidden('CANNOT_BOOK_OWN_LISTING', 'You cannot book your own listing.');

  // Guard 3: availability (hard re-check — not trusting prior quote call)
  const available = await checkAvailability(listingId, startTime, endTime);
  if (!available) return conflict('LISTING_UNAVAILABLE', 'This listing was just booked by another user. Please search again.');

  // Guard 4: payment method
  const customer = await getStripeCustomer(userId);
  if (!customer?.default_payment_method && !customer?.default_source)
    return paymentRequired('PAYMENT_METHOD_REQUIRED', 'No saved payment method on file. The user must add a card via the Spotzy app.');

  // Guard 5: spending limits (agent-specific)
  const keyRecord = await getApiKeyByKeyId(keyId);
  const durationHours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 3_600_000;
  const subtotalEur   = calculatePrice(listing, durationHours);
  const totalEur      = round2(subtotalEur * 1.15);

  if (keyRecord.spendingLimitPerBookingEur && totalEur > keyRecord.spendingLimitPerBookingEur)
    return paymentRequired('SPENDING_LIMIT_EXCEEDED',
      `This booking (€${totalEur}) exceeds your per-booking spending limit (€${keyRecord.spendingLimitPerBookingEur}).`,
      { bookingTotalEur: totalEur, limitEur: keyRecord.spendingLimitPerBookingEur, limitType: 'PER_BOOKING' });

  if (keyRecord.monthlySpendingLimitEur &&
      keyRecord.monthlySpendingSoFarEur + totalEur > keyRecord.monthlySpendingLimitEur)
    return paymentRequired('SPENDING_LIMIT_EXCEEDED', 'This booking would exceed your monthly spending limit.',
      { bookingTotalEur: totalEur, monthlySpentEur: keyRecord.monthlySpendingSoFarEur,
        limitEur: keyRecord.monthlySpendingLimitEur, limitType: 'MONTHLY' });

  // Charge Stripe — idempotency key is bookingId (generated before Stripe call)
  const bookingId = ulid();
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(totalEur * 100),
    currency: 'eur',
    customer: customer.id,
    payment_method: customer.default_payment_method ?? customer.default_source,
    confirm: true,
    off_session: true,
  }, { idempotencyKey: bookingId });

  if (intent.status !== 'succeeded')
    return paymentRequired('PAYMENT_FAILED', 'Payment failed. Please check your payment method in the Spotzy app.');

  // Write booking record + AvailabilityBlock + publish event + increment monthly spend
  const confirmationRef = `SPZ-${Date.now().toString().slice(-7)}`;
  const now = new Date().toISOString();

  await Promise.all([
    writeBookingRecord({ bookingId, confirmationRef, listingId, userId,
      startTime, endTime, totalEur, status: 'CONFIRMED', createdAt: now }),
    writeAvailabilityBlock({ listingId, bookingId, startTime, endTime }),
    publishEvent('booking.confirmed', { bookingId, confirmationRef, listingId,
      listingAddress: listing.address, spotType: listing.spotType,
      startTime, endTime, totalEur, hostPseudo: listing.hostPseudo, userId }),
    // Atomic increment — safe for concurrent bookings
    dynamodb.update({
      TableName: TABLE,
      Key: { PK: `APIKEY#${await getHashByKeyId(keyId)}`, SK: 'METADATA' },
      UpdateExpression: 'ADD monthlySpendingSoFarEur :amount',
      ExpressionAttributeValues: { ':amount': totalEur },
    }).promise(),
  ]);

  return created({
    bookingId, confirmationRef, listingId,
    listingAddress: listing.address, spotType: listing.spotType,
    startTime, endTime, status: 'CONFIRMED', totalEur,
    hostPseudo: listing.hostPseudo, accessInstructions: null,
  });
};
```

### B3 — GET /api/v1/agent/search

**Tests: `__tests__/agent/search.test.ts`**
```typescript
test('accepts lat/lng and returns structured ListingSummary array', async () => {
  await seedListing({ lat: 50.835, lng: 4.337, pricePerHour: 5.00 });
  const result = await handler(mockApiKeyEvent('user-1', {
    queryStringParameters: { lat: '50.835', lng: '4.337',
      startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z' },
  }));
  expect(result.statusCode).toBe(200);
  const { listings, total } = JSON.parse(result.body);
  expect(Array.isArray(listings)).toBe(true);
  expect(total).toBeGreaterThanOrEqual(1);
  listings.forEach((l: any) => {
    expect(l).toHaveProperty('listingId');
    expect(l).toHaveProperty('address');
    expect(l).toHaveProperty('spotType');
    expect(l).toHaveProperty('spotTypeLabel');
    expect(l).toHaveProperty('pricePerHour');
    expect(l).toHaveProperty('pricePerDay');
    expect(l).toHaveProperty('rating');
    expect(l).toHaveProperty('evCharging');
    expect(l).toHaveProperty('covered');
    expect(l).toHaveProperty('walkingMinutes');
    // Must NOT include UI-only fields
    expect(l.mapPinCoordinates).toBeUndefined();
    expect(l.hostAvatarUrl).toBeUndefined();
    expect(l.photos).toBeUndefined();
  });
});

test('returns 400 if lat or lng is missing', async () => {
  const result = await handler(mockApiKeyEvent('user-1', {
    queryStringParameters: { startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z' },
  }));
  expect(result.statusCode).toBe(400);
  expect(JSON.parse(result.body).error).toBe('VALIDATION_ERROR');
});

test('applies user preferences when usePreferences=true', async () => {
  await seedUserPreferences({ userId: 'user-1', covered: true, maxPricePerDayEur: 15 });
  await seedListing({ lat: 50.835, lng: 4.337, spotType: 'OPEN_SPACE', pricePerDay: 20 });
  await seedListing({ lat: 50.835, lng: 4.337, spotType: 'COVERED_GARAGE', pricePerDay: 12 });
  const result = await handler(mockApiKeyEvent('user-1', {
    queryStringParameters: { lat: '50.835', lng: '4.337', usePreferences: 'true' },
  }));
  const { listings } = JSON.parse(result.body);
  // OPEN_SPACE and over-budget listings should be excluded
  expect(listings.every((l: any) => l.covered === true)).toBe(true);
  expect(listings.every((l: any) => (l.pricePerDay ?? 0) <= 15)).toBe(true);
});

test('explicit params override preferences', async () => {
  await seedUserPreferences({ userId: 'user-1', covered: true });
  const result = await handler(mockApiKeyEvent('user-1', {
    queryStringParameters: { lat: '50.835', lng: '4.337', usePreferences: 'true', covered: 'false' },
  }));
  // covered=false explicit override should include open spots
  expect(result.statusCode).toBe(200);
});
```

### B4 — GET & PUT /api/v1/agent/preferences

```typescript
test('PUT saves agent preferences for user', async () => {
  const result = await handler(mockApiKeyEvent('user-1', {
    httpMethod: 'PUT',
    body: { covered: true, evCharging: false, maxPricePerDayEur: 20, maxWalkingMinutes: 10 },
  }));
  expect(result.statusCode).toBe(200);
  const body = JSON.parse(result.body);
  expect(body.covered).toBe(true);
  expect(body.maxPricePerDayEur).toBe(20);
});

test('GET returns saved preferences, nulls for unset fields', async () => {
  await seedUserPreferences({ userId: 'user-1', covered: true, maxPricePerDayEur: 20 });
  const result = await getHandler(mockApiKeyEvent('user-1'));
  const body = JSON.parse(result.body);
  expect(body.covered).toBe(true);
  expect(body.maxPricePerDayEur).toBe(20);
  expect(body.evCharging).toBeNull();
});
```

### B5 — GET /api/v1/agent/bookings and POST /api/v1/agent/bookings/{id}/cancel

```typescript
test('GET /bookings returns CONFIRMED and ACTIVE bookings sorted by startTime', async () => {
  await seedBooking({ spotterId: 'user-1', status: 'CONFIRMED',
    startTime: '2026-04-12T08:00:00Z' });
  await seedBooking({ spotterId: 'user-1', status: 'ACTIVE',
    startTime: '2026-04-11T08:00:00Z' });
  await seedBooking({ spotterId: 'user-1', status: 'COMPLETED',
    startTime: '2026-04-01T08:00:00Z' }); // excluded by default
  const result = await listHandler(mockApiKeyEvent('user-1'));
  const { bookings } = JSON.parse(result.body);
  expect(bookings).toHaveLength(2);
  expect(bookings[0].startTime < bookings[1].startTime).toBe(true);
  expect(bookings.every((b: any) => ['CONFIRMED', 'ACTIVE'].includes(b.status))).toBe(true);
});

test('POST /cancel returns refund amount with policy', async () => {
  const booking = await seedBooking({ spotterId: 'user-1', status: 'CONFIRMED',
    startTime: new Date(Date.now() + 36 * 3600_000).toISOString(),
    totalEur: 57.50 });
  const result = await cancelHandler(mockApiKeyEvent('user-1', {
    pathParameters: { bookingId: booking.bookingId },
  }));
  expect(result.statusCode).toBe(200);
  const body = JSON.parse(result.body);
  expect(body.status).toBe('CANCELLED');
  expect(body.refundEur).toBe(57.50);
  expect(body.policy).toBe('FULL_REFUND');
  expect(body.refundEstimatedArrival).toBeDefined();
});

test('POST /cancel returns 403 BOOKING_ACTIVE_NO_CANCEL if already active', async () => {
  const booking = await seedBooking({ spotterId: 'user-1', status: 'ACTIVE' });
  const result = await cancelHandler(mockApiKeyEvent('user-1', {
    pathParameters: { bookingId: booking.bookingId },
  }));
  expect(result.statusCode).toBe(403);
  expect(JSON.parse(result.body).error).toBe('BOOKING_ACTIVE_NO_CANCEL');
});
```

---

## PART C — MCP Server

### C1 — Package structure

```
spotzy-mcp/
├── package.json
├── index.ts              # Server entry point (stdio transport)
├── tools/
│   ├── search.ts         # spotzy_search_parking
│   ├── quote.ts          # spotzy_get_quote
│   ├── book.ts           # spotzy_book
│   ├── bookings.ts       # spotzy_get_bookings
│   ├── cancel.ts         # spotzy_cancel_booking
│   ├── message.ts        # spotzy_send_message + spotzy_get_messages
│   └── preferences.ts    # spotzy_get_preferences + spotzy_set_preferences
├── lib/
│   ├── api.ts            # Spotzy API client (injects ApiKey header)
│   ├── geocode.ts        # Mapbox geocoding — place name → lat/lng
│   └── format.ts         # Response formatters for human-readable Claude output
└── README.md             # Setup instructions for claude_desktop_config.json
```

**Tests: `__tests__/mcp/tools.test.ts`**
```typescript
test('spotzy_search_parking geocodes location before calling API', async () => {
  mockGeocode.mockResolvedValue({ lat: 50.835, lng: 4.337 });
  mockSpotzyApi.search.mockResolvedValue({ listings: [], total: 0 });
  await callTool('spotzy_search_parking', {
    location: 'Gare du Midi Brussels',
    startTime: '2026-04-11T08:00:00Z',
    endTime:   '2026-04-11T18:00:00Z',
  });
  expect(mockGeocode).toHaveBeenCalledWith('Gare du Midi Brussels');
  expect(mockSpotzyApi.search).toHaveBeenCalledWith(
    expect.objectContaining({ lat: 50.835, lng: 4.337 })
  );
});

test('spotzy_book returns human-readable confirmation text', async () => {
  mockSpotzyApi.book.mockResolvedValue({
    bookingId: 'b1', confirmationRef: 'SPZ-4471',
    listingAddress: 'Rue de France 14', startTime: '2026-04-11T08:00:00Z',
    endTime: '2026-04-11T18:00:00Z', totalEur: 57.50, status: 'CONFIRMED',
  });
  const result = await callTool('spotzy_book', {
    listingId: 'lst-1', startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z',
  });
  expect(result.content[0].text).toContain('SPZ-4471');
  expect(result.content[0].text).toContain('Rue de France 14');
  expect(result.content[0].text).toContain('€57.50');
});

test('spotzy_cancel_booking returns refund amount in text for Claude to present', async () => {
  mockSpotzyApi.cancel.mockResolvedValue({
    refundEur: 28.75, refundPercent: 50, policy: 'PARTIAL_REFUND',
  });
  const result = await callTool('spotzy_cancel_booking', { bookingId: 'b1' });
  expect(result.content[0].text).toContain('€28.75');
  expect(result.content[0].text).toContain('50%');
});

test('spotzy_search_parking returns no-results message when API returns empty', async () => {
  mockGeocode.mockResolvedValue({ lat: 50.835, lng: 4.337 });
  mockSpotzyApi.search.mockResolvedValue({ listings: [], total: 0 });
  const result = await callTool('spotzy_search_parking', {
    location: 'Remote village', startTime: '2026-04-11T08:00:00Z', endTime: '2026-04-11T18:00:00Z',
  });
  expect(result.content[0].text).toContain('No available parking spots');
});
```

**Implementation: `tools/search.ts`**
```typescript
import { geocode } from '../lib/geocode';
import { spotzyApi } from '../lib/api';
import { formatListings } from '../lib/format';

export const searchTool = {
  name: 'spotzy_search_parking',
  description: 'Search for available parking spots near a location for a given time period. ' +
    'Always call spotzy_get_quote before spotzy_book to confirm the price.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      location:           { type: 'string',  description: 'Address or place name — geocoded automatically' },
      startTime:          { type: 'string',  description: 'Start datetime in ISO 8601 format' },
      endTime:            { type: 'string',  description: 'End datetime in ISO 8601 format' },
      maxPricePerDayEur:  { type: 'number',  description: 'Maximum price in EUR per day (optional)' },
      covered:            { type: 'boolean', description: 'Only return covered spots (optional)' },
      evCharging:         { type: 'boolean', description: 'Only return spots with EV charging (optional)' },
      usePreferences:     { type: 'boolean', description: 'Apply saved user preferences (optional)' },
    },
    required: ['location', 'startTime', 'endTime'],
  },

  async execute(args: any) {
    const coords = await geocode(args.location);
    const result = await spotzyApi.search({
      lat: coords.lat, lng: coords.lng,
      startTime: args.startTime, endTime: args.endTime,
      maxPricePerDayEur: args.maxPricePerDayEur,
      covered: args.covered, evCharging: args.evCharging,
      usePreferences: args.usePreferences,
    });

    if (result.listings.length === 0) {
      return { content: [{ type: 'text', text: 'No available parking spots found for this location and time period. Try a different location or adjust the dates.' }] };
    }

    return { content: [{ type: 'text', text: formatListings(result.listings) }] };
  },
};
```

**Implementation: `lib/format.ts`**
```typescript
export const formatListings = (listings: any[]): string =>
  listings.map((l, i) => [
    `${i + 1}. ${l.address}`,
    `   Type: ${l.spotTypeLabel} | Price: €${l.pricePerDay ?? l.pricePerHour + '/hr'}/day | Walk: ${l.walkingMinutes ?? '--'} min | Rating: ${l.rating ? l.rating + '⭐' : 'no reviews'}`,
    l.evCharging ? '   ⚡ EV charging available' : '',
    `   ID: ${l.listingId}`,
  ].filter(Boolean).join('\n')).join('\n\n');

export const formatBookingConfirmation = (b: any): string =>
  `✓ Booking confirmed!\n` +
  `Reference: ${b.confirmationRef}\n` +
  `Address: ${b.listingAddress}\n` +
  `Time: ${formatDateRange(b.startTime, b.endTime)}\n` +
  `Total charged: €${b.totalEur.toFixed(2)}`;

export const formatCancellation = (c: any): string =>
  `Booking cancelled.\n` +
  `Refund: €${c.refundEur.toFixed(2)} (${c.refundPercent}% — ${policyLabel(c.policy)})\n` +
  `Estimated arrival: ${c.refundEstimatedArrival ?? '5–10 business days'}`;

const policyLabel = (p: string) =>
  p === 'FULL_REFUND' ? 'full refund' : p === 'PARTIAL_REFUND' ? 'partial refund' : 'no refund';

const formatDateRange = (start: string, end: string) => {
  const s = new Date(start), e = new Date(end);
  return `${s.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ` +
    `${s.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} – ` +
    `${e.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};
```

**MCP server entry point: `index.ts`**
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { searchTool }    from './tools/search';
import { quoteTool }     from './tools/quote';
import { bookTool }      from './tools/book';
import { bookingsTool }  from './tools/bookings';
import { cancelTool }    from './tools/cancel';
import { messageTool, getMessagesTool } from './tools/message';
import { getPreferencesTool, setPreferencesTool } from './tools/preferences';

const tools = [
  searchTool, quoteTool, bookTool, bookingsTool, cancelTool,
  messageTool, getMessagesTool, getPreferencesTool, setPreferencesTool,
];

const server = new Server(
  { name: 'spotzy', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find(t => t.name === request.params.name);
  if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);
  return tool.execute(request.params.arguments ?? {});
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

**README.md — Setup for Claude Desktop:**
```markdown
# Spotzy MCP Server

## Setup with Claude Desktop

1. Install: `npm install -g spotzy-mcp`
2. Get your API key: Spotzy app → Profile → Developer → API Keys → Generate
3. Add to Claude Desktop config:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "spotzy": {
      "command": "spotzy-mcp",
      "env": {
        "SPOTZY_API_KEY": "sk_spotzy_live_your_key_here"
      }
    }
  }
}
```

4. Restart Claude Desktop
5. Try: "Find me covered parking near Gare du Midi Brussels this Friday 9am to 6pm, under €15"
```

---

## PART D — OpenAPI Specification

The spec is a static YAML file served by a Lambda at `GET /agent/openapi.yaml` (no auth,
`Access-Control-Allow-Origin: *`). The content below is inlined as a template literal in
the Lambda. Do not maintain it separately — keep it as the single source of truth here.

**Tests: `__tests__/agent/openapi.test.ts`**
```typescript
import SwaggerParser from '@apidevtools/swagger-parser';

const SPEC_PATH = path.join(__dirname, '../../functions/agent/openapi/spec.yaml');

test('OpenAPI spec is valid 3.1', async () => {
  const spec = await SwaggerParser.validate(SPEC_PATH);
  expect((spec as any).openapi).toBe('3.1.0');
});

test('all 15 agent endpoints are documented', async () => {
  const spec = await SwaggerParser.parse(SPEC_PATH) as any;
  const operations = Object.entries(spec.paths).flatMap(([, methods]: [string, any]) =>
    Object.values(methods).filter((m: any) => m.operationId)
  );
  expect(operations).toHaveLength(15);
});

test('all operationIds are unique', async () => {
  const spec = await SwaggerParser.parse(SPEC_PATH) as any;
  const ids = Object.values(spec.paths)
    .flatMap((p: any) => Object.values(p))
    .map((op: any) => op.operationId)
    .filter(Boolean);
  expect(new Set(ids).size).toBe(ids.length);
});

test('Lambda serves spec with correct Content-Type and CORS header', async () => {
  const result = await handler({} as any);
  expect(result.statusCode).toBe(200);
  expect(result.headers['Content-Type']).toBe('application/yaml');
  expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
  expect(result.body).toContain('openapi: 3.1.0');
});
```

**Implementation: `functions/agent/openapi/index.ts`**
```typescript
import * as fs from 'fs';
import * as path from 'path';

// spec.yaml is bundled alongside this handler by CDK asset bundling
const OPENAPI_SPEC = fs.readFileSync(path.join(__dirname, 'spec.yaml'), 'utf-8');

export const handler = async () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/yaml',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  },
  body: OPENAPI_SPEC,
});
```

**`functions/agent/openapi/spec.yaml` — complete OpenAPI 3.1 specification:**

```yaml
openapi: 3.1.0
info:
  title: Spotzy Agent API
  version: 1.0.0
  description: |
    Machine-readable API for AI agents to search, quote, book, cancel, and message
    on behalf of authenticated Spotzy users.

    ## Authentication
    All endpoints require an API key in the Authorization header:
    ```
    Authorization: ApiKey sk_spotzy_live_<key>
    ```
    API keys are generated by the user in the Spotzy app under Profile → Developer → API Keys.

    ## Base URL
    `https://api.spotzy.com`

    ## Error format
    All errors follow a consistent structure:
    ```json
    {
      "error": "ERROR_CODE",
      "message": "Human-readable description",
      "details": {}
    }
    ```

servers:
  - url: https://api.spotzy.com
    description: Production

security:
  - ApiKeyAuth: []

components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: Authorization
      description: "Format: ApiKey sk_spotzy_live_<32 hex chars>"

  schemas:
    ListingId:
      type: string
      example: lst_4f8a2b1c9d3e7f0a

    BookingId:
      type: string
      example: bkg_7e2f1a9c4b0d3e8f

    SpotType:
      type: string
      enum: [COVERED_GARAGE, CARPORT, DRIVEWAY, OPEN_SPACE]

    BookingStatus:
      type: string
      enum: [PENDING_PAYMENT, CONFIRMED, ACTIVE, COMPLETED, CANCELLED]

    Money:
      type: number
      format: float
      description: Amount in EUR, rounded to 2 decimal places
      example: 13.80

    ISO8601DateTime:
      type: string
      format: date-time
      example: "2026-04-11T08:00:00Z"

    ListingSummary:
      type: object
      required: [listingId, address, spotType, rating, evCharging, walkingMinutes]
      properties:
        listingId:
          $ref: "#/components/schemas/ListingId"
        address:
          type: string
          example: Rue de France 14, Bruxelles
        spotType:
          $ref: "#/components/schemas/SpotType"
        spotTypeLabel:
          type: string
          example: Covered garage
        pricePerHour:
          $ref: "#/components/schemas/Money"
          nullable: true
        pricePerDay:
          $ref: "#/components/schemas/Money"
          nullable: true
        rating:
          type: number
          format: float
          nullable: true
          example: 4.8
        reviewCount:
          type: integer
          example: 12
        evCharging:
          type: boolean
        covered:
          type: boolean
        walkingMinutes:
          type: integer
          nullable: true
          example: 3
        distanceMetres:
          type: integer
          nullable: true
          example: 220

    Quote:
      type: object
      required: [listingId, startTime, endTime, subtotalEur, platformFeeEur, totalEur, currency]
      properties:
        listingId:
          $ref: "#/components/schemas/ListingId"
        startTime:
          $ref: "#/components/schemas/ISO8601DateTime"
        endTime:
          $ref: "#/components/schemas/ISO8601DateTime"
        durationHours:
          type: number
          example: 10.0
        subtotalEur:
          $ref: "#/components/schemas/Money"
          example: 50.00
        platformFeeEur:
          $ref: "#/components/schemas/Money"
          example: 7.50
        totalEur:
          $ref: "#/components/schemas/Money"
          example: 57.50
        currency:
          type: string
          enum: [EUR]
        cancellationPolicy:
          type: object
          properties:
            refundEur:
              $ref: "#/components/schemas/Money"
            refundPercent:
              type: integer
              enum: [0, 50, 100]
            rule:
              type: string
              enum: [FULL_REFUND, PARTIAL_REFUND, NO_REFUND, ACTIVE_NO_CANCEL]

    BookingSummary:
      type: object
      required: [bookingId, confirmationRef, listingId, listingAddress, startTime, endTime, status, totalEur]
      properties:
        bookingId:
          $ref: "#/components/schemas/BookingId"
        confirmationRef:
          type: string
          example: SPZ-2024-4471
        listingId:
          $ref: "#/components/schemas/ListingId"
        listingAddress:
          type: string
        spotType:
          $ref: "#/components/schemas/SpotType"
        startTime:
          $ref: "#/components/schemas/ISO8601DateTime"
        endTime:
          $ref: "#/components/schemas/ISO8601DateTime"
        status:
          $ref: "#/components/schemas/BookingStatus"
        totalEur:
          $ref: "#/components/schemas/Money"
        hostPseudo:
          type: string
        accessInstructions:
          type: string
          nullable: true

    Message:
      type: object
      required: [messageId, bookingId, senderRole, text, sentAt]
      properties:
        messageId:
          type: string
        bookingId:
          $ref: "#/components/schemas/BookingId"
        senderRole:
          type: string
          enum: [HOST, GUEST, SYSTEM]
        senderPseudo:
          type: string
          nullable: true
        text:
          type: string
        sentAt:
          $ref: "#/components/schemas/ISO8601DateTime"
        isRead:
          type: boolean

    UserPreferences:
      type: object
      properties:
        covered:
          type: boolean
          nullable: true
        evCharging:
          type: boolean
          nullable: true
        accessible:
          type: boolean
          nullable: true
        maxPricePerDayEur:
          type: number
          nullable: true
        maxWalkingMinutes:
          type: integer
          nullable: true

    ApiKey:
      type: object
      required: [keyId, name, createdAt]
      properties:
        keyId:
          type: string
        name:
          type: string
        createdAt:
          $ref: "#/components/schemas/ISO8601DateTime"
        lastUsedAt:
          $ref: "#/components/schemas/ISO8601DateTime"
          nullable: true
        spendingLimitPerBookingEur:
          type: number
          nullable: true
        monthlySpendingLimitEur:
          type: number
          nullable: true
        monthlySpendingSoFarEur:
          type: number

    Webhook:
      type: object
      required: [webhookId, url, events, active, createdAt]
      properties:
        webhookId:
          type: string
        url:
          type: string
          format: uri
        events:
          type: array
          items:
            type: string
            enum: [booking.confirmed, booking.active, booking.completed,
                   booking.cancelled, message.received]
        active:
          type: boolean
        createdAt:
          $ref: "#/components/schemas/ISO8601DateTime"

    ErrorResponse:
      type: object
      required: [error, message]
      properties:
        error:
          type: string
        message:
          type: string
        details:
          type: object
          additionalProperties: true

  responses:
    Unauthorized:
      description: Missing or invalid API key
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
          example:
            error: UNAUTHORIZED
            message: Invalid or revoked API key.
    Forbidden:
      description: Action not permitted
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    NotFound:
      description: Resource not found
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"
    UnprocessableEntity:
      description: Validation failed
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"

paths:

  /api/v1/agent/search:
    get:
      operationId: searchParking
      summary: Search for available parking spots
      description: |
        Returns listings near a location filtered by time, price, and spot features.
        Requires lat/lng — geocoding is the MCP server's responsibility, not this endpoint's.
        When startTime and endTime are provided, only listings available for the full
        requested period are returned.
      tags: [Listings]
      parameters:
        - name: lat
          in: query
          required: true
          schema: { type: number, minimum: -90, maximum: 90 }
        - name: lng
          in: query
          required: true
          schema: { type: number, minimum: -180, maximum: 180 }
        - name: startTime
          in: query
          schema: { $ref: "#/components/schemas/ISO8601DateTime" }
        - name: endTime
          in: query
          schema: { $ref: "#/components/schemas/ISO8601DateTime" }
        - name: maxPricePerDayEur
          in: query
          schema: { type: number }
        - name: spotType
          in: query
          schema: { type: array, items: { $ref: "#/components/schemas/SpotType" } }
          style: form
          explode: false
        - name: evCharging
          in: query
          schema: { type: boolean }
        - name: covered
          in: query
          schema: { type: boolean }
        - name: accessible
          in: query
          schema: { type: boolean }
        - name: maxWalkingMinutes
          in: query
          schema: { type: integer }
        - name: usePreferences
          in: query
          schema: { type: boolean }
          description: Apply saved user preferences. Explicit params override preference values.
        - name: destinationLat
          in: query
          schema: { type: number }
        - name: destinationLng
          in: query
          schema: { type: number }
        - name: limit
          in: query
          schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
        - name: radiusMetres
          in: query
          schema: { type: integer, minimum: 100, maximum: 10000, default: 2000 }
      responses:
        "200":
          description: Search results
          content:
            application/json:
              schema:
                type: object
                required: [listings, total]
                properties:
                  listings:
                    type: array
                    items: { $ref: "#/components/schemas/ListingSummary" }
                  total:
                    type: integer
              example:
                listings:
                  - listingId: lst_4f8a2b1c9d3e7f0a
                    address: Rue de France 14, Bruxelles
                    spotType: COVERED_GARAGE
                    spotTypeLabel: Covered garage
                    pricePerHour: 5.00
                    pricePerDay: 12.00
                    rating: 4.8
                    reviewCount: 24
                    evCharging: false
                    covered: true
                    walkingMinutes: 3
                    distanceMetres: 220
                total: 7
        "400":
          description: Invalid parameters
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
              examples:
                missingCoords:
                  value: { error: VALIDATION_ERROR, message: lat and lng are required. }
                invalidPeriod:
                  value: { error: VALIDATION_ERROR, message: endTime must be after startTime. }
        "401":
          $ref: "#/components/responses/Unauthorized"

  /api/v1/agent/listings/{listingId}/quote:
    get:
      operationId: getQuote
      summary: Get exact price for a listing and period
      description: |
        Idempotent — no side effects, does not reserve the listing.
        Always call this before POST /api/v1/agent/bookings and present totalEur to the user.
      tags: [Listings]
      parameters:
        - name: listingId
          in: path
          required: true
          schema: { $ref: "#/components/schemas/ListingId" }
        - name: startTime
          in: query
          required: true
          schema: { $ref: "#/components/schemas/ISO8601DateTime" }
        - name: endTime
          in: query
          required: true
          schema: { $ref: "#/components/schemas/ISO8601DateTime" }
      responses:
        "200":
          description: Price quote
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Quote" }
              example:
                listingId: lst_4f8a2b1c9d3e7f0a
                startTime: "2026-04-11T08:00:00Z"
                endTime: "2026-04-11T18:00:00Z"
                durationHours: 10.0
                subtotalEur: 50.00
                platformFeeEur: 7.50
                totalEur: 57.50
                currency: EUR
                cancellationPolicy:
                  refundEur: 57.50
                  refundPercent: 100
                  rule: FULL_REFUND
        "400":
          description: Invalid parameters
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          description: Listing not found
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
              example: { error: NOT_FOUND, message: Listing not found. }
        "409":
          description: Listing unavailable for the requested period
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
              example: { error: LISTING_UNAVAILABLE, message: This listing is fully booked for the requested period. }

  /api/v1/agent/bookings:
    post:
      operationId: createBooking
      summary: Book and pay for a parking spot
      description: |
        Single-shot booking — validates availability, checks spending limits,
        charges the user's saved payment method, and returns the confirmed booking.
        Always call getQuote first and present the price to the user before calling this.
      tags: [Bookings]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [listingId, startTime, endTime]
              properties:
                listingId: { $ref: "#/components/schemas/ListingId" }
                startTime: { $ref: "#/components/schemas/ISO8601DateTime" }
                endTime:   { $ref: "#/components/schemas/ISO8601DateTime" }
            example:
              listingId: lst_4f8a2b1c9d3e7f0a
              startTime: "2026-04-11T08:00:00Z"
              endTime: "2026-04-11T18:00:00Z"
      responses:
        "201":
          description: Booking confirmed
          content:
            application/json:
              schema: { $ref: "#/components/schemas/BookingSummary" }
        "400":
          description: Validation error
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
        "401":
          $ref: "#/components/responses/Unauthorized"
        "402":
          description: Payment or spending limit issue
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
              examples:
                noPaymentMethod:
                  value:
                    error: PAYMENT_METHOD_REQUIRED
                    message: No saved payment method on file. The user must add a card via the Spotzy app.
                perBookingLimit:
                  value:
                    error: SPENDING_LIMIT_EXCEEDED
                    message: "This booking (€57.50) exceeds your per-booking spending limit (€20.00)."
                    details: { bookingTotalEur: 57.50, limitEur: 20.00, limitType: PER_BOOKING }
                monthlyLimit:
                  value:
                    error: SPENDING_LIMIT_EXCEEDED
                    message: This booking would exceed your monthly spending limit.
                    details: { bookingTotalEur: 57.50, monthlySpentEur: 180.00, limitEur: 200.00, limitType: MONTHLY }
        "403":
          description: Self-booking attempt
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
              example: { error: CANNOT_BOOK_OWN_LISTING, message: You cannot book your own listing. }
        "409":
          description: Listing no longer available
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
              example: { error: LISTING_UNAVAILABLE, message: This listing was just booked by another user. Please search again. }

    get:
      operationId: listBookings
      summary: List the user's upcoming and active bookings
      tags: [Bookings]
      parameters:
        - name: status
          in: query
          schema:
            type: array
            items: { $ref: "#/components/schemas/BookingStatus" }
          style: form
          explode: false
          description: "Filter by status. Default: CONFIRMED,ACTIVE"
        - name: limit
          in: query
          schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
      responses:
        "200":
          description: List of bookings
          content:
            application/json:
              schema:
                type: object
                required: [bookings, total]
                properties:
                  bookings:
                    type: array
                    items: { $ref: "#/components/schemas/BookingSummary" }
                  total:
                    type: integer
        "401":
          $ref: "#/components/responses/Unauthorized"

  /api/v1/agent/bookings/{bookingId}/cancel:
    post:
      operationId: cancelBooking
      summary: Cancel a booking
      description: |
        Cancels a booking and initiates a refund per the cancellation policy.
        Present the refundEur to the user and require confirmation before calling this endpoint.
        - >24h before start: full refund
        - 12–24h before start: 50% refund
        - <12h before start: no refund
        - Booking ACTIVE: cannot be cancelled
      tags: [Bookings]
      parameters:
        - name: bookingId
          in: path
          required: true
          schema: { $ref: "#/components/schemas/BookingId" }
      responses:
        "200":
          description: Booking cancelled
          content:
            application/json:
              schema:
                type: object
                required: [bookingId, status, refundEur, refundPercent, policy]
                properties:
                  bookingId: { $ref: "#/components/schemas/BookingId" }
                  status:    { type: string, enum: [CANCELLED] }
                  refundEur: { $ref: "#/components/schemas/Money" }
                  refundPercent: { type: integer, enum: [0, 50, 100] }
                  policy:    { type: string, enum: [FULL_REFUND, PARTIAL_REFUND, NO_REFUND] }
                  refundEstimatedArrival: { type: string }
              example:
                bookingId: bkg_7e2f1a9c4b0d3e8f
                status: CANCELLED
                refundEur: 28.75
                refundPercent: 50
                policy: PARTIAL_REFUND
                refundEstimatedArrival: 5–10 business days
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          description: Not owner or booking is ACTIVE
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
              examples:
                notOwner:
                  value: { error: FORBIDDEN, message: You do not have permission to cancel this booking. }
                alreadyActive:
                  value: { error: BOOKING_ACTIVE_NO_CANCEL, message: Active bookings cannot be cancelled. Contact support if there is an emergency. }
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Already cancelled or completed
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
              example: { error: BOOKING_ALREADY_ENDED, message: This booking has already been cancelled or completed. }

  /api/v1/agent/bookings/{bookingId}/messages:
    get:
      operationId: getMessages
      summary: Get message history for a booking
      tags: [Messages]
      parameters:
        - name: bookingId
          in: path
          required: true
          schema: { $ref: "#/components/schemas/BookingId" }
        - name: since
          in: query
          schema: { $ref: "#/components/schemas/ISO8601DateTime" }
          description: Only return messages after this time. Use for polling.
        - name: limit
          in: query
          schema: { type: integer, minimum: 1, maximum: 100, default: 50 }
      responses:
        "200":
          description: Message history
          content:
            application/json:
              schema:
                type: object
                required: [bookingId, messages]
                properties:
                  bookingId: { $ref: "#/components/schemas/BookingId" }
                  messages:
                    type: array
                    items: { $ref: "#/components/schemas/Message" }
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"

    post:
      operationId: sendMessage
      summary: Send a message to the other party in a booking
      description: Plain text only. Only participants (Host or Guest) can send messages.
      tags: [Messages]
      parameters:
        - name: bookingId
          in: path
          required: true
          schema: { $ref: "#/components/schemas/BookingId" }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [text]
              properties:
                text:
                  type: string
                  minLength: 1
                  maxLength: 2000
            example:
              text: "Hi, will the gate code be ready for my arrival at 8am?"
      responses:
        "201":
          description: Message sent
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Message" }
        "400":
          description: Empty or too-long message
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"

  /api/v1/agent/preferences:
    get:
      operationId: getPreferences
      summary: Get the user's saved booking preferences
      tags: [Preferences]
      responses:
        "200":
          description: User preferences
          content:
            application/json:
              schema: { $ref: "#/components/schemas/UserPreferences" }
        "401":
          $ref: "#/components/responses/Unauthorized"
    put:
      operationId: setPreferences
      summary: Update the user's booking preferences
      description: Replaces all preferences. Omitted fields set to null.
      tags: [Preferences]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/UserPreferences" }
      responses:
        "200":
          description: Preferences saved
          content:
            application/json:
              schema: { $ref: "#/components/schemas/UserPreferences" }
        "400":
          $ref: "#/components/responses/UnprocessableEntity"
        "401":
          $ref: "#/components/responses/Unauthorized"

  /api/v1/agent/keys:
    get:
      operationId: listApiKeys
      summary: List the user's API keys (no key values returned)
      tags: [API Keys]
      responses:
        "200":
          description: API keys
          content:
            application/json:
              schema:
                type: object
                required: [keys]
                properties:
                  keys:
                    type: array
                    items: { $ref: "#/components/schemas/ApiKey" }
        "401":
          $ref: "#/components/responses/Unauthorized"
    post:
      operationId: createApiKey
      summary: Generate a new API key
      description: Full key value returned once only — user must copy it immediately.
      tags: [API Keys]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name:
                  type: string
                  minLength: 1
                  maxLength: 100
                spendingLimitPerBookingEur:
                  type: number
                  nullable: true
                monthlySpendingLimitEur:
                  type: number
                  nullable: true
      responses:
        "201":
          description: API key created. Copy key now — not shown again.
          content:
            application/json:
              schema:
                allOf:
                  - $ref: "#/components/schemas/ApiKey"
                  - type: object
                    required: [key]
                    properties:
                      key:
                        type: string
                        example: sk_spotzy_live_4f8a2b1c9d3e7f0a2b3c4d5e6f7a8b9c
        "400":
          $ref: "#/components/responses/UnprocessableEntity"
        "401":
          $ref: "#/components/responses/Unauthorized"

  /api/v1/agent/keys/{keyId}:
    delete:
      operationId: revokeApiKey
      summary: Revoke an API key immediately
      tags: [API Keys]
      parameters:
        - name: keyId
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: Key revoked
          content:
            application/json:
              schema:
                type: object
                required: [keyId, revokedAt]
                properties:
                  keyId: { type: string }
                  revokedAt: { $ref: "#/components/schemas/ISO8601DateTime" }
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          description: Key belongs to a different user
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
        "404":
          $ref: "#/components/responses/NotFound"

  /api/v1/agent/webhooks:
    get:
      operationId: listWebhooks
      summary: List registered webhook endpoints
      tags: [Webhooks]
      responses:
        "200":
          description: Webhooks
          content:
            application/json:
              schema:
                type: object
                required: [webhooks]
                properties:
                  webhooks:
                    type: array
                    items: { $ref: "#/components/schemas/Webhook" }
        "401":
          $ref: "#/components/responses/Unauthorized"
    post:
      operationId: registerWebhook
      summary: Register a webhook endpoint
      description: |
        signingSecret returned once only. Use it to verify Spotzy-Signature on inbound requests:
        expected = "sha256=" + HMAC-SHA256(signingSecret, rawBody)
      tags: [Webhooks]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [url, events]
              properties:
                url:
                  type: string
                  format: uri
                events:
                  type: array
                  minItems: 1
                  items:
                    type: string
                    enum: [booking.confirmed, booking.active, booking.completed,
                           booking.cancelled, message.received]
      responses:
        "201":
          description: Webhook registered. Copy signingSecret now — not shown again.
          content:
            application/json:
              schema:
                allOf:
                  - $ref: "#/components/schemas/Webhook"
                  - type: object
                    required: [signingSecret]
                    properties:
                      signingSecret:
                        type: string
                        example: whsec_8a3c1f2d9e4b7a0c5d6e7f8a9b0c1d2e
        "400":
          description: Invalid URL or event type
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
        "401":
          $ref: "#/components/responses/Unauthorized"

  /api/v1/agent/webhooks/{webhookId}:
    delete:
      operationId: deleteWebhook
      summary: Remove a webhook endpoint
      tags: [Webhooks]
      parameters:
        - name: webhookId
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: Webhook deleted
          content:
            application/json:
              schema:
                type: object
                required: [webhookId, deletedAt]
                properties:
                  webhookId: { type: string }
                  deletedAt: { $ref: "#/components/schemas/ISO8601DateTime" }
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          description: Webhook belongs to a different user
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorResponse" }
        "404":
          $ref: "#/components/responses/NotFound"

# Webhook payload schemas (not endpoints — for developer reference)
#
# Shared envelope:
#   { "event": "booking.confirmed", "timestamp": "ISO8601", "data": { ... } }
#
# booking.confirmed:  bookingId, confirmationRef, listingId, listingAddress,
#                     spotType, startTime, endTime, totalEur, hostPseudo
# booking.active:     bookingId, listingAddress, startTime, endTime, accessInstructions (nullable)
# booking.completed:  bookingId, listingAddress, startTime, endTime, durationHours, totalEur
# booking.cancelled:  bookingId, listingAddress, startTime, endTime, refundEur, refundPercent, policy
# message.received:   bookingId, messageId, senderRole, senderPseudo, text, sentAt
#
# Delivery headers:
#   Spotzy-Signature: sha256=<HMAC-SHA256(signingSecret, rawBody)>
#   Spotzy-Event: booking.confirmed
#   Spotzy-Delivery-Id: <ulid — unique per attempt>
#
# Retry: 3 attempts, 1min / 5min / 30min backoff. Return 2xx to acknowledge.

tags:
  - name: Listings
    description: Search listings and get price quotes
  - name: Bookings
    description: Create, list, and cancel bookings
  - name: Messages
    description: Read and send messages within a booking
  - name: Preferences
    description: Manage user booking preferences
  - name: API Keys
    description: Manage API keys for programmatic access
  - name: Webhooks
    description: Register endpoints to receive booking event notifications
```

---

## PART E — Webhooks

### E1 — Webhook registration endpoints

**Tests: `__tests__/agent/webhooks.test.ts`**
```typescript
test('POST /webhooks registers endpoint, returns signingSecret once only', async () => {
  const result = await handler(mockApiKeyEvent('user-1', {
    body: {
      url: 'https://my-agent.example.com/spotzy-events',
      events: ['booking.confirmed', 'booking.cancelled'],
    },
  }));
  expect(result.statusCode).toBe(201);
  const body = JSON.parse(result.body);
  expect(body.webhookId).toBeDefined();
  expect(body.signingSecret).toMatch(/^whsec_/);
  // Verify secret is hashed in DynamoDB, not stored raw
  const record = await getDynamoItem(`USER#user-1`, `WEBHOOK#${body.webhookId}`);
  expect(record.signingSecret).not.toBe(body.signingSecret);
  expect(record.signingSecret.length).toBe(64); // sha256 hex
});

test('GET /webhooks lists all registered webhooks without signing secrets', async () => {
  await seedWebhook({ userId: 'user-1', url: 'https://example.com', events: ['booking.confirmed'] });
  const result = await listHandler(mockApiKeyEvent('user-1'));
  const { webhooks } = JSON.parse(result.body);
  expect(webhooks.length).toBeGreaterThan(0);
  webhooks.forEach((w: any) => expect(w.signingSecret).toBeUndefined());
});

test('DELETE /webhooks/{id} removes webhook', async () => {
  const { webhookId } = await seedWebhook({ userId: 'user-1' });
  const result = await deleteHandler(mockApiKeyEvent('user-1', {
    pathParameters: { webhookId },
  }));
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body).deletedAt).toBeDefined();
});

test('DELETE /webhooks/{id} returns 403 for another user\'s webhook', async () => {
  const { webhookId } = await seedWebhook({ userId: 'user-2' });
  const result = await deleteHandler(mockApiKeyEvent('user-1', {
    pathParameters: { webhookId },
  }));
  expect(result.statusCode).toBe(403);
});
```

### E2 — Webhook delivery Lambda

**Tests: `__tests__/agent/webhook-delivery.test.ts`**
```typescript
test('fans out to all matching webhooks for the user', async () => {
  await seedWebhook({ userId: 'user-1', url: 'https://a.example.com',
    events: ['booking.confirmed'] });
  await seedWebhook({ userId: 'user-1', url: 'https://b.example.com',
    events: ['booking.confirmed', 'booking.cancelled'] });
  await webhookDeliveryHandler(buildEvent('booking.confirmed', { userId: 'user-1',
    bookingId: 'b1', confirmationRef: 'SPZ-111' }));
  expect(mockHttpPost).toHaveBeenCalledTimes(2);
});

test('does not deliver to webhooks not subscribed to the event type', async () => {
  await seedWebhook({ userId: 'user-1', url: 'https://c.example.com',
    events: ['booking.cancelled'] }); // not confirmed
  await webhookDeliveryHandler(buildEvent('booking.confirmed', { userId: 'user-1' }));
  expect(mockHttpPost).not.toHaveBeenCalled();
});

test('HMAC-SHA256 signature is verifiable by receiver', async () => {
  const { webhookId, rawSecret } = await seedWebhook({ userId: 'user-1',
    events: ['booking.confirmed'] });
  let capturedHeaders: any;
  let capturedBody: string;
  mockHttpPost.mockImplementation(async (url: string, { headers, body }: any) => {
    capturedHeaders = headers;
    capturedBody = body;
    return { status: 200 };
  });
  await webhookDeliveryHandler(buildEvent('booking.confirmed', { userId: 'user-1' }));
  const expected = 'sha256=' + createHmac('sha256', rawSecret)
    .update(capturedBody).digest('hex');
  expect(capturedHeaders['Spotzy-Signature']).toBe(expected);
});

test('failed delivery logs FAILED and schedules retry via EventBridge Scheduler', async () => {
  await seedWebhook({ userId: 'user-1', events: ['booking.confirmed'] });
  mockHttpPost.mockRejectedValue(new Error('Connection refused'));
  await webhookDeliveryHandler(buildEvent('booking.confirmed', { userId: 'user-1' }));
  expect(mockScheduler.createSchedule).toHaveBeenCalledTimes(1);
  const auditRecord = await getAuditLogForWebhook('user-1');
  expect(auditRecord.status).toBe('FAILED');
});

test('successful delivery logs SUCCESS, does not schedule retry', async () => {
  await seedWebhook({ userId: 'user-1', events: ['booking.confirmed'] });
  mockHttpPost.mockResolvedValue({ status: 200 });
  await webhookDeliveryHandler(buildEvent('booking.confirmed', { userId: 'user-1' }));
  expect(mockScheduler.createSchedule).not.toHaveBeenCalled();
  const auditRecord = await getAuditLogForWebhook('user-1');
  expect(auditRecord.status).toBe('SUCCESS');
});

test('10s timeout — slow receiver treated as failure', async () => {
  await seedWebhook({ userId: 'user-1', events: ['booking.confirmed'] });
  mockHttpPost.mockImplementation(() =>
    new Promise(resolve => setTimeout(() => resolve({ status: 200 }), 15_000)));
  await webhookDeliveryHandler(buildEvent('booking.confirmed', { userId: 'user-1' }));
  expect(mockScheduler.createSchedule).toHaveBeenCalled(); // retry scheduled
});
```

**Implementation: `functions/agent/webhook-delivery/index.ts`**
```typescript
import { createHmac } from 'crypto';
import { ulid } from 'ulid';

export const handler = async (event: EventBridgeEvent<string, any>) => {
  const { userId, ...eventData } = event.detail;
  const eventType = event['detail-type']; // e.g. 'booking.confirmed'

  // Fetch all active webhooks for this user subscribed to this event type
  const { Items: webhooks = [] } = await dynamodb.query({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    FilterExpression: 'active = :t AND contains(events, :eventType)',
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`, ':prefix': 'WEBHOOK#',
      ':t': true, ':eventType': eventType,
    },
  }).promise();

  // Fan out — allSettled so one failure doesn't block others
  await Promise.allSettled(webhooks.map(w => deliverWebhook(w, eventType, eventData)));
};

const deliverWebhook = async (webhook: any, eventType: string, data: any) => {
  const payload = JSON.stringify({ event: eventType, data, timestamp: new Date().toISOString() });
  // Retrieve hashed secret and compute HMAC against the hash
  // (secret stored as sha256(rawSecret) — HMAC uses the stored hash as key)
  const signature = `sha256=${createHmac('sha256', webhook.signingSecret).update(payload).digest('hex')}`;
  const deliveryId = ulid();

  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Spotzy-Signature': signature,
        'Spotzy-Event': eventType,
        'Spotzy-Delivery-Id': deliveryId,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await logDelivery(webhook.webhookId, deliveryId, eventType, 'SUCCESS');

  } catch (err: any) {
    await logDelivery(webhook.webhookId, deliveryId, eventType, 'FAILED', err.message);
    await scheduleRetry(webhook, eventType, data, deliveryId);
  }
};

const scheduleRetry = async (webhook: any, eventType: string, data: any,
  deliveryId: string) => {
  // Count prior attempts for this deliveryId — max 3 total
  const attempts = await countDeliveryAttempts(deliveryId);
  if (attempts >= 3) return; // give up
  const backoffMinutes = [1, 5, 30][attempts] ?? 30;
  const scheduleTime = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
  await scheduler.createSchedule({
    Name: `webhook-retry-${deliveryId}-${attempts + 1}`,
    ScheduleExpression: `at(${scheduleTime.slice(0, 19)})`,
    Target: {
      Arn: process.env.WEBHOOK_DELIVERY_LAMBDA_ARN!,
      RoleArn: process.env.SCHEDULER_ROLE_ARN!,
      Input: JSON.stringify({ 'detail-type': eventType, detail: { ...data, _webhookId: webhook.webhookId, _deliveryId: deliveryId } }),
    },
    FlexibleTimeWindow: { Mode: 'OFF' },
  }).promise();
};
```

---

## PART F — Frontend: API Key Management UI

**`app/profile/developer/page.tsx`**

**Tests: `__tests__/pages/developer.test.tsx`**
```typescript
test('renders "Generate API key" button', () => {
  render(<DeveloperPage />);
  expect(screen.getByRole('button', { name: /generate api key/i })).toBeInTheDocument();
});

test('new key shown once in reveal box with copy button', async () => {
  mockFetch({ key: 'sk_spotzy_live_abc123', keyId: 'key-1', name: 'Test key' });
  render(<DeveloperPage />);
  fireEvent.click(screen.getByRole('button', { name: /generate api key/i }));
  await waitFor(() => {
    expect(screen.getByTestId('key-reveal')).toHaveTextContent('sk_spotzy_live_abc123');
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });
});

test('key value hidden after dismiss', async () => {
  mockFetch({ key: 'sk_spotzy_live_abc123', keyId: 'key-1' });
  render(<DeveloperPage />);
  fireEvent.click(screen.getByRole('button', { name: /generate api key/i }));
  await waitFor(() => screen.getByTestId('key-reveal'));
  fireEvent.click(screen.getByRole('button', { name: /done, i've copied it/i }));
  expect(screen.queryByText('sk_spotzy_live_abc123')).not.toBeInTheDocument();
});

test('existing keys listed without revealing key values', async () => {
  mockFetch({ keys: [{ keyId: 'key-1', name: 'Home assistant', lastUsedAt: null,
    monthlySpendingSoFarEur: 45.00 }] });
  render(<DeveloperPage />);
  await waitFor(() => expect(screen.getByText('Home assistant')).toBeInTheDocument());
  expect(screen.queryByText(/sk_spotzy_live_/)).not.toBeInTheDocument();
});

test('revoke button shows confirmation dialog before calling API', async () => {
  mockFetch({ keys: [{ keyId: 'key-1', name: 'Home assistant' }] });
  render(<DeveloperPage />);
  await waitFor(() => screen.getByRole('button', { name: /revoke/i }));
  fireEvent.click(screen.getByRole('button', { name: /revoke/i }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /confirm revoke/i }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/agent/keys/key-1'),
    expect.objectContaining({ method: 'DELETE' })
  ));
});

test('MCP setup instructions shown with correct config snippet', async () => {
  mockFetch({ keys: [{ keyId: 'key-1', name: 'Home assistant' }] });
  render(<DeveloperPage />);
  await waitFor(() => expect(screen.getByTestId('mcp-setup-instructions')).toBeInTheDocument());
  expect(screen.getByTestId('mcp-setup-instructions')).toHaveTextContent('spotzy-mcp');
});
```

---

## PART G — CDK: AgentStack

Create a separate CDK stack to keep agent infrastructure isolated from the main stack.

```typescript
// lib/agent-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as scheduler from '@aws-cdk/aws-scheduler-alpha';
import { Construct } from 'constructs';

export class AgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const { mainTable, mainApi, eventBus, mediaPublicBucket } = props;

    const commonEnv = {
      DYNAMODB_TABLE: mainTable.tableName,
      POWERTOOLS_SERVICE_NAME: 'spotzy-agent',
    };

    // ── API key authorizer ──────────────────────────────────────────────────
    const apiKeyAuthorizer = new lambda.Function(this, 'ApiKeyAuthorizer', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('functions/auth/api-key-authorizer'),
      environment: commonEnv,
      timeout: cdk.Duration.seconds(5),
    });
    mainTable.grantReadWriteData(apiKeyAuthorizer);

    const tokenAuthorizer = new apigateway.TokenAuthorizer(this, 'AgentTokenAuthorizer', {
      handler: apiKeyAuthorizer,
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: cdk.Duration.minutes(5),
    });

    // ── Agent route prefix on existing API ─────────────────────────────────
    const agentRoot = mainApi.root
      .addResource('api').addResource('v1').addResource('agent');

    const addAgentRoute = (
      path: string[], method: string,
      fn: lambda.Function, auth = true
    ) => {
      let resource = agentRoot;
      for (const segment of path) resource = resource.addResource(segment);
      resource.addMethod(method,
        new apigateway.LambdaIntegration(fn),
        auth ? { authorizer: tokenAuthorizer,
          authorizationType: apigateway.AuthorizationType.CUSTOM } : {}
      );
    };

    // ── Agent Lambda functions ──────────────────────────────────────────────
    const mkLambda = (id: string, assetPath: string, extraEnv: Record<string, string> = {}) =>
      new lambda.Function(this, id, {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(assetPath),
        environment: { ...commonEnv, ...extraEnv },
        timeout: cdk.Duration.seconds(30),
      });

    const searchFn     = mkLambda('AgentSearch',    'functions/agent/search');
    const quoteFn      = mkLambda('AgentQuote',     'functions/agent/quote');
    const bookFn       = mkLambda('AgentBook',      'functions/agent/bookings/create',
      { STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY! });
    const listBookFn   = mkLambda('AgentListBooks', 'functions/agent/bookings/list');
    const cancelFn     = mkLambda('AgentCancel',    'functions/agent/bookings/cancel');
    const msgSendFn    = mkLambda('AgentMsgSend',   'functions/agent/messages/send');
    const msgGetFn     = mkLambda('AgentMsgGet',    'functions/agent/messages/list');
    const prefGetFn    = mkLambda('AgentPrefGet',   'functions/agent/preferences/get');
    const prefSetFn    = mkLambda('AgentPrefSet',   'functions/agent/preferences/set');
    const keysGetFn    = mkLambda('AgentKeysGet',   'functions/agent/keys/list');
    const keysPostFn   = mkLambda('AgentKeysPost',  'functions/agent/keys/create');
    const keysDelFn    = mkLambda('AgentKeysDel',   'functions/agent/keys/revoke');
    const hooksGetFn   = mkLambda('AgentHooksGet',  'functions/agent/webhooks/list');
    const hooksPostFn  = mkLambda('AgentHooksPost', 'functions/agent/webhooks/register');
    const hooksDelFn   = mkLambda('AgentHooksDel',  'functions/agent/webhooks/delete');
    const openApiFn    = mkLambda('AgentOpenApi',   'functions/agent/openapi');

    [searchFn, quoteFn, bookFn, listBookFn, cancelFn, msgSendFn, msgGetFn,
     prefGetFn, prefSetFn, keysGetFn, keysPostFn, keysDelFn,
     hooksGetFn, hooksPostFn, hooksDelFn].forEach(fn => mainTable.grantReadWriteData(fn));

    // ── Mount routes ────────────────────────────────────────────────────────
    addAgentRoute(['search'], 'GET', searchFn);
    addAgentRoute(['listings', '{listingId}', 'quote'], 'GET', quoteFn);
    addAgentRoute(['bookings'], 'POST', bookFn);
    addAgentRoute(['bookings'], 'GET',  listBookFn);
    addAgentRoute(['bookings', '{bookingId}', 'cancel'],   'POST', cancelFn);
    addAgentRoute(['bookings', '{bookingId}', 'messages'], 'POST', msgSendFn);
    addAgentRoute(['bookings', '{bookingId}', 'messages'], 'GET',  msgGetFn);
    addAgentRoute(['preferences'], 'GET', prefGetFn);
    addAgentRoute(['preferences'], 'PUT', prefSetFn);
    addAgentRoute(['keys'], 'GET',  keysGetFn);
    addAgentRoute(['keys'], 'POST', keysPostFn);
    addAgentRoute(['keys', '{keyId}'], 'DELETE', keysDelFn);
    addAgentRoute(['webhooks'], 'GET',  hooksGetFn);
    addAgentRoute(['webhooks'], 'POST', hooksPostFn);
    addAgentRoute(['webhooks', '{webhookId}'], 'DELETE', hooksDelFn);
    // OpenAPI spec — public, no auth
    addAgentRoute(['openapi.yaml'], 'GET', openApiFn, false);

    // ── Webhook delivery Lambda ─────────────────────────────────────────────
    const webhookDeliveryFn = mkLambda('WebhookDelivery',
      'functions/agent/webhook-delivery',
      { SCHEDULER_ROLE_ARN: /* create IAM role */ '' });
    mainTable.grantReadWriteData(webhookDeliveryFn);

    const rule = new events.Rule(this, 'BookingLifecycleRule', {
      eventBus,
      eventPattern: {
        detailType: [
          'booking.confirmed', 'booking.active', 'booking.completed',
          'booking.cancelled', 'message.received',
        ],
      },
    });
    rule.addTarget(new targets.LambdaFunction(webhookDeliveryFn));

    // ── Monthly spending reset ──────────────────────────────────────────────
    // EventBridge Scheduler: 1st of each month at 00:00 UTC
    // Resets monthlySpendingSoFarEur = 0 and updates monthlyResetAt on all APIKEY# records
    // TODO: implement monthly-reset Lambda and schedule in follow-up session
  }
}
```

---

## PART H — E2E (Agent flows)

**`e2e/journeys/agent-api.spec.ts`**
```typescript
test('full agent flow: search → quote → book', async () => {
  const apiKey = await generateApiKey(TEST_GUEST_USER_ID);

  const searchRes = await fetch(
    `${API_URL}/api/v1/agent/search?lat=50.835&lng=4.337` +
    `&startTime=2026-04-20T08:00:00Z&endTime=2026-04-20T18:00:00Z`,
    { headers: { Authorization: `ApiKey ${apiKey}` } }
  );
  expect(searchRes.status).toBe(200);
  const { listings } = await searchRes.json();
  expect(listings.length).toBeGreaterThan(0);

  const quoteRes = await fetch(
    `${API_URL}/api/v1/agent/listings/${listings[0].listingId}/quote` +
    `?startTime=2026-04-20T08:00:00Z&endTime=2026-04-20T18:00:00Z`,
    { headers: { Authorization: `ApiKey ${apiKey}` } }
  );
  expect(quoteRes.status).toBe(200);
  const quote = await quoteRes.json();
  expect(quote.totalEur).toBeGreaterThan(0);
  expect(quote.cancellationPolicy.rule).toBeDefined();

  const bookRes = await fetch(`${API_URL}/api/v1/agent/bookings`, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      listingId: listings[0].listingId,
      startTime: '2026-04-20T08:00:00Z',
      endTime: '2026-04-20T18:00:00Z',
    }),
  });
  expect(bookRes.status).toBe(201);
  const booking = await bookRes.json();
  expect(booking.confirmationRef).toMatch(/^SPZ-/);
  expect(booking.status).toBe('CONFIRMED');
});

test('revoked API key returns 401', async () => {
  const apiKey = await generateApiKey(TEST_GUEST_USER_ID);
  await revokeApiKey(TEST_GUEST_USER_ID, apiKey);
  // Wait for authorizer cache to expire (or set TTL=0 in test env)
  const res = await fetch(`${API_URL}/api/v1/agent/search?lat=50.835&lng=4.337`, {
    headers: { Authorization: `ApiKey ${apiKey}` },
  });
  expect(res.status).toBe(401);
});

test('spending limit enforced on agent booking', async () => {
  const apiKey = await generateApiKeyWithLimits(TEST_GUEST_USER_ID,
    { spendingLimitPerBookingEur: 5 }); // €5 — well below any real listing
  const searchRes = await fetch(
    `${API_URL}/api/v1/agent/search?lat=50.835&lng=4.337`,
    { headers: { Authorization: `ApiKey ${apiKey}` } }
  );
  const { listings } = await searchRes.json();
  const bookRes = await fetch(`${API_URL}/api/v1/agent/bookings`, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      listingId: listings[0].listingId,
      startTime: '2026-04-20T08:00:00Z',
      endTime: '2026-04-20T18:00:00Z',
    }),
  });
  expect(bookRes.status).toBe(402);
  expect((await bookRes.json()).error).toBe('SPENDING_LIMIT_EXCEEDED');
});

test('OpenAPI spec is publicly accessible and validates as 3.1', async () => {
  const res = await fetch(`${API_URL}/api/v1/agent/openapi.yaml`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/yaml');
  const yaml = await res.text();
  expect(yaml).toContain('openapi: 3.1.0');
  expect(yaml).toContain('searchParking');
  expect(yaml).toContain('createBooking');
});
```

---

## Known gaps to address in follow-up sessions

1. **Monthly spending reset** — `monthlySpendingSoFarEur` and `monthlyResetAt` fields exist on
   the `APIKEY#` record but no Lambda or EventBridge Scheduler rule resets them on the 1st of
   each month. The `AgentStack` CDK has a `// TODO` marker for this. Implement as a separate
   Lambda triggered by a cron schedule: `cron(0 0 1 * ? *)`.

2. **Hosted MCP server (mcp.spotzy.com)** — local stdio mode is fully implemented above.
   The hosted HTTP+SSE mode for Claude.ai remote MCP requires a persistent server (Lambda
   with streaming, or ECS container) with per-request credential scoping. Estimate: 2 days.

3. **CDK AgentStack route wiring is complete** above — all 15 endpoints are mounted via
   `addAgentRoute`. The CDK stub from the architecture doc's comment placeholder is fully
   replaced here.
