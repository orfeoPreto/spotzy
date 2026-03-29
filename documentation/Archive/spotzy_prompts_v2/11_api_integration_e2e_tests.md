# Session 11 — API Tests, Integration Tests, E2E Tests & CI Pipeline

## What this session does
Builds the remaining test layers that require a running environment:
- Integration tests (DynamoDB Local)
- API tests (deployed test environment)
- E2E tests (Playwright against staging)
- Full CI/CD pipeline with test gates

## Feed to Claude Code
This file only.

---

## Part 1 — Integration tests (DynamoDB Local)

These tests verify that DynamoDB key patterns, GSI queries, conditional writes, and TTL work correctly against a real DynamoDB instance running locally in Docker.

### Docker setup: `docker-compose.test.yml`

```yaml
version: '3'
services:
  dynamodb-local:
    image: amazon/dynamodb-local:latest
    ports:
      - "8000:8000"
    command: ["-jar", "DynamoDBLocal.jar", "-inMemory", "-sharedDb"]
```

### Test setup: `backend/__tests__/integration/setup.ts`

```typescript
import { DynamoDBClient, CreateTableCommand } from '@aws-sdk/client-dynamodb';

export const localClient = new DynamoDBClient({
  endpoint: 'http://localhost:8000',
  region: 'eu-west-1',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

export async function createTestTable() {
  await localClient.send(new CreateTableCommand({
    TableName: 'spotzy-main-test',
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' },
      { AttributeName: 'geohash', AttributeType: 'S' },
      { AttributeName: 'listingId', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI1',
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'GSI2',
        KeySchema: [
          { AttributeName: 'geohash', KeyType: 'HASH' },
          { AttributeName: 'listingId', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'KEYS_ONLY' },
      },
    ],
  }));
}
```

### Integration test file: `__tests__/integration/booking-lifecycle.test.ts`

Test the complete booking lifecycle against real DynamoDB:

**Booking creation idempotency:**
- Write booking with idempotencyKey → success
- Write same booking with same idempotencyKey → returns existing record (no duplicate)
- Write booking with different idempotencyKey → new booking created

**Availability conflict detection:**
- Write booking: listing-1, 2026-04-01 09:00 → 11:00
- Attempt to write overlapping booking: 10:00 → 12:00 → conflict detected
- Write non-overlapping booking: 11:00 → 13:00 → succeeds
- Cancel first booking → its availability record deleted → previously conflicting period now free

**Optimistic locking:**
- Read booking (version=1)
- Write update with version=1 → success, version becomes 2
- Write update with version=1 again → ConditionalCheckFailedException
- Retry with version=2 → success

**Geohash search:**
- Write 3 listings with Brussels geohashes (precision 5)
- Write 1 listing with London geohash
- Search from Brussels coordinates → returns only Brussels listings
- No listings in search area → returns empty array

**GSI1 queries:**
- Write 3 listings for the same hostId
- Query GSI1 with `GSI1PK=HOST#{hostId}` → returns all 3
- Write 2 bookings for same spotterId
- Query GSI1 with `GSI1PK=SPOTTER#{spotterId}` → returns both

### Integration test: `__tests__/integration/review-visibility.test.ts`

- Write booking as COMPLETED
- Write host review → `published=false`
- Write spotter review → both reviews updated to `published=true`
- Query reviews → only published ones returned in public view

---

## Part 2 — API tests (deployed test environment)

These tests run against the actual deployed test environment (`test.spotzy.com`). They use pre-created test users and Stripe test mode.

### Setup: `api-tests/setup.ts`

```typescript
export const API_URL = process.env.TEST_API_URL ?? 'https://api-test.spotzy.com';

// Pre-created test users — credentials from Secrets Manager in CI
export const TEST_HOST = { email: 'host@test.spotzy.com', password: process.env.TEST_HOST_PASSWORD! };
export const TEST_SPOTTER = { email: 'spotter@test.spotzy.com', password: process.env.TEST_SPOTTER_PASSWORD! };
export const TEST_SPOTTER_2 = { email: 'spotter2@test.spotzy.com', password: process.env.TEST_SPOTTER_2_PASSWORD! };

export async function loginAndGetToken(email: string, password: string): Promise<string> {
  // Cognito auth via AdminInitiateAuth API
}

export async function seedTestListing(hostToken: string): Promise<string> {
  // Creates a LIVE listing and returns listingId
}

export async function cleanupBooking(bookingId: string, token: string) {
  await fetch(`${API_URL}/api/v1/bookings/${bookingId}/cancel`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
}
```

### API test: `api-tests/listings.test.ts`

