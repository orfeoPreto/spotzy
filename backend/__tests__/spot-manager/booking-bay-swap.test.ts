import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/spot-manager/booking-bay-swap/index';
import { TEST_USER_ID } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

const POOL_ID = 'pool_01';
const BOOKING_ID = 'booking_01';
const CURRENT_BAY_ID = 'bay_01';
const TARGET_BAY_ID = 'bay_02';

const mockAuthEvent = (userId: string, overrides: any = {}) => ({
  requestContext: { authorizer: { claims: { sub: userId, email: `${userId}@test.com` } }, requestId: 'test-req' },
  body: overrides.body ? JSON.stringify(overrides.body) : null,
  pathParameters: overrides.pathParameters ?? { bookingId: BOOKING_ID },
  queryStringParameters: overrides.queryStringParameters ?? null,
} as any);

const futureStart = new Date(Date.now() + 3600000).toISOString();
const futureEnd = new Date(Date.now() + 7200000).toISOString();

const booking = {
  PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA',
  bookingId: BOOKING_ID, listingId: POOL_ID, poolSpotId: CURRENT_BAY_ID,
  spotterId: 'spotter_01', hostId: TEST_USER_ID,
  startTime: futureStart, endTime: futureEnd, status: 'CONFIRMED',
};

const poolListing = {
  PK: `LISTING#${POOL_ID}`, SK: 'METADATA',
  listingId: POOL_ID, hostId: TEST_USER_ID, isPool: true,
};

const targetBay = {
  PK: `LISTING#${POOL_ID}`, SK: `BAY#${TARGET_BAY_ID}`,
  bayId: TARGET_BAY_ID, label: 'A2', status: 'ACTIVE',
};

const setupHappyPath = () => {
  ddbMock.on(GetCommand, { Key: { PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } }).resolves({ Item: booking });
  ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: poolListing });
  ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: `BAY#${TARGET_BAY_ID}` } }).resolves({ Item: targetBay });
  ddbMock.on(QueryCommand).resolves({ Items: [] }); // no conflicting bookings
  ddbMock.on(UpdateCommand).resolves({
    Attributes: { ...booking, poolSpotId: TARGET_BAY_ID, auditLog: [{ action: 'BAY_SWAP' }] },
  });
};

describe('booking-bay-swap', () => {
  it('swaps bay successfully -> 200', async () => {
    setupHappyPath();
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { targetBayId: TARGET_BAY_ID } }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.poolSpotId).toBe(TARGET_BAY_ID);
    expect(body.auditLog).toHaveLength(1);
  });

  it('appends audit log entry via UpdateCommand', async () => {
    setupHappyPath();
    await handler(mockAuthEvent(TEST_USER_ID, { body: { targetBayId: TARGET_BAY_ID } }), {} as any, () => {});
    const calls = ddbMock.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.UpdateExpression).toContain('auditLog');
  });

  it('missing auth -> 401', async () => {
    const res = await handler({ requestContext: {}, body: JSON.stringify({ targetBayId: TARGET_BAY_ID }), pathParameters: { bookingId: BOOKING_ID }, queryStringParameters: null } as any, {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  it('missing targetBayId -> 400', async () => {
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: {} }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('targetBayId');
  });

  it('booking not found -> 404', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } }).resolves({ Item: undefined });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { targetBayId: TARGET_BAY_ID } }), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  it('not a pool booking -> 400', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } }).resolves({
      Item: { ...booking, poolSpotId: undefined },
    });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { targetBayId: TARGET_BAY_ID } }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('not a pool booking');
  });

  it('non-owner -> 401', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } }).resolves({ Item: booking });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({
      Item: { ...poolListing, hostId: 'other_user' },
    });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { targetBayId: TARGET_BAY_ID } }), {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  it('target bay not found -> 400', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } }).resolves({ Item: booking });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: poolListing });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: `BAY#${TARGET_BAY_ID}` } }).resolves({ Item: undefined });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { targetBayId: TARGET_BAY_ID } }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('not found');
  });

  it('target bay not active -> 400', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } }).resolves({ Item: booking });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: poolListing });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: `BAY#${TARGET_BAY_ID}` } }).resolves({
      Item: { ...targetBay, status: 'TEMPORARILY_CLOSED' },
    });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { targetBayId: TARGET_BAY_ID } }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('not active');
  });

  it('target bay has conflicting booking -> 409', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } }).resolves({ Item: booking });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: 'METADATA' } }).resolves({ Item: poolListing });
    ddbMock.on(GetCommand, { Key: { PK: `LISTING#${POOL_ID}`, SK: `BAY#${TARGET_BAY_ID}` } }).resolves({ Item: targetBay });
    ddbMock.on(QueryCommand).resolves({
      Items: [{
        bookingId: 'other_booking', poolSpotId: TARGET_BAY_ID, status: 'CONFIRMED',
        startTime: futureStart, endTime: futureEnd,
      }],
    });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { targetBayId: TARGET_BAY_ID } }), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    expect(res!.body).toContain('not available');
  });
});
