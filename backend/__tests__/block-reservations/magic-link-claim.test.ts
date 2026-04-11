import { handler } from '../../functions/block-reservations/magic-link-claim/index';
import { APIGatewayProxyEvent } from 'aws-lambda';
import * as crypto from 'crypto';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: jest.fn(), PutCommand: jest.fn(), QueryCommand: jest.fn(), UpdateCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

process.env.MAGIC_LINK_SECRET = 'test-secret-key-123';

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;

function makeToken(payload: Record<string, unknown>, sign = false): string {
  const data = { ...payload };
  if (sign) {
    const { sig, ...rest } = data as any;
    const computed = crypto
      .createHmac('sha256', 'test-secret-key-123')
      .update(JSON.stringify(rest))
      .digest('base64url');
    (data as any).sig = computed;
  }
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

function mockEvent(token: string): APIGatewayProxyEvent {
  return {
    requestContext: { requestId: 'test' } as any,
    body: null,
    headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false,
    path: `/claim/${token}`, pathParameters: { token },
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

describe('magic-link-claim', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns booking payload for valid token', async () => {
    const futureExp = new Date(Date.now() + 48 * 3600_000).toISOString();
    const token = makeToken({ bookingId: 'book-1', bayId: 'bay-1', reqId: 'req-1', exp: futureExp });

    // GetCommand — booking
    ddbMock.mockResolvedValueOnce({
      Item: {
        bookingId: 'book-1', bayId: 'bay-1', reqId: 'req-1',
        guestName: 'Alice', guestEmail: 'alice@test.com', guestPhone: '+32470000001',
        listingId: 'pool-1', spotterId: null,
      },
    });
    // GetCommand — block request metadata
    ddbMock.mockResolvedValueOnce({
      Item: { reqId: 'req-1', startsAt: '2026-05-01T08:00:00Z', endsAt: '2026-05-02T18:00:00Z' },
    });
    // GetCommand — pool details
    ddbMock.mockResolvedValueOnce({
      Item: { poolListingId: 'pool-1', name: 'Test Pool', address: '123 Street', spotType: 'COVERED_GARAGE' },
    });
    // QueryCommand — existing user check
    ddbMock.mockResolvedValueOnce({ Items: [] });
    // PutCommand — create stub user
    ddbMock.mockResolvedValueOnce({});
    // UpdateCommand — link spotter
    ddbMock.mockResolvedValue({});

    const result = await handler(mockEvent(token), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.bookingId).toBe('book-1');
    expect(body.spotterId).toBeDefined();
    expect(body.pool).toBeDefined();
    expect(body.pool.name).toBe('Test Pool');
  });

  test('returns 410 for expired token', async () => {
    const pastExp = new Date(Date.now() - 3600_000).toISOString();
    const token = makeToken({ bookingId: 'book-1', bayId: 'bay-1', reqId: 'req-1', exp: pastExp });

    const result = await handler(mockEvent(token), {} as any, () => {});
    expect(result!.statusCode).toBe(410);
  });

  test('returns 401 for invalid signature', async () => {
    const futureExp = new Date(Date.now() + 48 * 3600_000).toISOString();
    const payload = { bookingId: 'book-1', bayId: 'bay-1', reqId: 'req-1', exp: futureExp, sig: 'invalid-sig' };
    const token = Buffer.from(JSON.stringify(payload)).toString('base64url');

    const result = await handler(mockEvent(token), {} as any, () => {});
    expect(result!.statusCode).toBe(401);
  });

  test('returns 410 for non-existent booking', async () => {
    const futureExp = new Date(Date.now() + 48 * 3600_000).toISOString();
    const token = makeToken({ bookingId: 'book-missing', bayId: 'bay-1', reqId: 'req-1', exp: futureExp });

    ddbMock.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(mockEvent(token), {} as any, () => {});
    expect(result!.statusCode).toBe(410);
  });

  test('links existing user instead of creating stub', async () => {
    const futureExp = new Date(Date.now() + 48 * 3600_000).toISOString();
    const token = makeToken({ bookingId: 'book-1', bayId: 'bay-1', reqId: 'req-1', exp: futureExp });

    ddbMock.mockResolvedValueOnce({
      Item: {
        bookingId: 'book-1', bayId: 'bay-1', reqId: 'req-1',
        guestName: 'Alice', guestEmail: 'alice@test.com', listingId: 'pool-1', spotterId: null,
      },
    });
    ddbMock.mockResolvedValueOnce({
      Item: { reqId: 'req-1', startsAt: '2026-05-01T08:00:00Z', endsAt: '2026-05-02T18:00:00Z' },
    });
    ddbMock.mockResolvedValueOnce({ Item: { name: 'Pool' } });
    // GSI1 query finds existing user
    ddbMock.mockResolvedValueOnce({ Items: [{ userId: 'existing-user-1' }] });
    ddbMock.mockResolvedValue({});

    const result = await handler(mockEvent(token), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.spotterId).toBe('existing-user-1');
  });
});
