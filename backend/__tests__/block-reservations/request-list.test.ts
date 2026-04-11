import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));

const mockDdbSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
    QueryCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Query' })),
    GetCommand: jest.fn(),
    PutCommand: jest.fn(),
  };
});

import { handler } from '../../functions/block-reservations/request-list/index';

function mockEvent(userId: string, qs?: Record<string, string>): APIGatewayProxyEvent {
  return {
    requestContext: {
      authorizer: { claims: { sub: userId, email: `${userId}@test.com` } },
      requestId: 'test-req-id',
    } as any,
    body: null,
    headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false,
    path: '/api/v1/block-requests',
    pathParameters: null,
    queryStringParameters: qs ?? null,
    multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

describe('block-request-list', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns owner block requests', async () => {
    mockDdbSend.mockResolvedValueOnce({
      Items: [
        { PK: 'USER#user-1', SK: 'BLOCKREQ#req-2', reqId: 'req-2', status: 'CONFIRMED' },
        { PK: 'USER#user-1', SK: 'BLOCKREQ#req-1', reqId: 'req-1', status: 'PENDING_MATCH' },
      ],
    });
    const result = await handler(mockEvent('user-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.items).toHaveLength(2);
    expect(body.cursor).toBeNull();
  });

  test('pagination cursor round-trips', async () => {
    const lastKey = { PK: 'USER#user-1', SK: 'BLOCKREQ#req-5' };
    mockDdbSend.mockResolvedValueOnce({
      Items: [{ reqId: 'req-5', status: 'CONFIRMED' }],
      LastEvaluatedKey: lastKey,
    });
    const result = await handler(mockEvent('user-1', { limit: '1' }), {} as any, () => {});
    const body = JSON.parse(result!.body);
    expect(body.cursor).toBeTruthy();

    const decoded = JSON.parse(Buffer.from(body.cursor, 'base64').toString('utf-8'));
    expect(decoded).toEqual(lastKey);
  });

  test('status filter restricts results', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    await handler(mockEvent('user-1', { status: 'CONFIRMED' }), {} as any, () => {});
    expect(mockDdbSend).toHaveBeenCalledTimes(1);
  });

  test('empty result set returns empty array', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    const result = await handler(mockEvent('user-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.items).toEqual([]);
  });

  test('unauthorized without claims', async () => {
    const evt = mockEvent('user-1');
    (evt.requestContext as any).authorizer = null;
    const result = await handler(evt, {} as any, () => {});
    expect(result!.statusCode).toBe(401);
  });
});
