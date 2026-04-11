import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock DynamoDB
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));

const mockDdbSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
    GetCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Get' })),
    TransactWriteCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'TransactWrite' })),
    UpdateCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Update' })),
    PutCommand: jest.fn(),
    QueryCommand: jest.fn(),
  };
});

// Mock EventBridge
const mockEbSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEbSend })),
  PutEventsCommand: jest.fn().mockImplementation((params: any) => params),
}));

// Mock ulid
jest.mock('ulid', () => ({ ulid: () => '01ARZ3NDEKTSV4RRFFQ69G5FAV' }));

import { handler } from '../../functions/block-reservations/request-create/index';

function mockEvent(userId: string, body: any): APIGatewayProxyEvent {
  return {
    requestContext: {
      authorizer: { claims: { sub: userId, email: `${userId}@test.com` } },
      requestId: 'test-req-id',
    } as any,
    body: JSON.stringify(body),
    headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false,
    path: '/api/v1/block-requests', pathParameters: null,
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

const validBody = {
  startsAt: '2026-04-15T09:00:00Z',
  endsAt: '2026-04-18T18:00:00Z',
  bayCount: 20,
  preferences: {
    minPoolRating: 4,
    requireVerifiedSpotManager: true,
    noIndividualSpots: true,
    maxCounterparties: 2,
    maxWalkingTimeFromPoint: null,
    clusterTogether: true,
  },
  pendingGuests: null,
  companyName: 'Hotel Metropole SA',
  vatNumber: 'BE0123456789',
};

describe('block-request-create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no existing profile with company info
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') {
        return Promise.resolve({ Item: { PK: 'USER#user-1', SK: 'PROFILE' } });
      }
      return Promise.resolve({});
    });
  });

  test('happy path — creates BLOCKREQ#, publishes event, returns 201', async () => {
    const result = await handler(mockEvent('user-1', validBody), {} as any, () => {});
    expect(result!.statusCode).toBe(201);
    const body = JSON.parse(result!.body);
    expect(body.reqId).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(body.status).toBe('PENDING_MATCH');

    // TransactWriteCommand was called
    expect(mockDdbSend).toHaveBeenCalled();

    // EventBridge event published
    expect(mockEbSend).toHaveBeenCalledTimes(1);
    const ebCall = mockEbSend.mock.calls[0][0];
    expect(ebCall.Entries[0].DetailType).toBe('block.request.created');
  });

  test('subsequent submission reuses companyName + vatNumber from PROFILE', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') {
        return Promise.resolve({
          Item: { PK: 'USER#user-1', SK: 'PROFILE', companyName: 'Existing Corp', vatNumber: 'BE0987654321' },
        });
      }
      return Promise.resolve({});
    });

    const bodyWithout = { ...validBody };
    delete (bodyWithout as any).companyName;
    delete (bodyWithout as any).vatNumber;

    const result = await handler(mockEvent('user-1', bodyWithout), {} as any, () => {});
    expect(result!.statusCode).toBe(201);
  });

  test('first submission requires companyName + vatNumber — 400 SOFT_VERIFICATION_REQUIRED', async () => {
    const bodyMissing = { ...validBody };
    delete (bodyMissing as any).companyName;
    delete (bodyMissing as any).vatNumber;

    const result = await handler(mockEvent('user-no-profile', bodyMissing), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('SOFT_VERIFICATION_REQUIRED');
  });

  test('rejects window exceeding 7 days', async () => {
    const result = await handler(mockEvent('user-1', {
      ...validBody,
      startsAt: '2026-04-15T00:00:00Z',
      endsAt: '2026-04-23T00:00:00Z',
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('WINDOW_EXCEEDS_7_DAYS');
  });

  test('rejects bayCount of 1', async () => {
    const result = await handler(mockEvent('user-1', { ...validBody, bayCount: 1 }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('BAY_COUNT_TOO_LOW');
  });

  test('rejects bayCount over 500', async () => {
    const result = await handler(mockEvent('user-1', { ...validBody, bayCount: 501 }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('BAY_COUNT_TOO_HIGH');
  });

  test('rejects invalid VAT format', async () => {
    const result = await handler(mockEvent('user-1', { ...validBody, vatNumber: 'INVALID' }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('INVALID_VAT_NUMBER');
  });

  test('accepts pendingGuests array', async () => {
    const guests = [
      { name: 'Alice Johnson', email: 'alice@example.com', phone: '+32475111222' },
      { name: 'Bob Smith', email: 'bob@example.com', phone: '+32475333444' },
    ];
    const result = await handler(mockEvent('user-1', { ...validBody, pendingGuests: guests }), {} as any, () => {});
    expect(result!.statusCode).toBe(201);
  });

  test('rejects pendingGuests with invalid email', async () => {
    const guests = [{ name: 'Bad', email: 'not-an-email', phone: '+32475111222' }];
    const result = await handler(mockEvent('user-1', { ...validBody, pendingGuests: guests }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('INVALID_GUEST_EMAIL');
  });

  test('rejects duplicate emails in pendingGuests', async () => {
    const guests = [
      { name: 'A', email: 'same@example.com', phone: '+32475111222' },
      { name: 'B', email: 'same@example.com', phone: '+32475333444' },
    ];
    const result = await handler(mockEvent('user-1', { ...validBody, pendingGuests: guests }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('DUPLICATE_GUEST_EMAIL');
  });

  test('unauthorized without claims', async () => {
    const evt = mockEvent('user-1', validBody);
    (evt.requestContext as any).authorizer = null;
    const result = await handler(evt, {} as any, () => {});
    expect(result!.statusCode).toBe(401);
  });
});
