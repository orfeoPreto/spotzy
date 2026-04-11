import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/spot-manager/pool-bay-update/index';
import { TEST_USER_ID } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

const POOL_ID = 'pool_01';
const BAY_ID = 'bay_01';

const mockAuthEvent = (userId: string, overrides: any = {}) => ({
  requestContext: { authorizer: { claims: { sub: userId, email: `${userId}@test.com` } }, requestId: 'test-req' },
  body: overrides.body ? JSON.stringify(overrides.body) : null,
  pathParameters: overrides.pathParameters ?? { poolId: POOL_ID, bayId: BAY_ID },
  queryStringParameters: overrides.queryStringParameters ?? null,
} as any);

const poolListing = {
  PK: `LISTING#${POOL_ID}`, SK: 'METADATA',
  listingId: POOL_ID, hostId: TEST_USER_ID, isPool: true,
};

const bay = {
  PK: `LISTING#${POOL_ID}`, SK: `BAY#${BAY_ID}`,
  bayId: BAY_ID, label: 'A1', status: 'ACTIVE', poolListingId: POOL_ID,
};

const setupOwnerWithBay = () => {
  ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: poolListing });
  ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: `BAY#${BAY_ID}` } }).resolves({ Item: bay });
  ddbMock.on(QueryCommand).resolves({ Items: [bay] });
  ddbMock.on(UpdateCommand).resolves({ Attributes: { ...bay, label: 'B1', updatedAt: new Date().toISOString() } });
};

describe('pool-bay-update', () => {
  it('updates bay label -> 200', async () => {
    setupOwnerWithBay();
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { label: 'B1' } }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.label).toBe('B1');
  });

  it('missing auth -> 401', async () => {
    const res = await handler({ requestContext: {}, body: '{}', pathParameters: { poolId: POOL_ID, bayId: BAY_ID }, queryStringParameters: null } as any, {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  it('non-owner -> 401', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: { ...poolListing, hostId: 'other_user' } });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { label: 'X' } }), {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  it('pool not found -> 404', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: undefined });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { label: 'X' } }), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  it('bay not found -> 404', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: poolListing });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: `BAY#${BAY_ID}` } }).resolves({ Item: undefined });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { label: 'X' } }), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  it('duplicate label -> 409', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: poolListing });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: `BAY#${BAY_ID}` } }).resolves({ Item: bay });
    ddbMock.on(QueryCommand).resolves({
      Items: [bay, { ...bay, bayId: 'bay_02', SK: 'BAY#bay_02', label: 'B1' }],
    });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { label: 'B1' } }), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    expect(res!.body).toContain('already in use');
  });

  it('TEMPORARILY_CLOSED with active bookings -> 409', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: poolListing });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: `BAY#${BAY_ID}` } }).resolves({ Item: bay });
    // First query = label check (bays), second query = booking check
    let queryCallCount = 0;
    ddbMock.on(QueryCommand).callsFake(() => {
      queryCallCount++;
      // Booking query — return active booking on this bay
      return {
        Items: [{
          bookingId: 'bk1', poolSpotId: BAY_ID, status: 'ACTIVE',
          endTime: new Date(Date.now() + 86400000).toISOString(),
        }],
      };
    });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { status: 'TEMPORARILY_CLOSED' } }), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    expect(res!.body).toContain('active bookings');
  });

  it('PERMANENTLY_REMOVED with upcoming bookings -> 409', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: poolListing });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: `BAY#${BAY_ID}` } }).resolves({ Item: bay });
    ddbMock.on(QueryCommand).resolves({
      Items: [{
        bookingId: 'bk1', poolSpotId: BAY_ID, status: 'CONFIRMED',
        endTime: new Date(Date.now() + 86400000).toISOString(),
      }],
    });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { status: 'PERMANENTLY_REMOVED' } }), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    expect(res!.body).toContain('upcoming bookings');
  });

  it('invalid status value -> 400', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: poolListing });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: `BAY#${BAY_ID}` } }).resolves({ Item: bay });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { status: 'INVALID' } }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('no update fields -> 400', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: poolListing });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: `BAY#${BAY_ID}` } }).resolves({ Item: bay });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: {} }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('No update fields');
  });

  it('not a pool listing -> 400', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({
      Item: { ...poolListing, isPool: false },
    });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { label: 'X' } }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });
});