```typescript
describe('Listings API', () => {
  test('POST /listings — creates a DRAFT listing', async () => { ... });
  test('POST /listings/{id}/publish — publishes listing with valid photos', async () => { ... });
  test('GET /listings/search — returns LIVE listings near Brussels', async () => { ... });
  test('GET /listings/search — filters by spotType correctly', async () => { ... });
  test('GET /listings/{id} — returns listing detail', async () => { ... });
  test('GET /listings/{id} — DRAFT listing returns 404 for non-owner', async () => { ... });
});
```

### API test: `api-tests/bookings.test.ts`

```typescript
describe('Bookings API', () => {
  test('POST /bookings — creates booking and emits booking.created event', async () => { ... });
  test('POST /bookings — idempotency: same key returns same booking', async () => { ... });
  test('POST /bookings — conflict: overlapping booking returns 409', async () => { ... });
  test('PUT /bookings/{id}/modify — extends end time successfully', async () => { ... });
  test('POST /bookings/{id}/cancel — >48h: full refund', async () => { ... });
  test('POST /bookings/{id}/cancel — host cancel: always full refund', async () => { ... });
});
```

### API test: `api-tests/payments.test.ts`

```typescript
describe('Payments API', () => {
  // Use Stripe test card: 4242 4242 4242 4242, exp 12/26, CVC 123
  test('POST /payments/intent — creates PaymentIntent for correct amount', async () => { ... });
  test('POST /payments/webhook — payment_intent.succeeded confirms booking', async () => {
    // Simulate Stripe webhook using Stripe CLI: stripe trigger payment_intent.succeeded
    ...
  });
});
```

### API test: `api-tests/chat.test.ts`

```typescript
describe('Chat API', () => {
  test('POST /chat/{bookingId} — sends message and stores in DynamoDB', async () => { ... });
  test('POST /chat/{bookingId} — emoji stripped from message', async () => { ... });
  test('GET /chat/{bookingId} — returns messages sorted ascending', async () => { ... });
  test('POST /chat/{bookingId} — unrelated user returns 403', async () => { ... });
});
```

---

## Part 3 — E2E tests (Playwright)

These are the 5 critical user journeys. Run against staging (`staging.spotzy.com`).

