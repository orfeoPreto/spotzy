import { API_URL, TEST_HOST, loginAndGetToken } from './setup';

let hostToken: string;
let draftListingId: string;

beforeAll(async () => {
  hostToken = await loginAndGetToken(TEST_HOST.email, TEST_HOST.password);
});

describe('Listings API', () => {
  test('POST /listings — creates a DRAFT listing', async () => {
    const res = await fetch(`${API_URL}/api/v1/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({
        address: 'Avenue Louise 149, Brussels',
        lat: 50.8365,
        lng: 4.3607,
        spotType: 'COVERED_GARAGE',
        pricePerHour: 3.50,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { listingId: string; status: string };
    expect(body.listingId).toBeTruthy();
    expect(body.status).toBe('DRAFT');
    draftListingId = body.listingId;
  });

  test('POST /listings/{id}/publish — publishes listing with valid photos', async () => {
    // First upload a photo URL
    const urlRes = await fetch(`${API_URL}/api/v1/listings/${draftListingId}/photo-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({ filename: 'test.jpg', contentType: 'image/jpeg' }),
    });
    expect(urlRes.status).toBe(200);

    const pubRes = await fetch(`${API_URL}/api/v1/listings/${draftListingId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    expect(pubRes.status).toBe(200);
    const pubBody = await pubRes.json() as { status: string };
    expect(pubBody.status).toBe('LIVE');
  });

  test('GET /listings/search — returns LIVE listings near Brussels', async () => {
    const res = await fetch(
      `${API_URL}/api/v1/listings/search?lat=50.8503&lng=4.3517&radiusKm=5`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { listings: unknown[]; total: number };
    expect(Array.isArray(body.listings)).toBe(true);
    expect(body.listings.length).toBeGreaterThan(0);
    // All results should be LIVE
    body.listings.forEach((l: any) => expect(l.status).toBe('LIVE'));
  });

  test('GET /listings/search — filters by spotType correctly', async () => {
    const res = await fetch(
      `${API_URL}/api/v1/listings/search?lat=50.8503&lng=4.3517&radiusKm=10&spotType=COVERED_GARAGE`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { listings: any[] };
    body.listings.forEach((l) => expect(l.spotType).toBe('COVERED_GARAGE'));
  });

  test('GET /listings/{id} — returns listing detail', async () => {
    const res = await fetch(`${API_URL}/api/v1/listings/${draftListingId}`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { listingId: string; address: string };
    expect(body.listingId).toBe(draftListingId);
    expect(body.address).toBeTruthy();
  });

  test('GET /listings/{id} — DRAFT listing returns 404 for non-owner', async () => {
    const anotherDraftRes = await fetch(`${API_URL}/api/v1/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({
        address: 'Test Draft Ave 1',
        lat: 50.85,
        lng: 4.35,
        spotType: 'OPEN_LOT',
        pricePerHour: 2.00,
      }),
    });
    const draft = await anotherDraftRes.json() as { listingId: string };

    // Unauthenticated request to a DRAFT listing
    const res = await fetch(`${API_URL}/api/v1/listings/${draft.listingId}`);
    expect(res.status).toBe(404);
  });
});
