import { handler } from '../../functions/block-reservations/guest-reassign/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: jest.fn(), UpdateCommand: jest.fn(), TransactWriteCommand: jest.fn(),
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

function mockEvent(userId: string, reqId: string, bookingId: string, body: any): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { claims: { sub: userId, email: 'test@example.com' } }, requestId: 'test' } as any,
    body: JSON.stringify(body),
    headers: {}, multiValueHeaders: {}, httpMethod: 'PATCH', isBase64Encoded: false,
    path: `/api/v1/block-requests/${reqId}/guests/${bookingId}`,
    pathParameters: { reqId, bookingId },
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

describe('block-guest-reassign', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('swaps bay within same pool', async () => {
    ddbMock.mockResolvedValueOnce({
      Items: [
        {
          SK: 'METADATA', reqId: 'req-1', ownerUserId: 'user-1', status: 'CONFIRMED',
          startsAt: '2026-05-01T08:00:00Z', endsAt: '2026-05-02T18:00:00Z', auditLog: [],
        },
        {
          SK: 'BLOCKALLOC#alloc-1', allocId: 'alloc-1', poolListingId: 'pool-1',
          assignedBayIds: ['bay-1', 'bay-2', 'bay-3'],
        },
        {
          SK: 'BOOKING#book-1', bookingId: 'book-1', allocId: 'alloc-1',
          bayId: 'bay-1', allocationStatus: 'ALLOCATED', guestEmail: 'alice@test.com',
          guestName: 'Alice', guestPhone: '+32470000001',
        },
      ],
    });
    ddbMock.mockResolvedValue({});

    const result = await handler(mockEvent('user-1', 'req-1', 'book-1', { targetBayId: 'bay-2' }), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.bayId).toBe('bay-2');
  });

  test('updates guest details', async () => {
    ddbMock.mockResolvedValueOnce({
      Items: [
        {
          SK: 'METADATA', reqId: 'req-1', ownerUserId: 'user-1', status: 'CONFIRMED',
          startsAt: '2026-05-01T08:00:00Z', endsAt: '2026-05-02T18:00:00Z',
        },
        {
          SK: 'BOOKING#book-1', bookingId: 'book-1', allocId: 'alloc-1',
          bayId: 'bay-1', guestName: 'Alice', guestEmail: 'alice@test.com', guestPhone: '+32470000001',
        },
      ],
    });
    ddbMock.mockResolvedValue({});

    const result = await handler(mockEvent('user-1', 'req-1', 'book-1', {
      guestName: 'Alice Updated', guestEmail: 'alice.new@test.com',
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
  });

  test('returns 403 for non-owner', async () => {
    ddbMock.mockResolvedValueOnce({
      Items: [
        { SK: 'METADATA', reqId: 'req-1', ownerUserId: 'user-2', status: 'CONFIRMED' },
      ],
    });
    const result = await handler(mockEvent('user-1', 'req-1', 'book-1', { targetBayId: 'bay-2' }), {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });

  test('returns 400 for occupied bay', async () => {
    ddbMock.mockResolvedValueOnce({
      Items: [
        {
          SK: 'METADATA', reqId: 'req-1', ownerUserId: 'user-1', status: 'CONFIRMED',
          startsAt: '2026-05-01T08:00:00Z', endsAt: '2026-05-02T18:00:00Z',
        },
        {
          SK: 'BLOCKALLOC#alloc-1', allocId: 'alloc-1',
          assignedBayIds: ['bay-1', 'bay-2'],
        },
        {
          SK: 'BOOKING#book-1', bookingId: 'book-1', allocId: 'alloc-1',
          bayId: 'bay-1', allocationStatus: 'ALLOCATED',
        },
        {
          SK: 'BOOKING#book-2', bookingId: 'book-2', allocId: 'alloc-1',
          bayId: 'bay-2', allocationStatus: 'ALLOCATED',
        },
      ],
    });

    const result = await handler(mockEvent('user-1', 'req-1', 'book-1', { targetBayId: 'bay-2' }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
  });
});
