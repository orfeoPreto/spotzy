import { handler } from '../../functions/pools/create/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: jest.fn(), GetCommand: jest.fn(), QueryCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;

function mockEvent(userId: string, body: any): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { claims: { sub: userId } }, requestId: 'test' } as any,
    body: JSON.stringify(body),
    headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false,
    path: '/api/v1/pools', pathParameters: null, queryStringParameters: null,
    multiValueQueryStringParameters: null, stageVariables: null, resource: '',
  };
}

describe('pool-create', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('creates pool with valid data', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: { userId: 'user-1', stripeConnectEnabled: true } }) // user check
      .mockResolvedValue({}); // puts

    const result = await handler(mockEvent('user-1', {
      name: 'Test Pool', address: 'Rue de la Loi 42', spotType: 'COVERED_GARAGE', pricePerHour: 3.5,
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(201);
    const body = JSON.parse(result!.body);
    expect(body.poolId).toBeDefined();
    expect(body.status).toBe('ACTIVE');
  });

  test('requires name and address', async () => {
    const result = await handler(mockEvent('user-1', { name: 'Test' }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
  });

  test('requires Host persona', async () => {
    ddbMock.mockResolvedValueOnce({ Item: { userId: 'user-1', stripeConnectEnabled: false } });
    const result = await handler(mockEvent('user-1', { name: 'Test', address: 'Addr' }), {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });
});
