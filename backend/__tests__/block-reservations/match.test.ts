jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));

const mockDdbSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
    GetCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Get' })),
    QueryCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Query' })),
    UpdateCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Update' })),
    BatchGetCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'BatchGet' })),
    PutCommand: jest.fn(),
    TransactWriteCommand: jest.fn(),
  };
});

import { handler } from '../../functions/block-reservations/match/index';

const blockReq = {
  PK: 'BLOCKREQ#req-1', SK: 'METADATA',
  reqId: 'req-1', ownerUserId: 'user-1', status: 'PENDING_MATCH',
  bayCount: 10,
  startsAt: '2026-04-15T09:00:00Z', endsAt: '2026-04-18T18:00:00Z',
  preferences: {
    minPoolRating: null,
    requireVerifiedSpotManager: null,
    noIndividualSpots: true,
    maxCounterparties: null,
    maxWalkingTimeFromPoint: null,
    clusterTogether: null,
  },
};

// v2.x pool listing shape (Session 26 LISTING# with isPool=true)
const pool = {
  PK: 'LISTING#pool-a',
  SK: 'METADATA',
  listingId: 'pool-a',
  hostId: 'sm-1',
  isPool: true,
  bayCount: 20,
  pricePerHourEur: 2,
  dailyDiscountPct: 0.60,
  riskShareMode: 'PERCENTAGE',
  rating: 4.5,
  blockReservationsOptedIn: true,
  spotManagerVerified: true,
  status: 'live',
  addressLat: 50.85,
  addressLng: 4.35,
};

const buildBays = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    PK: 'LISTING#pool-a',
    SK: `BAY#bay-${String(i + 1).padStart(3, '0')}`,
    bayId: `bay-${String(i + 1).padStart(3, '0')}`,
    status: 'ACTIVE',
  }));

describe('block-match Lambda', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writes proposedPlans and transitions PENDING_MATCH -> PLANS_PROPOSED', async () => {
    let updateParams: any = null;
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') return Promise.resolve({ Item: blockReq });
      if (cmd._type === 'Query' && cmd.ExpressionAttributeValues?.[':pk'] === 'POOL_OPTED_IN') {
        return Promise.resolve({ Items: [{ listingId: 'pool-a' }] });
      }
      if (cmd._type === 'BatchGet') {
        return Promise.resolve({ Responses: { 'spotzy-main': [pool] } });
      }
      if (cmd._type === 'Query') return Promise.resolve({ Items: buildBays(20) });
      if (cmd._type === 'Update') { updateParams = cmd; return Promise.resolve({}); }
      return Promise.resolve({});
    });

    await handler({ detail: { reqId: 'req-1' } });

    expect(updateParams).toBeTruthy();
    expect(updateParams.ExpressionAttributeValues[':s']).toBe('PLANS_PROPOSED');
    expect(updateParams.ExpressionAttributeValues[':plans']).toBeDefined();
    expect(updateParams.ExpressionAttributeValues[':plans'].length).toBeGreaterThanOrEqual(1);
    const plan = updateParams.ExpressionAttributeValues[':plans'][0];
    expect(plan.allocations[0].poolListingId).toBe('pool-a');
    expect(plan.allocations[0].contributedBayCount).toBe(10);
  });

  test('skips if not PENDING_MATCH', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') {
        return Promise.resolve({ Item: { ...blockReq, status: 'CONFIRMED' } });
      }
      return Promise.resolve({});
    });

    await handler({ detail: { reqId: 'req-1' } });
    const updateCalls = mockDdbSend.mock.calls.filter((c: any) => c[0]._type === 'Update');
    expect(updateCalls).toHaveLength(0);
  });

  test('empty pools transitions to PLANS_PROPOSED with empty array', async () => {
    let updateParams: any = null;
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') return Promise.resolve({ Item: blockReq });
      if (cmd._type === 'Query' && cmd.ExpressionAttributeValues?.[':pk'] === 'POOL_OPTED_IN') {
        return Promise.resolve({ Items: [] });
      }
      if (cmd._type === 'Update') { updateParams = cmd; return Promise.resolve({}); }
      return Promise.resolve({});
    });

    await handler({ detail: { reqId: 'req-1' } });
    expect(updateParams.ExpressionAttributeValues[':plans']).toEqual([]);
  });

  test('respects minPoolRating preference', async () => {
    let updateParams: any = null;
    const reqWithRating = {
      ...blockReq,
      preferences: { ...blockReq.preferences, minPoolRating: 4.8 },
    };
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') return Promise.resolve({ Item: reqWithRating });
      if (cmd._type === 'Query' && cmd.ExpressionAttributeValues?.[':pk'] === 'POOL_OPTED_IN') {
        return Promise.resolve({ Items: [{ listingId: 'pool-a' }] });
      }
      if (cmd._type === 'BatchGet') {
        return Promise.resolve({ Responses: { 'spotzy-main': [{ ...pool, rating: 4.5 }] } });
      }
      if (cmd._type === 'Query') return Promise.resolve({ Items: buildBays(20) });
      if (cmd._type === 'Update') { updateParams = cmd; return Promise.resolve({}); }
      return Promise.resolve({});
    });

    await handler({ detail: { reqId: 'req-1' } });
    expect(updateParams.ExpressionAttributeValues[':plans']).toEqual([]);
  });
});
