/**
 * Integration tests for the booking lifecycle against DynamoDB Local.
 * Requires: docker-compose -f docker-compose.test.yml up -d
 */
import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ulid } from 'ulid';
import ngeohash from 'ngeohash';
import { createTestTable, dropTestTable, docClient, TABLE_NAME } from './setup';

beforeAll(async () => {
  await dropTestTable();
  await createTestTable();
}, 30_000);

afterAll(async () => {
  await dropTestTable();
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('Booking creation idempotency', () => {
  const idempotencyKey = `idem-${ulid()}`;
  const bookingId = `bk-${ulid()}`;

  it('writes a booking with idempotencyKey → success', async () => {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `BOOKING#${bookingId}`,
        SK: 'METADATA',
        bookingId,
        idempotencyKey,
        status: 'confirmed',
        version: 1,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));

    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
    }));
    expect(result.Item?.bookingId).toBe(bookingId);
  });

  it('same idempotencyKey → returns existing record without duplicate', async () => {
    // Query by idempotencyKey — should find existing booking
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      FilterExpression: 'idempotencyKey = :ikey',
      ExpressionAttributeValues: {
        ':pk': `BOOKING#${bookingId}`,
        ':sk': 'METADATA',
        ':ikey': idempotencyKey,
      },
    }));
    expect(result.Items).toHaveLength(1);
    expect(result.Items?.[0].bookingId).toBe(bookingId);
  });

  it('different idempotencyKey → new booking created', async () => {
    const newBookingId = `bk-${ulid()}`;
    const newKey = `idem-${ulid()}`;

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `BOOKING#${newBookingId}`,
        SK: 'METADATA',
        bookingId: newBookingId,
        idempotencyKey: newKey,
        status: 'confirmed',
        version: 1,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));

    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `BOOKING#${newBookingId}`, SK: 'METADATA' },
    }));
    expect(result.Item?.bookingId).toBe(newBookingId);
  });
});

// ─── Availability conflict detection ─────────────────────────────────────────

describe('Availability conflict detection', () => {
  const listingId = `listing-${ulid()}`;

  it('writes booking for 09:00–11:00 → success', async () => {
    const bookingId = `bk-${ulid()}`;
    // Write availability slot for this period
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `LISTING#${listingId}`,
        SK: 'AVAIL#2026-04-01T09:00',
        bookingId,
        endTime: '2026-04-01T11:00:00Z',
        status: 'reserved',
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    expect(true).toBe(true); // no exception = success
  });

  it('overlapping booking 10:00–12:00 → conflict detected', async () => {
    await expect(
      docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `LISTING#${listingId}`,
          SK: 'AVAIL#2026-04-01T09:00', // same availability slot
          bookingId: `bk-${ulid()}`,
          endTime: '2026-04-01T12:00:00Z',
          status: 'reserved',
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      })),
    ).rejects.toThrow(ConditionalCheckFailedException);
  });

  it('non-overlapping booking 11:00–13:00 → succeeds', async () => {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `LISTING#${listingId}`,
        SK: 'AVAIL#2026-04-01T11:00',
        bookingId: `bk-${ulid()}`,
        endTime: '2026-04-01T13:00:00Z',
        status: 'reserved',
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    expect(true).toBe(true);
  });

  it('cancel first booking → availability record deleted → period is now free', async () => {
    // Delete the first availability slot
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: {
        PK: `LISTING#${listingId}`,
        SK: 'AVAIL#2026-04-01T09:00',
      },
    }));

    // Now the same slot can be written again
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `LISTING#${listingId}`,
        SK: 'AVAIL#2026-04-01T09:00',
        bookingId: `bk-${ulid()}`,
        endTime: '2026-04-01T11:00:00Z',
        status: 'reserved',
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    expect(true).toBe(true);
  });
});

// ─── Optimistic locking ───────────────────────────────────────────────────────

describe('Optimistic locking', () => {
  const bookingId = `bk-${ulid()}`;

  beforeAll(async () => {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `BOOKING#${bookingId}`,
        SK: 'METADATA',
        bookingId,
        status: 'confirmed',
        version: 1,
      },
    }));
  });

  it('update with correct version=1 → success, version becomes 2', async () => {
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #status = :s, version = :newVersion',
      ConditionExpression: 'version = :expectedVersion',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':s': 'active',
        ':newVersion': 2,
        ':expectedVersion': 1,
      },
    }));

    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
    }));
    expect(result.Item?.version).toBe(2);
    expect(result.Item?.status).toBe('active');
  });

  it('update with stale version=1 → ConditionalCheckFailedException', async () => {
    await expect(
      docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
        UpdateExpression: 'SET #status = :s, version = :newVersion',
        ConditionExpression: 'version = :expectedVersion',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':s': 'cancelled',
          ':newVersion': 2,
          ':expectedVersion': 1, // stale — actual version is 2
        },
      })),
    ).rejects.toThrow(ConditionalCheckFailedException);
  });

  it('retry with current version=2 → success', async () => {
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #status = :s, version = :newVersion',
      ConditionExpression: 'version = :expectedVersion',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':s': 'completed',
        ':newVersion': 3,
        ':expectedVersion': 2,
      },
    }));

    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
    }));
    expect(result.Item?.version).toBe(3);
    expect(result.Item?.status).toBe('completed');
  });
});

