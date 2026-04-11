import { handler } from '../../functions/block-reservations/guest-add/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: jest.fn(), QueryCommand: jest.fn(), UpdateCommand: jest.fn(),
    TransactWriteCommand: jest.fn(),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/client-ses', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    SESClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    SendEmailCommand: jest.fn(),
  };
});

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;

function mockEvent(userId: string, reqId: string, body: any): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { claims: { sub: userId, email: 'test@example.com' } }, requestId: 'test' } as any,
    body: JSON.stringify(body),
    headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false,
    path: `/api/v1/block-requests/${reqId}/guests`, pathParameters: { reqId },
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

describe('block-guest-add', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('adds guests to a confirmed request', async () => {
    const futureStart = new Date(Date.now() + 48 * 3600_000).toISOString();
    const futureEnd = new Date(Date.now() + 72 * 3600_000).toISOString();

    ddbMock.mockResolvedValueOnce({
      Items: [
        {
          SK: 'METADATA', reqId: 'req-1', ownerUserId: 'user-1', status: 'CONFIRMED',
          startsAt: futureStart, endsAt: futureEnd, bayCount: 5,
        },
        {
          SK: 'BLOCKALLOC#alloc-1', allocId: 'alloc-1', contributedBayCount: 5,
          poolListingId: 'pool-1', assignedBayIds: ['bay-1', 'bay-2', 'bay-3', 'bay-4', 'bay-5'],
        },
      ],
    });
    ddbMock.mockResolvedValue({});

    const result = await handler(mockEvent('user-1', 'req-1', {
      guests: [
        { name: 'Alice', email: 'alice@test.com', phone: '+32470000001' },
        { name: 'Bob', email: 'bob@test.com', phone: '+32470000002' },
      ],
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(201);
    const body = JSON.parse(result!.body);
    expect(body.addedCount).toBe(2);
  });

  test('returns 401 without auth', async () => {
    const event = mockEvent('user-1', 'req-1', { guests: [] });
    (event.requestContext as any).authorizer = null;
    const result = await handler(event, {} as any, () => {});
    expect(result!.statusCode).toBe(401);
  });

  test('returns 400 for duplicate guest emails', async () => {
    const result = await handler(mockEvent('user-1', 'req-1', {
      guests: [
        { name: 'Alice', email: 'alice@test.com', phone: '+32470000001' },
        { name: 'Alice2', email: 'alice@test.com', phone: '+32470000002' },
      ],
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
  });

  test('returns 400 for empty guests array', async () => {
    const result = await handler(mockEvent('user-1', 'req-1', { guests: [] }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
  });
});
