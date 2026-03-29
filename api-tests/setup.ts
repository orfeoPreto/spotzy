export const API_URL = process.env.TEST_API_URL ?? 'https://api-test.spotzy.com';

// Pre-created test users — credentials from Secrets Manager in CI
export const TEST_HOST = {
  email: 'host@test.spotzy.com',
  password: process.env.TEST_HOST_PASSWORD!,
};
export const TEST_SPOTTER = {
  email: 'spotter@test.spotzy.com',
  password: process.env.TEST_SPOTTER_PASSWORD!,
};
export const TEST_SPOTTER_2 = {
  email: 'spotter2@test.spotzy.com',
  password: process.env.TEST_SPOTTER_2_PASSWORD!,
};

export async function loginAndGetToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const data = await res.json() as { token: string };
  return data.token;
}

export async function seedTestListing(hostToken: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/listings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` },
    body: JSON.stringify({
      address: 'Rue Neuve 1, Brussels',
      lat: 50.8503,
      lng: 4.3517,
      spotType: 'COVERED_GARAGE',
      pricePerHour: 3.50,
      photos: ['https://example.com/test-photo.jpg'],
    }),
  });
  if (!res.ok) throw new Error(`Seed listing failed: ${res.status}`);
  const listing = await res.json() as { listingId: string };

  // Publish the listing
  await fetch(`${API_URL}/api/v1/listings/${listing.listingId}/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hostToken}` },
  });

  return listing.listingId;
}

export async function cleanupBooking(bookingId: string, token: string): Promise<void> {
  await fetch(`${API_URL}/api/v1/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}
