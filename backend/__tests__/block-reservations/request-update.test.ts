import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));

const mockDdbSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
    GetCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Get' })),
    UpdateCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Update' })),
    PutCommand: jest.fn(),
    QueryCommand: jest.fn(),
    TransactWriteCommand: jest.fn(),
  };
});

const mockEbSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEbSend })),
  PutEventsCommand: jest.fn().mockImplementation((params: any) => params),
}));

import { handler } from '../../functions/block-reservations/request-update/index';

function mockEvent(userId: string, reqId: string, body: any): APIGatewayProxyEvent {
  return {
    requestContext: {
      authorizer: { claims: { sub: userId, email: `${userId}@test.com` } },
      requestId: 'test-req-id',
    } as any,
    body: JSON.stringify(body),
    headers: {}, multiValueHeaders: {}, httpMethod: 'PATCH', isBase64Encoded: false,
    path: `/api/v1/block-requests/${reqId}`,
    pathParameters: { reqId },
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

const existingReq = {
  PK: 'BLOCKREQ#req-1', SK: 'METADATA',
  reqId: 'req-1', ownerUserId: 'user-1',
  status: 'PENDING_MATCH',
  startsAt: '2026-04-15T09:00:00Z', endsAt: '2026-04-18T18:00:00Z',
  bayCount: 20,
};

describe('block-request-update', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') return Promise.resolve({ Item: existingReq });
      return Promise.resolve({});
    });
  });

  test('owner can update while PENDING_MATCH', async () => {
    const result = await handler(mockEvent('user-1', 'req-1', { bayCount: 30 }), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.status).toBe('PENDING_MATCH');
  });

  test('owner can update while PLANS_PROPOSED', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') return Promise.resolve({ Item: { ...existingReq, status: 'PLANS_PROPOSED' } });
      return Promise.resolve({});
    });
    const result = await handler(mockEvent('user-1', 'req-1', { bayCount: 25 }), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
  });

  test('publishes block.request.updated event', async () => {
    await handler(mockEvent('user-1', 'req-1', { bayCount: 30 }), {} as any, () => {});
    expect(mockEbSend).toHaveBeenCalledTimes(1);
    const ebCall = mockEbSend.mock.calls[0][0];
    expect(ebCall.Entries[0].DetailType).toBe('block.request.updated');
  });

  test('non-owner gets 403', async () => {
    const result = await handler(mockEvent('user-2', 'req-1', { bayCount: 30 }), {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });

  test('CONFIRMED returns 409 REQUEST_LOCKED', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') return Promise.resolve({ Item: { ...existingReq, status: 'CONFIRMED' } });
      return Promise.resolve({});
    });
    const result = await handler(mockEvent('user-1', 'req-1', { bayCount: 30 }), {} as any, () => {});
    expect(result!.statusCode).toBe(409);
    expect(JSON.parse(result!.body).error).toBe('REQUEST_LOCKED');
  });

  test('CANCELLED returns 409 REQUEST_TERMINAL', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') return Promise.resolve({ Item: { ...existingReq, status: 'CANCELLED' } });
      return Promise.resolve({});
    });
    const result = await handler(mockEvent('user-1', 'req-1', { bayCount: 30 }), {} as any, () => {});
    expect(result!.statusCode).toBe(409);
    expect(JSON.parse(result!.body).error).toBe('REQUEST_TERMINAL');
  });

  test('AUTHORISED returns 409 REQUEST_LOCKED', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') return Promise.resolve({ Item: { ...existingReq, status: 'AUTHORISED' } });
      return Promise.resolve({});
    });
    const result = await handler(mockEvent('user-1', 'req-1', { bayCount: 30 }), {} as any, () => {});
    expect(result!.statusCode).toBe(409);
    expect(JSON.parse(result!.body).error).toBe('REQUEST_LOCKED');
  });

  test('non-existent reqId returns 404', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Get') return Promise.resolve({ Item: undefined });
      return Promise.resolve({});
    });
    const result = await handler(mockEvent('user-1', 'req-999', { bayCount: 30 }), {} as any, () => {});
    expect(result!.statusCode).toBe(404);
  });
});
