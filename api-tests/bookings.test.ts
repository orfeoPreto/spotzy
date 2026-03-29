import { API_URL, TEST_HOST, TEST_SPOTTER, TEST_SPOTTER_2, loginAndGetToken, seedTestListing, cleanupBooking } from './setup';

let hostToken: string;
let spotterToken: string;
let spotter2Token: string;
let testListingId: string;
const createdBookingIds: string[] = [];

beforeAll(async () => {
  [hostToken, spotterToken, spotter2Token] = await Promise.all([
    loginAndGetToken(TEST_HOST.email, TEST_HOST.password),
    loginAndGetToken(TEST_SPOTTER.email, TEST_SPOTTER.password),
    loginAndGetToken(TEST_SPOTTER_2.email, TEST_SPOTTER_2.password),
  ]);
  testListingId = await seedTestListing(hostToken);
});

afterAll(async () => {
  await Promise.all(createdBookingIds.map((id) => cleanupBooking(id, spotterToken)));
});

function futureDate(daysFromNow: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

describe('Bookings API', () => {
  test('POST /bookings — creates booking and emits booking.created event', async () => {
    const startTime = futureDate(5, 10);
    const endTime = futureDate(5, 12);

    const res = await fetch(`${API_URL}/api/v1/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spotterToken}` },
      body: JSON.stringify({ listingId: testListingId, startTime, endTime }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { bookingId: string; status: string };
    expect(body.bookingId).toBeTruthy();
    expect(['confirmed', 'pending']).toContain(body.status);
    createdBookingIds.push(body.bookingId);
  });

  test('POST /bookings — idempotency: same idempotency key returns same booking', async () => {
    const idempotencyKey = `idem-${Date.now()}`;
    const startTime = futureDate(6, 9);
    const endTime = futureDate(6, 11);
    const payload = JSON.stringify({ listingId: testListingId, startTime, endTime, idempotencyKey });
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${spotterToken}` };

    const res1 = await fetch(`${API_URL}/api/v1/bookings`, { method: 'POST', headers, body: payload });
    expect(res1.status).toBe(201);
    const b1 = await res1.json() as { bookingId: string };
    createdBookingIds.push(b1.bookingId);

    const res2 = await fetch(`${API_URL}/api/v1/bookings`, { method: 'POST', headers, body: payload });
    expect([200, 201]).toContain(res2.status);
    const b2 = await res2.json() as { bookingId: string };
    expect(b2.bookingId).toBe(b1.bookingId);
  });

  test('POST /bookings — conflict: overlapping booking returns 409', async () => {
    // Book day 7, 10:00–12:00
    const startTime = futureDate(7, 10);
    const endTime = futureDate(7, 12);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${spotterToken}` };

    const res1 = await fetch(`${API_URL}/api/v1/bookings`, {
      method: 'POST', headers,
      body: JSON.stringify({ listingId: testListingId, startTime, endTime }),
    });
    expect(res1.status).toBe(201);
    const b1 = await res1.json() as { bookingId: string };
    createdBookingIds.push(b1.bookingId);

    // Attempt overlapping booking: 11:00–13:00 (same listing, same day)
    const overlapRes = await fetch(`${API_URL}/api/v1/bookings`, {
      method: 'POST', headers: { ...headers, Authorization: `Bearer ${spotter2Token}` },
      body: JSON.stringify({
        listingId: testListingId,
        startTime: futureDate(7, 11),
        endTime: futureDate(7, 13),
      }),
    });
    expect(overlapRes.status).toBe(409);
  });

  test('PUT /bookings/{id}/modify — extends end time successfully', async () => {
    const startTime = futureDate(10, 14);
    const originalEnd = futureDate(10, 16);
    const extendedEnd = futureDate(10, 17);

    const createRes = await fetch(`${API_URL}/api/v1/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spotterToken}` },
      body: JSON.stringify({ listingId: testListingId, startTime, endTime: originalEnd }),
    });
    const booking = await createRes.json() as { bookingId: string };
    createdBookingIds.push(booking.bookingId);

    const modRes = await fetch(`${API_URL}/api/v1/bookings/${booking.bookingId}/modify`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spotterToken}` },
      body: JSON.stringify({ endTime: extendedEnd }),
    });
    expect(modRes.status).toBe(200);
    const modBody = await modRes.json() as { endTime: string };
    expect(modBody.endTime).toBe(extendedEnd);
  });

  test('POST /bookings/{id}/cancel — >48h in future: full refund', async () => {
    const startTime = futureDate(14, 10);
    const endTime = futureDate(14, 12);

    const createRes = await fetch(`${API_URL}/api/v1/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spotterToken}` },
      body: JSON.stringify({ listingId: testListingId, startTime, endTime }),
    });
    const booking = await createRes.json() as { bookingId: string; totalAmount: number };

    const cancelRes = await fetch(`${API_URL}/api/v1/bookings/${booking.bookingId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${spotterToken}` },
    });
    expect(cancelRes.status).toBe(200);
    const cancelBody = await cancelRes.json() as { refundAmount: number };
    expect(cancelBody.refundAmount).toBe(booking.totalAmount);
  });

  test('POST /bookings/{id}/cancel — host cancel: always full refund', async () => {
    const startTime = futureDate(3, 10); // within 48h threshold for spotter
    const endTime = futureDate(3, 12);

    const createRes = await fetch(`${API_URL}/api/v1/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${spotterToken}` },
      body: JSON.stringify({ listingId: testListingId, startTime, endTime }),
    });
    const booking = await createRes.json() as { bookingId: string; totalAmount: number };

    // Host cancels → full refund regardless of timing
    const cancelRes = await fetch(`${API_URL}/api/v1/bookings/${booking.bookingId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    expect(cancelRes.status).toBe(200);
    const cancelBody = await cancelRes.json() as { refundAmount: number };
    expect(cancelBody.refundAmount).toBe(booking.totalAmount);
  });
});
