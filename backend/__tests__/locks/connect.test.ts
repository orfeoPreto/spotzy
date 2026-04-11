import { handler } from '../../functions/locks/connect/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: jest.fn(), GetCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;

function mockEvent(userId: string, body: any, listingId: string): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { claims: { sub: userId } }, requestId: 'test' } as any,
    body: JSON.stringify(body),
    headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false,
    path: '/api/v1/listings/lst-1/lock', pathParameters: { id: listingId },
    queryStringParameters: null, multiValueQueryStringParameters: null, stageVariables: null, resource: '',
  };
}

describe('lock-connect', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('connects a lock to a listing', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: { listingId: 'lst-1', hostId: 'user-1' } }) // listing check
      .mockResolvedValue({}); // put

    const result = await handler(mockEvent('user-1', { provider: 'SEAM', lockId: 'dev-abc' }, 'lst-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.lockId).toBe('dev-abc');
    expect(body.status).toBe('CONNECTED');
  });

  test('rejects non-owner', async () => {
    ddbMock.mockResolvedValueOnce({ Item: { listingId: 'lst-1', hostId: 'user-2' } });
    const result = await handler(mockEvent('user-1', { provider: 'SEAM', lockId: 'dev-abc' }, 'lst-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });

  test('returns 404 for non-existent listing', async () => {
    ddbMock.mockResolvedValueOnce({ Item: undefined });
    const result = await handler(mockEvent('user-1', { provider: 'SEAM', lockId: 'dev-abc' }, 'lst-x'), {} as any, () => {});
    expect(result!.statusCode).toBe(404);
  });
});
