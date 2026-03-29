import { API_URL, TEST_HOST, TEST_SPOTTER, loginAndGetToken, seedTestListing, cleanupBooking } from './setup';

let hostToken: string;
let spotterToken: string;
let testListingId: string;
let testBookingId: string;

beforeAll(async () => {
  [hostToken, spotterToken] = await Promise.all([
    loginAndGetToken(TEST_HOST.email, TEST_HOST.password),
    loginAndGetToken(TEST_SPOTTER.email, TEST_SPOTTER.password),
  ]);
  testListingId = await seedTestListing(hostToken);

  // Create a booking to attach payment to
  const startTime = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const endTime = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString();
  const bookingRes = await fetch(`${API_URL}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spotterToken}` },
    body: JSON.stringify({ listingId: testListingId, startTime, endTime }),
  });
  const booking = await bookingRes.json() as { bookingId: string };
  testBookingId = booking.bookingId;
});

afterAll(async () => {
  if (testBookingId) await cleanupBooking(testBookingId, spotterToken);
});

describe('Payments API', () => {
  test('POST /payments/intent — creates PaymentIntent for correct amount', async () => {
    const res = await fetch(`${API_URL}/api/v1/payments/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spotterToken}` },
      body: JSON.stringify({ bookingId: testBookingId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { clientSecret: string; amount: number; currency: string };
    expect(body.clientSecret).toMatch(/^pi_.*_secret_/);
    expect(body.amount).toBeGreaterThan(0);
    expect(body.currency).toBe('eur');
  });

  test('POST /payments/webhook — payment_intent.succeeded confirms booking', async () => {
    // This test simulates a Stripe webhook using the Stripe test mode.
    // In CI: use `stripe trigger payment_intent.succeeded --add payment_intent:metadata.bookingId=<id>`
    // Here we call the webhook endpoint directly with a test event signature.
    // NOTE: Stripe webhook signature validation must be disabled in test environment
    // OR use STRIPE_WEBHOOK_SECRET=whsec_test_... from Secrets Manager.

    const stripeEvent = {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test_12345',
          status: 'succeeded',
          amount: 700,
          currency: 'eur',
          metadata: { bookingId: testBookingId },
        },
      },
    };

    const res = await fetch(`${API_URL}/api/v1/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'test-sig', // valid in test env with STRIPE_WEBHOOK_SECRET=whsec_test
      },
      body: JSON.stringify(stripeEvent),
    });
    // Test environment accepts test signatures
    expect([200, 204]).toContain(res.status);

    // Verify booking status updated to confirmed
    await new Promise((r) => setTimeout(r, 1000)); // allow async processing
    const bookingRes = await fetch(`${API_URL}/api/v1/bookings/${testBookingId}`, {
      headers: { Authorization: `Bearer ${spotterToken}` },
    });
    const booking = await bookingRes.json() as { status: string };
    expect(booking.status).toBe('confirmed');
  });
});
