# Session 04 — Payments Domain (TDD: tests first, then implementation)

## What this session does
Writes Jest unit tests for all payment flows first, then implements the Lambda functions.

## Feed to Claude Code
This file only.

## Instructions for Claude Code
Write tests first, then implementation. Mock the Stripe SDK and AWS Secrets Manager.

```typescript
// Mock pattern for Stripe
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn(),
      capture: jest.fn(),
      cancel: jest.fn(),
    },
    refunds: { create: jest.fn() },
    accounts: { create: jest.fn() },
    accountLinks: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  }));
});

// Mock Secrets Manager — always returns test keys
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: 'sk_test_mock' }),
  })),
  GetSecretValueCommand: jest.fn(),
}));
```

---

## Function 1 — payment-intent

### Tests first: `__tests__/payments/intent.test.ts`

**Happy path:**
- Booking in PENDING_PAYMENT status → Stripe PaymentIntent created with correct amount in cents
- `application_fee_amount` = 15% of total (rounded to cents)
- `transfer_data.destination` = host's `stripeConnectAccountId`
- `capture_method` = `manual`
- `metadata` includes bookingId, spotterId, listingId
- `stripePaymentIntentId` stored on booking record in DynamoDB
- Returns `{ clientSecret, amount }`

**Amount calculation:**
- €7.00 booking → `amount: 700` (cents), `application_fee_amount: 105` (15% = €1.05)
- €100.00 booking → `amount: 10000`, `application_fee_amount: 1500`
- €3.33 booking → `amount: 333`, `application_fee_amount: 50` (rounds down to nearest cent)

**Failures:**
- Booking status is CONFIRMED (not PENDING_PAYMENT) → 400 `PAYMENT_ALREADY_PROCESSED`
- Booking status is CANCELLED → 400
- Requester is not the guest → 403
- Stripe API throws error → 500 with generic message (Stripe error NOT exposed to client)
- Booking not found → 404

### Implementation: `functions/payments/intent/index.ts`

Implement PaymentIntent creation with all test requirements.

---

## Function 2 — payment-webhook

### Tests first: `__tests__/payments/webhook.test.ts`

**Signature verification:**
- Valid Stripe signature → processes event
- Invalid signature → returns 400 immediately, no processing
- Missing `stripe-signature` header → 400

**Event: `payment_intent.succeeded`:**
- Booking found in DynamoDB → status updated to CONFIRMED
- `paidAt` set to current timestamp
- `stripeChargeId` stored
- Returns 200

**Event: `payment_intent.payment_failed`:**
- Booking status updated to PAYMENT_FAILED
- Failure reason stored
- Returns 200

**Event: `refund.created`:**
- `refundStatus=PROCESSED`, `refundedAt`, `refundedAmount` stored on booking
- Returns 200

**Unhandled event type:**
- `customer.subscription.created` (irrelevant) → returns 200 without processing (Stripe must not retry)

**Idempotency:**
- Same `payment_intent.succeeded` event delivered twice → second delivery is a no-op (booking already CONFIRMED, no error)

### Implementation: `functions/payments/webhook/index.ts`

Verify Stripe signature. Handle each event type. Return 200 for all processed and unhandled events.

---

## Function 3 — payout-trigger

### Tests first: `__tests__/payments/payout-trigger.test.ts`

**booking.completed — happy path:**
- Booking status ACTIVE → captured via Stripe, status set to COMPLETED
- `stripe.paymentIntents.capture` called with correct `stripePaymentIntentId`
- `completedAt` set, `payoutStatus=PROCESSING` stored
- EventBridge `booking.completed` re-emitted with CONFIRMED status

**booking.completed — failures:**
- Booking already COMPLETED → no-op (idempotent)
- Booking is CANCELLED → no-op (skip gracefully)
- Stripe capture fails → log error, set `payoutStatus=FAILED`, do NOT throw (EventBridge retry behaviour)

**booking.cancelled — refund path:**
- `refundAmount > 0`, booking was CONFIRMED (payment captured) → `stripe.refunds.create` called
- `refundAmount = 0` → no Stripe call made
- Booking was PENDING_PAYMENT (payment not yet captured) → `stripe.paymentIntents.cancel` called instead of refund
- `refundStatus=PENDING` stored after initiating refund

**booking.cancelled — edge cases:**
- `stripePaymentIntentId` not set (payment was never attempted) → no Stripe call, booking marked cancelled normally

### Implementation: `functions/payments/payout-trigger/index.ts`

Handle booking.completed (capture) and booking.cancelled (refund/cancel) event paths.

---

## Function 4 — payout-setup

### Tests first: `__tests__/payments/payout-setup.test.ts`

**First-time setup:**
- User has no `stripeConnectAccountId` → creates Express account for country `BE`
- `stripe.accounts.create` called with correct type, country, email
- `stripeConnectAccountId` stored on user record in DynamoDB
- `stripe.accountLinks.create` called with correct redirect URLs
- Returns `{ onboardingUrl }`

**Returning user:**
- User already has `stripeConnectAccountId` → skips account creation
- Creates new account link for existing account → returns fresh `{ onboardingUrl }`

**Failures:**
- Stripe account creation fails → 500
- Missing auth → 401

### Implementation: `functions/users/payout-setup/index.ts`

Stripe Connect Express onboarding flow. Store accountId on user. Return onboarding URL.

---

## Stripe amount helper — unit test separately

**`__tests__/payments/stripe-helpers.test.ts`** — test `toStripeAmount(euros: number): number`:

| Input (€) | Expected (cents) |
|---|---|
| 7.00 | 700 |
| 3.33 | 333 |
| 0.01 | 1 |
| 100.00 | 10000 |
| 9.999 | 1000 (rounded to 2 decimal places before converting) |

And `calculatePlatformFee(totalCents: number): number` (15%):

| Input (cents) | Expected fee (cents) |
|---|---|
| 700 | 105 |
| 333 | 49 (floor) |
| 10000 | 1500 |