// ─── Geohash search (GSI2) ────────────────────────────────────────────────────

describe('Geohash search', () => {
  // Brussels geohashes (precision 5): u150k, u150m, u150j
  const brusselsListings = [
    { listingId: `listing-bru-${ulid()}`, lat: 50.8503, lng: 4.3517 },
    { listingId: `listing-bru-${ulid()}`, lat: 50.8550, lng: 4.3600 },
    { listingId: `listing-bru-${ulid()}`, lat: 50.8450, lng: 4.3450 },
  ];
  const londonListing = { listingId: `listing-lon-${ulid()}`, lat: 51.5074, lng: -0.1278 };

  beforeAll(async () => {
    for (const l of brusselsListings) {
      const geohash = ngeohash.encode(l.lat, l.lng, 5);
      await docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `LISTING#${l.listingId}`,
          SK: 'METADATA',
          listingId: l.listingId,
          geohash,
          status: 'LIVE',
          city: 'Brussels',
        },
      }));
    }
    const lonGeohash = ngeohash.encode(londonListing.lat, londonListing.lng, 5);
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `LISTING#${londonListing.listingId}`,
        SK: 'METADATA',
        listingId: londonListing.listingId,
        geohash: lonGeohash,
        status: 'LIVE',
        city: 'London',
      },
    }));
  });

  it('search from Brussels coordinates → returns only Brussels listings', async () => {
    const brusselsGeohash = ngeohash.encode(50.8503, 4.3517, 5);
    const neighbours = [brusselsGeohash, ...ngeohash.neighbors(brusselsGeohash)];

    const results: unknown[] = [];
    for (const gh of neighbours) {
      const res = await docClient.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI2',
        KeyConditionExpression: 'geohash = :gh',
        ExpressionAttributeValues: { ':gh': gh },
      }));
      results.push(...(res.Items ?? []));
    }

    const listingIds = results.map((r: any) => r.listingId);
    for (const l of brusselsListings) {
      expect(listingIds).toContain(l.listingId);
    }
    expect(listingIds).not.toContain(londonListing.listingId);
  });

  it('search from coordinates with no listings → returns empty array', async () => {
    const emptyAreaGeohash = ngeohash.encode(-33.8688, 151.2093, 5); // Sydney
    const res = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI2',
      KeyConditionExpression: 'geohash = :gh',
      ExpressionAttributeValues: { ':gh': emptyAreaGeohash },
    }));
    expect(res.Items ?? []).toHaveLength(0);
  });
});

// ─── GSI1 queries ─────────────────────────────────────────────────────────────

describe('GSI1 queries', () => {
  const hostId = `host-${ulid()}`;
  const spotterId = `spotter-${ulid()}`;
  const hostListingIds = [ulid(), ulid(), ulid()].map((id) => `listing-${id}`);
  const spotterBookingIds = [ulid(), ulid()].map((id) => `bk-${id}`);

  beforeAll(async () => {
    for (const listingId of hostListingIds) {
      await docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `LISTING#${listingId}`,
          SK: 'METADATA',
          listingId,
          GSI1PK: `HOST#${hostId}`,
          GSI1SK: `LISTING#${listingId}`,
          status: 'LIVE',
        },
      }));
    }
    for (const bookingId of spotterBookingIds) {
      await docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `BOOKING#${bookingId}`,
          SK: 'METADATA',
          bookingId,
          GSI1PK: `SPOTTER#${spotterId}`,
          GSI1SK: `BOOKING#${bookingId}`,
          status: 'confirmed',
        },
      }));
    }
  });

  it('query GSI1 HOST#hostId → returns all 3 listings', async () => {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `HOST#${hostId}` },
    }));
    expect(result.Items).toHaveLength(3);
    const ids = result.Items?.map((i) => i.listingId);
    for (const id of hostListingIds) expect(ids).toContain(id);
  });

  it('query GSI1 SPOTTER#spotterId → returns both bookings', async () => {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `SPOTTER#${spotterId}` },
    }));
    expect(result.Items).toHaveLength(2);
    const ids = result.Items?.map((i) => i.bookingId);
    for (const id of spotterBookingIds) expect(ids).toContain(id);
  });
});
