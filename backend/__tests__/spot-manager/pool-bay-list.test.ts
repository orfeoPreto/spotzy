import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/spot-manager/pool-bay-list/index';
import { TEST_USER_ID } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

const POOL_ID = 'pool_01';

const mockAuthEvent = (userId: string, overrides: any = {}) => ({
  requestContext: { authorizer: { claims: { sub: userId, email: `${userId}@test.com` } }, requestId: 'test-req' },
  body: overrides.body ? JSON.stringify(overrides.body) : null,
  pathParameters: overrides.pathParameters ?? { poolId: POOL_ID },
  queryStringParameters: overrides.queryStringParameters ?? null,
} as any);

const poolListing = {
  PK: `LISTING#${POOL_ID}`, SK: 'METADATA',
  listingId: POOL_ID, hostId: TEST_USER_ID, isPool: true,
};

const bays = [
  { PK: `LISTING#${POOL_ID}`, SK: 'BAY#bay1', bayId: 'bay1', label: 'A1', status: 'ACTIVE', accessInstructions: 'Turn left' },
  { PK: `LISTING#${POOL_ID}`, SK: 'BAY#bay2', bayId: 'bay2', label: 'A2', status: 'ACTIVE', accessInstructions: 'Turn right' },
  { PK: `LISTING#${POOL_ID}`, SK: 'BAY#bay3', bayId: 'bay3', label: 'A3', status: 'TEMPORARILY_CLOSED', accessInstructions: 'Straight' },
];

describe('pool-bay-list', () => {
  it('owner sees all bays with all fields -> 200', async () => {
    ddbMock.on(GetCommand).resolves({ Item: poolListing });
    ddbMock.on(QueryCommand).resolves({ Items: bays });

    const res = await handler(mockAuthEvent(TEST_USER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.bays).toHaveLength(3);
    expect(body.bays[0].accessInstructions).toBe('Turn left');
    expect(body.bays[2].status).toBe('TEMPORARILY_CLOSED');
  });

  it('owner can filter by status', async () => {
    ddbMock.on(GetCommand).resolves({ Item: poolListing });
    ddbMock.on(QueryCommand).resolves({ Items: bays });

    const res = await handler(
      mockAuthEvent(TEST_USER_ID, { queryStringParameters: { status: 'ACTIVE' } }),
      {} as any, () => {}
    );
    const body = JSON.parse(res!.body);
    expect(body.bays).toHaveLength(2);
    expect(body.bays.every((b: any) => b.status === 'ACTIVE')).toBe(true);
  });

  it('non-owner sees only ACTIVE bays without accessInstructions', async () => {
    ddbMock.on(GetCommand).resolves({ Item: poolListing });
    ddbMock.on(QueryCommand).resolves({ Items: bays });

    const res = await handler(mockAuthEvent('other_user'), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.bays).toHaveLength(2); // only ACTIVE
    expect(body.bays[0].accessInstructions).toBeUndefined();
    expect(body.bays[1].accessInstructions).toBeUndefined();
  });

  it('missing auth -> 401', async () => {
    const res = await handler({ requestContext: {}, body: null, pathParameters: { poolId: POOL_ID }, queryStringParameters: null } as any, {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  it('pool not found -> 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(mockAuthEvent(TEST_USER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  it('not a pool listing -> 400', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...poolListing, isPool: false } });
    const res = await handler(mockAuthEvent(TEST_USER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });
});
