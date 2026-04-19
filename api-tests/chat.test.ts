import { API_URL, TEST_HOST, TEST_SPOTTER, loginAndGetToken, seedTestListing, cleanupBooking } from './setup';

let hostToken: string;
let spotterToken: string;
let unrelatedToken: string;
let testBookingId: string;

beforeAll(async () => {
  const [ht, st, ut] = await Promise.all([
    loginAndGetToken(TEST_HOST.email, TEST_HOST.password),
    loginAndGetToken(TEST_SPOTTER.email, TEST_SPOTTER.password),
    loginAndGetToken('spotter2@test.spotzy.be', process.env.TEST_SPOTTER_2_PASSWORD!),
  ]);
  hostToken = ht;
  spotterToken = st;
  unrelatedToken = ut;

  const listingId = await seedTestListing(hostToken);
  const startTime = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
  const endTime = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${API_URL}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spotterToken}` },
    body: JSON.stringify({ listingId, startTime, endTime }),
  });
  const booking = await res.json() as { bookingId: string };
  testBookingId = booking.bookingId;
});

afterAll(async () => {
  if (testBookingId) await cleanupBooking(testBookingId, spotterToken);
});

describe('Chat API', () => {
  test('POST /chat/{bookingId} — sends message and stores in DynamoDB', async () => {
    const res = await fetch(`${API_URL}/api/v1/chat/${testBookingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spotterToken}` },
      body: JSON.stringify({ text: 'Hello, is the spot accessible?', contentType: 'TEXT' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { messageId: string; text: string };
    expect(body.messageId).toBeTruthy();
    expect(body.text).toBe('Hello, is the spot accessible?');
  });

  test('POST /chat/{bookingId} — emoji stripped from message', async () => {
    const res = await fetch(`${API_URL}/api/v1/chat/${testBookingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spotterToken}` },
      body: JSON.stringify({ text: 'Thanks! 😀🎉', contentType: 'TEXT' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { text: string };
    expect(body.text).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
    expect(body.text.trim()).toBe('Thanks!');
  });

  test('GET /chat/{bookingId} — returns messages sorted ascending by timestamp', async () => {
    // Send two more messages to ensure ordering
    await fetch(`${API_URL}/api/v1/chat/${testBookingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({ text: 'Yes, accessible from the street', contentType: 'TEXT' }),
    });

    const res = await fetch(`${API_URL}/api/v1/chat/${testBookingId}`, {
      headers: { Authorization: `Bearer ${spotterToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { messages: { createdAt: string }[] };
    expect(body.messages.length).toBeGreaterThan(0);

    // Verify ascending order
    for (let i = 1; i < body.messages.length; i++) {
      expect(new Date(body.messages[i].createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(body.messages[i - 1].createdAt).getTime());
    }
  });

  test('POST /chat/{bookingId} — unrelated user returns 403', async () => {
    const res = await fetch(`${API_URL}/api/v1/chat/${testBookingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${unrelatedToken}` },
      body: JSON.stringify({ text: 'I am not part of this booking', contentType: 'TEXT' }),
    });
    expect(res.status).toBe(403);
  });
});