### Setup: `e2e/setup.ts`

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  use: {
    baseURL: process.env.STAGING_URL ?? 'https://staging.spotzy.com',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  timeout: 30000,
  retries: 2,
});
```

### E2E test 1: `e2e/journeys/spotter-books-spot.spec.ts`

```typescript
test('Spotter finds and books a parking spot end-to-end', async ({ page }) => {
  // 1. Log in as test spotter
  await page.goto('/auth/login');
  await page.fill('[data-testid="email"]', TEST_SPOTTER.email);
  await page.fill('[data-testid="password"]', TEST_SPOTTER.password);
  await page.click('[data-testid="sign-in-btn"]');
  await page.waitForURL('/search');

  // 2. Search for a spot in Brussels
  await page.fill('[data-testid="destination-input"]', 'Grand Place, Brussels');
  await page.click('[data-testid="suggestion-0"]');
  await expect(page.locator('[data-testid="spot-pin"]').first()).toBeVisible();

  // 3. Select a spot and view listing
  await page.click('[data-testid="spot-pin"]').first();
  await page.click('[data-testid="book-this-spot"]');
  await expect(page).toHaveURL(/\/listing\//);

  // 4. Select dates and proceed to booking
  await page.click('[data-testid="start-date"]');
  // Select tomorrow
  await page.click('[data-testid="end-date"]');
  // Select day after tomorrow
  await page.click('[data-testid="proceed-to-payment"]');
  await expect(page).toHaveURL(/\/book\//);

  // 5. Pay with Stripe test card
  await page.waitForSelector('[data-testid="stripe-payment-element"]');
  const stripeFrame = page.frameLocator('iframe[name*="__privateStripeFrame"]').first();
  await stripeFrame.locator('[placeholder="Card number"]').fill('4242424242424242');
  await stripeFrame.locator('[placeholder="MM / YY"]').fill('12/26');
  await stripeFrame.locator('[placeholder="CVC"]').fill('123');
  await page.click('[data-testid="pay-button"]');

  // 6. Confirm success
  await page.waitForURL(/\/book\/.*\?step=3/);
  await expect(page.locator('[data-testid="booking-reference"]')).toBeVisible();
  await expect(page.locator('[data-testid="success-message"]')).toContainText("You're all parked!");
});
```

### E2E test 2: `e2e/journeys/host-creates-listing.spec.ts`

```typescript
test('Host creates and publishes a parking listing', async ({ page }) => {
  // Login as host
  // Navigate to /listings/new
  // Step 1: Enter Brussels address
  // Step 2: Select COVERED_GARAGE, STANDARD, no EV, €3.50/hr
  // Step 3: Upload 2 photos (use test fixtures) — wait for PASS validation
  // Step 4: Set weekday 8am–8pm availability
  // Publish → verify "Your spot is live!" confirmation
  // Verify listing appears in host dashboard
});
```

### E2E test 3: `e2e/journeys/host-spotter-chat.spec.ts`

```typescript
test('Host and spotter can exchange messages', async ({ browser }) => {
  // Open two browser contexts simultaneously
  const hostContext = await browser.newContext();
  const spotterContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const spotterPage = await spotterContext.newPage();

  // Login both
  // Navigate both to the same booking chat thread
  // Host sends "Access code is 1234"
  // Spotter receives message without page refresh
  // Spotter replies "Thanks!"
  // Host receives reply
});
```

### E2E test 4: `e2e/journeys/spotter-cancels-booking.spec.ts`

```typescript
test('Spotter cancels booking and receives correct refund', async ({ page }) => {
  // Login as spotter
  // Navigate to an upcoming booking (>48h in future)
  // Click "Cancel booking"
  // Confirm refund amount shown = 100% of total
  // Click "Yes, cancel my booking"
  // Verify cancellation confirmation shown
  // Verify booking status = CANCELLED in dashboard
});
```

### E2E test 5: `e2e/journeys/dispute-flow.spec.ts`

```typescript
test('Spotter opens a dispute via AI chat', async ({ page }) => {
  // Login as spotter
  // Navigate to a completed booking
  // Click "Report an issue"
  // Verify support mode styling (navy tint)
  // Verify initial AI message appears
  // Click "Access problem" quick reply chip
  // Submit description
  // Upload a photo
  // Confirm the AI summary
  // Verify dispute reference number appears
});
```

---

## Part 4 — CI/CD pipeline

### `.github/workflows/deploy.yml`

```yaml
name: Spotzy CI/CD

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  release:
    types: [published]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
        working-directory: backend
      - run: npm test -- --coverage
        working-directory: backend
      - run: npm ci
        working-directory: frontend
      - run: npm run test
        working-directory: frontend

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    if: github.event_name == 'push' || github.event_name == 'release'
    services:
      dynamodb:
        image: amazon/dynamodb-local:latest
        ports: ['8000:8000']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && npm run test:integration
        working-directory: backend
        env:
          DYNAMODB_ENDPOINT: http://localhost:8000

  deploy-test:
    runs-on: ubuntu-latest
    needs: integration-tests
    if: github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: eu-west-1
      - run: npm ci && npx cdk deploy --all --require-approval never -c environment=test
        working-directory: infrastructure

  api-tests:
    runs-on: ubuntu-latest
    needs: deploy-test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && npm test
        working-directory: api-tests
        env:
          TEST_API_URL: ${{ secrets.TEST_API_URL }}
          TEST_HOST_PASSWORD: ${{ secrets.TEST_HOST_PASSWORD }}
          TEST_SPOTTER_PASSWORD: ${{ secrets.TEST_SPOTTER_PASSWORD }}

  deploy-staging:
    runs-on: ubuntu-latest
    needs: api-tests
    if: github.event_name == 'release'
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: eu-west-1
      - run: npx cdk deploy --all --require-approval never -c environment=staging
        working-directory: infrastructure

  e2e-tests:
    runs-on: ubuntu-latest
    needs: deploy-staging
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npx playwright install --with-deps chromium
      - run: npm ci && npx playwright test
        working-directory: e2e
        env:
          STAGING_URL: ${{ secrets.STAGING_URL }}
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: e2e/playwright-report/

  deploy-production:
    runs-on: ubuntu-latest
    needs: e2e-tests
    environment: production   # Requires manual approval in GitHub Environments
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: eu-west-1
      - run: npx cdk deploy --all --require-approval never -c environment=prod
        working-directory: infrastructure
```

---

## Part 5 — Test data seed scripts

### `scripts/seed-test-data.ts`

Create a seed script that populates the test environment with:

1. **2 test users** in Cognito:
   - `host@test.spotzy.com` (role: HOST, Stripe Connect account created in test mode)
   - `spotter@test.spotzy.com` (role: SPOTTER, Stripe test payment method attached)
   - `spotter2@test.spotzy.com` (role: SPOTTER)

2. **3 LIVE listings** in Brussels (spread across different geohashes):
   - Listing 1: Ixelles, COVERED_GARAGE, €3.50/hr, weekdays 8am–8pm
   - Listing 2: Uccle, DRIVEWAY, €2.00/hr, always available
   - Listing 3: Schaerbeek, CARPORT, €15/day, weekends only

3. **1 COMPLETED booking** (for testing reviews and disputes):
   - Spotter1 booked Listing1, completed yesterday

Run with: `npx ts-node scripts/seed-test-data.ts --environment test`
Run cleanup with: `npx ts-node scripts/seed-test-data.ts --environment test --cleanup`
