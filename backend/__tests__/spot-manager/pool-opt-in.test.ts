jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));

const mockDdbSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
  GetCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Get' })),
  TransactWriteCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'TransactWrite' })),
}));

import { handler } from '../../functions/spot-manager/pool-opt-in';

const TEST_USER_ID = 'user-1';
const TEST_POOL_ID = 'pool-a';

const mockAuthEvent = (userId: string, body: any) => ({
  requestContext: { authorizer: { claims: { sub: userId, email: `${userId}@test.com` } }, requestId: 'req-1' },
  body: JSON.stringify(body),
  pathParameters: { poolId: TEST_POOL_ID },
}) as any;

const activePool = {
  PK: `LISTING#${TEST_POOL_ID}`,
  SK: 'METADATA',
  listingId: TEST_POOL_ID,
  hostId: TEST_USER_ID,
  isPool: true,
  bayCount: 10,
  blockReservationsOptedIn: false,
};

const activeProfile = {
  PK: `USER#${TEST_USER_ID}`,
  SK: 'PROFILE',
  spotManagerStatus: 'ACTIVE',
  blockReservationCapable: true,
};

describe('pool-opt-in', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('opts the pool in and writes POOL_OPTED_IN projection', async () => {
    let transactParams: any = null;
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get' && cmd.Key.SK === 'METADATA') return Promise.resolve({ Item: activePool });
      if (cmd._type === 'Get' && cmd.Key.SK === 'PROFILE') return Promise.resolve({ Item: activeProfile });
      if (cmd._type === 'TransactWrite') { transactParams = cmd; return Promise.resolve({}); }
      return Promise.resolve({});
    });

    const res = await handler(mockAuthEvent(TEST_USER_ID, {
      blockReservationsOptedIn: true,
      riskShareMode: 'PERCENTAGE',
    }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.blockReservationsOptedIn).toBe(true);
    expect(body.riskShareMode).toBe('PERCENTAGE');

    expect(transactParams).toBeTruthy();
    expect(transactParams.TransactItems).toHaveLength(2);
    expect(transactParams.TransactItems[0].Update).toBeTruthy();
    expect(transactParams.TransactItems[1].Put.Item.PK).toBe('POOL_OPTED_IN');
    expect(transactParams.TransactItems[1].Put.Item.SK).toBe(`LISTING#${TEST_POOL_ID}`);
  });

  it('opts the pool out and deletes the projection', async () => {
    let transactParams: any = null;
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get' && cmd.Key.SK === 'METADATA') {
        return Promise.resolve({ Item: { ...activePool, blockReservationsOptedIn: true, riskShareMode: 'PERCENTAGE' } });
      }
      if (cmd._type === 'TransactWrite') { transactParams = cmd; return Promise.resolve({}); }
      return Promise.resolve({});
    });

    const res = await handler(mockAuthEvent(TEST_USER_ID, { blockReservationsOptedIn: false }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(transactParams.TransactItems[1].Delete).toBeTruthy();
    expect(transactParams.TransactItems[1].Delete.Key.PK).toBe('POOL_OPTED_IN');
  });

  it('rejects opt-in without riskShareMode', async () => {
    const res = await handler(mockAuthEvent(TEST_USER_ID, { blockReservationsOptedIn: true }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('rejects opt-in when spot manager not ACTIVE', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get' && cmd.Key.SK === 'METADATA') return Promise.resolve({ Item: activePool });
      if (cmd._type === 'Get' && cmd.Key.SK === 'PROFILE') {
        return Promise.resolve({ Item: { ...activeProfile, spotManagerStatus: 'STAGED' } });
      }
      return Promise.resolve({});
    });

    const res = await handler(mockAuthEvent(TEST_USER_ID, {
      blockReservationsOptedIn: true,
      riskShareMode: 'PERCENTAGE',
    }), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    expect(JSON.parse(res!.body).error).toBe('SPOT_MANAGER_NOT_ACTIVE');
  });

  it('rejects opt-in when blockReservationCapable is false', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get' && cmd.Key.SK === 'METADATA') return Promise.resolve({ Item: activePool });
      if (cmd._type === 'Get' && cmd.Key.SK === 'PROFILE') {
        return Promise.resolve({ Item: { ...activeProfile, blockReservationCapable: false } });
      }
      return Promise.resolve({});
    });

    const res = await handler(mockAuthEvent(TEST_USER_ID, {
      blockReservationsOptedIn: true,
      riskShareMode: 'PERCENTAGE',
    }), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    expect(JSON.parse(res!.body).error).toBe('RC_INSURANCE_NOT_APPROVED');
  });

  it('rejects non-owner', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get' && cmd.Key.SK === 'METADATA') {
        return Promise.resolve({ Item: { ...activePool, hostId: 'other-user' } });
      }
      return Promise.resolve({});
    });

    const res = await handler(mockAuthEvent(TEST_USER_ID, {
      blockReservationsOptedIn: true,
      riskShareMode: 'PERCENTAGE',
    }), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });

  it('rejects non-pool listing', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get' && cmd.Key.SK === 'METADATA') {
        return Promise.resolve({ Item: { ...activePool, isPool: false } });
      }
      return Promise.resolve({});
    });

    const res = await handler(mockAuthEvent(TEST_USER_ID, {
      blockReservationsOptedIn: true,
      riskShareMode: 'PERCENTAGE',
    }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).error).toBe('NOT_A_POOL_LISTING');
  });

  it('returns 404 when listing not found', async () => {
    mockDdbSend.mockImplementation(() => Promise.resolve({}));
    const res = await handler(mockAuthEvent(TEST_USER_ID, {
      blockReservationsOptedIn: true,
      riskShareMode: 'PERCENTAGE',
    }), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });
});
