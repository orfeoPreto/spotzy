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

import { handler } from '../../functions/block-reservations/request-get/index';

function mockEvent(userId: string, reqId: string, groups?: string): APIGatewayProxyEvent {
  const claims: any = { sub: userId, email: `${userId}@test.com` };
  if (groups) claims['cognito:groups'] = groups;
  return {
    requestContext: {
      authorizer: { claims },
      requestId: 'test-req-id',
    } as any,
    body: null,
    headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false,
    path: `/api/v1/block-requests/${reqId}`,
    pathParameters: { reqId },
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

const metadata = {
  PK: 'BLOCKREQ#req-1', SK: 'METADATA',
  reqId: 'req-1', ownerUserId: 'user-1', status: 'CONFIRMED',
  startsAt: '2026-04-15T09:00:00Z', endsAt: '2026-04-18T18:00:00Z',
  bayCount: 10,
};

const allocation = {
  PK: 'BLOCKREQ#req-1', SK: 'BLOCKALLOC#alloc-1',
  allocId: 'alloc-1', poolListingId: 'pool-1', spotManagerUserId: 'sm-1',
  contributedBayCount: 10,
};

const booking = {
  PK: 'BLOCKREQ#req-1', SK: 'BOOKING#bk-1',
  bookingId: 'bk-1', guestName: 'Alice Johnson', guestEmail: 'alice@test.com', guestPhone: '+32475111222',
};

describe('block-request-get', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('owner can fetch their own block request with all children', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [metadata, allocation, booking] });
    const result = await handler(mockEvent('user-1', 'req-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.reqId).toBe('req-1');
    expect(body.allocations).toHaveLength(1);
    expect(body.bookings).toHaveLength(1);
    expect(body.bookings[0].guestEmail).toBe('alice@test.com');
  });

  test('Spot Manager can fetch with PII redacted', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [metadata, allocation, booking] });
    const result = await handler(mockEvent('sm-1', 'req-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.bookings[0].guestEmail).toBe('[redacted]');
    expect(body.bookings[0].guestPhone).toBe('[redacted]');
    expect(body.bookings[0].guestName).toBe('Alice');
  });

  test('admin can fetch any block request', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [metadata, allocation, booking] });
    const result = await handler(mockEvent('admin-1', 'req-1', 'admin'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
  });

  test('non-owner non-Spot-Manager non-admin gets 403', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [metadata, allocation, booking] });
    const result = await handler(mockEvent('random-user', 'req-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });

  test('non-existent reqId returns 404', async () => {
    mockDdbSend.mockResolvedValueOnce({ Items: [] });
    const result = await handler(mockEvent('user-1', 'req-999'), {} as any, () => {});
    expect(result!.statusCode).toBe(404);
  });
});
