import { handler } from '../../functions/agent/keys/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: jest.fn(),
    TransactWriteCommand: jest.fn(),
    UpdateCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;

function mockEvent(userId: string, method: string, body?: any, pathParams?: any): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { claims: { sub: userId } }, requestId: 'test' } as any,
    body: body ? JSON.stringify(body) : null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: method,
    isBase64Encoded: false,
    path: '/api/v1/agent/keys',
    pathParameters: pathParams ?? null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
  };
}

describe('agent-keys', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('POST creates key and returns full key once', async () => {
    ddbMock.mockResolvedValue({});
    const result = await handler(mockEvent('user-1', 'POST', { name: 'Test key' }), {} as any, () => {});
    expect(result!.statusCode).toBe(201);
    const body = JSON.parse(result!.body);
    expect(body.key).toMatch(/^sk_spotzy_live_[a-f0-9]{32}$/);
    expect(body.keyId).toBeDefined();
    expect(body.name).toBe('Test key');
  });

  test('POST returns 400 if name missing', async () => {
    const result = await handler(mockEvent('user-1', 'POST', {}), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
  });

  test('GET lists keys without values', async () => {
    ddbMock.mockResolvedValue({
      Items: [{ keyId: 'k1', name: 'Key 1', active: true, createdAt: '2026-01-01' }],
    });
    const result = await handler(mockEvent('user-1', 'GET'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].key).toBeUndefined();
    expect(body.keys[0].keyId).toBe('k1');
  });

  test('DELETE revokes key and returns 200', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [{ keyId: 'k1', PK: 'USER#user-1', SK: 'APIKEY#k1' }] })
      .mockResolvedValue({});
    const result = await handler(mockEvent('user-1', 'DELETE', null, { keyId: 'k1' }), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.revokedAt).toBeDefined();
  });

  test('DELETE returns 403 for another users key', async () => {
    ddbMock.mockResolvedValueOnce({ Items: [] });
    const result = await handler(mockEvent('user-1', 'DELETE', null, { keyId: 'k1' }), {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });
});
