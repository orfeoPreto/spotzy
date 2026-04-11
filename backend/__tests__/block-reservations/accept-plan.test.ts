import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));

const mockDdbSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
    GetCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Get' })),
    QueryCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Query' })),
    UpdateCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Update' })),
    TransactWriteCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'TransactWrite' })),
    PutCommand: jest.fn(),
  };
});

// Mock Stripe
const mockPiCreate = jest.fn();
const mockPiCancel = jest.fn();
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: mockPiCreate,
      cancel: mockPiCancel,
    },
  }));
});

// Mock the Stripe secret loader so no Secrets Manager call is made in tests
jest.mock('../../functions/payments/shared/stripe-helpers', () => ({
  getStripeSecretKey: jest.fn().mockResolvedValue('sk_test_fake'),
}));

// Mock Scheduler
const mockSchedulerSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn().mockImplementation(() => ({ send: mockSchedulerSend })),
  CreateScheduleCommand: jest.fn().mockImplementation((params: any) => params),
}));

// Mock EventBridge
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  PutEventsCommand: jest.fn(),
}));

jest.mock('ulid', () => ({ ulid: jest.fn().mockReturnValue('ALLOC01TESTID0000000000000') }));

import { handler } from '../../functions/block-reservations/accept-plan/index';

function mockEvent(userId: string, reqId: string, body: any): APIGatewayProxyEvent {
  return {
    requestContext: {
      authorizer: { claims: { sub: userId, email: `${userId}@test.com` } },
      requestId: 'test-req-id',
    } as any,
    body: JSON.stringify(body),
    headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false,
    path: `/api/v1/block-requests/${reqId}/accept`,
    pathParameters: { reqId },
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

const blockReq = {
  PK: 'BLOCKREQ#req-1', SK: 'METADATA',
  reqId: 'req-1', ownerUserId: 'user-1', status: 'PLANS_PROPOSED',
  startsAt: '2026-04-20T09:00:00Z', endsAt: '2026-04-22T18:00:00Z',
  bayCount: 5,
  pendingGuests: null,
  preferences: {
    minPoolRating: null, requireVerifiedSpotManager: null,
    noIndividualSpots: true, maxCounterparties: null,
    maxWalkingTimeFromPoint: null, clusterTogether: null,
  },
  proposedPlans: [{
    planIndex: 0,
    rationale: 'Lowest cost',
    worstCaseEur: 125,
    bestCaseEur: 37.5,
    projectedCaseEur: 98.75,
    allocations: [{
      poolListingId: 'pool-a', spotManagerUserId: 'sm-1',
      contributedBayCount: 5, riskShareMode: 'PERCENTAGE',
      riskShareRate: 0.30, pricePerBayEur: 25,
      walkingDistanceMeters: null, poolRating: 4.5,
    }],
  }],
  proposedPlansComputedAt: new Date().toISOString(),
};

describe('block-accept-plan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPiCreate.mockResolvedValue({ id: 'pi_validate_123' });
    mockPiCancel.mockResolvedValue({});
  });

  const v2xPool = { isPool: true, status: 'live', blockReservationsOptedIn: true };
  const buildActiveBays = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      bayId: `bay-${String(i + 1).padStart(3, '0')}`,
      status: 'ACTIVE',
    }));

  test('happy path — validation charge, BLOCKALLOC#s written, CONFIRMED', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') {
        if (cmd.Key?.SK === 'METADATA' && cmd.Key?.PK?.startsWith('BLOCKREQ#')) {
          return Promise.resolve({ Item: blockReq });
        }
        if (cmd.Key?.PK?.startsWith('LISTING#')) {
          return Promise.resolve({ Item: v2xPool });
        }
        if (cmd.Key?.SK === 'PROFILE') {
          return Promise.resolve({ Item: { stripeCustomerId: 'cus_123' } });
        }
        return Promise.resolve({ Item: null });
      }
      if (cmd._type === 'Query') {
        return Promise.resolve({ Items: buildActiveBays(20) });
      }
      return Promise.resolve({});
    });

    const result = await handler(mockEvent('user-1', 'req-1', { planIndex: 0 }), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.status).toBe('CONFIRMED');
    expect(body.validationChargeId).toBe('pi_validate_123');
    expect(mockPiCreate).toHaveBeenCalledTimes(1);
    expect(mockPiCancel).toHaveBeenCalledTimes(1);
    expect(mockSchedulerSend).toHaveBeenCalledTimes(3);
  });

  test('402 PAYMENT_DECLINED if Stripe validation fails', async () => {
    mockPiCreate.mockRejectedValue(new Error('card_declined'));
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') {
        if (cmd.Key?.PK?.startsWith('BLOCKREQ#')) return Promise.resolve({ Item: blockReq });
        if (cmd.Key?.PK?.startsWith('LISTING#')) return Promise.resolve({ Item: v2xPool });
        return Promise.resolve({ Item: { stripeCustomerId: 'cus_123' } });
      }
      if (cmd._type === 'Query') return Promise.resolve({ Items: buildActiveBays(20) });
      return Promise.resolve({});
    });

    const result = await handler(mockEvent('user-1', 'req-1', { planIndex: 0 }), {} as any, () => {});
    expect(result!.statusCode).toBe(402);
    expect(JSON.parse(result!.body).error).toBe('PAYMENT_DECLINED');
  });

  test('409 PLANS_EXPIRED if plans are stale', async () => {
    const staleReq = {
      ...blockReq,
      proposedPlansComputedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    };
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') {
        if (cmd.Key?.PK?.startsWith('BLOCKREQ#')) return Promise.resolve({ Item: staleReq });
        return Promise.resolve({ Item: {} });
      }
      return Promise.resolve({});
    });

    const result = await handler(mockEvent('user-1', 'req-1', { planIndex: 0 }), {} as any, () => {});
    expect(result!.statusCode).toBe(409);
    expect(JSON.parse(result!.body).error).toBe('PLANS_EXPIRED');
  });

  test('403 if non-owner attempts to accept', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') {
        if (cmd.Key?.PK?.startsWith('BLOCKREQ#')) return Promise.resolve({ Item: blockReq });
        return Promise.resolve({ Item: {} });
      }
      return Promise.resolve({});
    });

    const result = await handler(mockEvent('user-2', 'req-1', { planIndex: 0 }), {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });

  test('409 if not in PLANS_PROPOSED state', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') {
        if (cmd.Key?.PK?.startsWith('BLOCKREQ#')) return Promise.resolve({ Item: { ...blockReq, status: 'CONFIRMED' } });
        return Promise.resolve({ Item: {} });
      }
      return Promise.resolve({});
    });

    const result = await handler(mockEvent('user-1', 'req-1', { planIndex: 0 }), {} as any, () => {});
    expect(result!.statusCode).toBe(409);
  });

  test('400 if planIndex out of bounds', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') {
        if (cmd.Key?.PK?.startsWith('BLOCKREQ#')) return Promise.resolve({ Item: blockReq });
        if (cmd.Key?.PK?.startsWith('POOL#')) return Promise.resolve({ Item: { status: 'ACTIVE' } });
        return Promise.resolve({ Item: { stripeCustomerId: 'cus_123' } });
      }
      return Promise.resolve({});
    });

    const result = await handler(mockEvent('user-1', 'req-1', { planIndex: 5 }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('INVALID_PLAN_INDEX');
  });

  test('409 PLAN_STALE if pool no longer active', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') {
        if (cmd.Key?.PK?.startsWith('BLOCKREQ#')) return Promise.resolve({ Item: blockReq });
        if (cmd.Key?.PK?.startsWith('POOL#')) return Promise.resolve({ Item: { status: 'INACTIVE' } });
        return Promise.resolve({ Item: { stripeCustomerId: 'cus_123' } });
      }
      return Promise.resolve({});
    });

    const result = await handler(mockEvent('user-1', 'req-1', { planIndex: 0 }), {} as any, () => {});
    expect(result!.statusCode).toBe(409);
    expect(JSON.parse(result!.body).error).toBe('PLAN_STALE');
  });
});
