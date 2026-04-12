import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/spot-manager/portfolio/index';
import { TEST_USER_ID } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

const mockAuthEvent = (userId: string, overrides: any = {}) => ({
  requestContext: { authorizer: { claims: { sub: userId, email: `${userId}@test.com` } }, requestId: 'test-req' },
  body: overrides.body ? JSON.stringify(overrides.body) : null,
  pathParameters: overrides.pathParameters ?? null,
  queryStringParameters: overrides.queryStringParameters ?? null,
} as any);

const userProfile = {
  PK: `USER#${TEST_USER_ID}`, SK: 'PROFILE',
  spotManagerStatus: 'ACTIVE',
};

const poolListing = {
  listingId: 'pool_01', address: '100 Pool Lane', status: 'published',
  isPool: true, hostId: TEST_USER_ID,
  GSI1PK: `HOST#${TEST_USER_ID}`, GSI1SK: 'LISTING#pool_01',
};

const standardListing = {
  listingId: 'listing_01', address: '200 Standard St', status: 'published',
  hostId: TEST_USER_ID,
  GSI1PK: `HOST#${TEST_USER_ID}`, GSI1SK: 'LISTING#listing_01',
};

const futureEnd = new Date(Date.now() + 86400000).toISOString();
const pastEnd = new Date(Date.now() - 86400000).toISOString();
const recentCreated = new Date().toISOString();

describe('portfolio', () => {
  it('returns aggregate metrics for pool + standard listings -> 200', async () => {
    // GetCommand for user profile
    ddbMock.on(GetCommand).resolves({ Item: userProfile });

    // GSI1 query for host listings
    ddbMock.on(QueryCommand, {
      IndexName: 'GSI1',
    }).resolves({ Items: [poolListing, standardListing] });

    // Bookings for pool_01
    ddbMock.on(QueryCommand, {
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': 'LISTING#pool_01', ':prefix': 'BOOKING#' },
    }).resolves({
      Items: [
        { bookingId: 'bk1', status: 'COMPLETED', hostPayout: 25.50, poolSpotId: 'bay1', endTime: pastEnd, createdAt: recentCreated },
        { bookingId: 'bk2', status: 'ACTIVE', hostPayout: 30.00, poolSpotId: 'bay1', endTime: futureEnd, createdAt: recentCreated },
      ],
    });

    // Bays for pool_01
    ddbMock.on(QueryCommand, {
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': 'LISTING#pool_01', ':prefix': 'BAY#' },
    }).resolves({
      Items: [
        { bayId: 'bay1', label: 'A1', status: 'ACTIVE' },
        { bayId: 'bay2', label: 'A2', status: 'ACTIVE' },
        { bayId: 'bay3', label: 'A3', status: 'TEMPORARILY_CLOSED' },
      ],
    });

    // Bookings for listing_01
    ddbMock.on(QueryCommand, {
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': 'LISTING#listing_01', ':prefix': 'BOOKING#' },
    }).resolves({
      Items: [
        { bookingId: 'bk3', status: 'COMPLETED', hostPayout: 10.00, endTime: pastEnd, createdAt: recentCreated },
      ],
    });

    const res = await handler(mockAuthEvent(TEST_USER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.summary.totalListings).toBe(2);
    expect(body.summary.totalPools).toBe(1);
    expect(body.summary.totalBays).toBe(2); // only ACTIVE
    expect(body.listings).toHaveLength(2);
  });

  it('missing auth -> 401', async () => {
    const res = await handler({ requestContext: {}, body: null, pathParameters: null, queryStringParameters: null } as any, {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  it('user without spotManagerStatus -> 400', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { PK: `USER#${TEST_USER_ID}`, SK: 'PROFILE' } });
    const res = await handler(mockAuthEvent(TEST_USER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).error).toBe('SPOT_MANAGER_STATUS_REQUIRED');
  });

  it('returns empty portfolio for user with no listings', async () => {
    ddbMock.on(GetCommand).resolves({ Item: userProfile });
    ddbMock.on(QueryCommand, { IndexName: 'GSI1' }).resolves({ Items: [] });

    const res = await handler(mockAuthEvent(TEST_USER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.summary.totalListings).toBe(0);
    expect(body.summary.totalPools).toBe(0);
    expect(body.summary.totalBays).toBe(0);
    expect(body.summary.mtdRevenue).toBe(0);
    expect(body.summary.allTimeRevenue).toBe(0);
    expect(body.listings).toHaveLength(0);
  });

  it('pool listing breakdown includes bay status grid', async () => {
    ddbMock.on(GetCommand).resolves({ Item: userProfile });
    ddbMock.on(QueryCommand, { IndexName: 'GSI1' }).resolves({ Items: [poolListing] });
    ddbMock.on(QueryCommand, {
      ExpressionAttributeValues: { ':pk': 'LISTING#pool_01', ':prefix': 'BOOKING#' },
    }).resolves({ Items: [] });
    ddbMock.on(QueryCommand, {
      ExpressionAttributeValues: { ':pk': 'LISTING#pool_01', ':prefix': 'BAY#' },
    }).resolves({
      Items: [
        { bayId: 'b1', label: 'A1', status: 'ACTIVE' },
        { bayId: 'b2', label: 'A2', status: 'PERMANENTLY_REMOVED' },
      ],
    });

    const res = await handler(mockAuthEvent(TEST_USER_ID), {} as any, () => {});
    const body = JSON.parse(res!.body);
    const poolBreakdown = body.listings[0];
    expect(poolBreakdown.isPool).toBe(true);
    expect(poolBreakdown.bayStatusGrid).toHaveLength(2);
    expect(poolBreakdown.bayStatusGrid[0]).toEqual({ bayId: 'b1', label: 'A1', status: 'ACTIVE' });
    expect(poolBreakdown.activeBays).toBe(1);
  });
});
