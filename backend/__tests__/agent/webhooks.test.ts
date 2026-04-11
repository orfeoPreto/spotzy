import { handler } from '../../functions/agent/webhooks/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'QueryCommand' })),
    GetCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'GetCommand' })),
    TransactWriteCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'TransactWriteCommand' })),
    __mockSend: mockSend,
  };
});

const mockSend = require('@aws-sdk/lib-dynamodb').__mockSend;

function mockEvent(
  userId: string,
  method: string,
  body?: any,
  pathParams?: Record<string, string>,
): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { userId }, requestId: 'test' } as any,
    body: body ? JSON.stringify(body) : null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: method,
    isBase64Encoded: false,
    path: '/api/v1/agent/webhooks',
    pathParameters: pathParams ?? null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
  };
}

describe('webhook-register with EVENT_SUB# index', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('creates user-owned row + EVENT_SUB# rows for each event type', async () => {
    mockSend.mockResolvedValueOnce({}); // TransactWriteCommand succeeds

    const result = await handler(
      mockEvent('user-1', 'POST', {
        url: 'https://example.com/hook',
        events: ['booking.confirmed', 'booking.cancelled'],
      }),
      {} as any,
      () => {},
    );

    expect(result!.statusCode).toBe(201);
    const responseBody = JSON.parse(result!.body);
    expect(responseBody.webhookId).toBeDefined();
    expect(responseBody.signingSecret).toMatch(/^whsec_/);

    // Verify TransactWriteCommand was called with 3 items: 1 user-owned + 2 EVENT_SUB#
    const txCall = mockSend.mock.calls[0][0];
    expect(txCall.TransactItems).toHaveLength(3);

    // First item is the user-owned row
    const userOwned = txCall.TransactItems[0].Put.Item;
    expect(userOwned.PK).toBe('USER#user-1');
    expect(userOwned.SK).toMatch(/^WEBHOOK#/);

    // Second and third are EVENT_SUB# rows
    const sub1 = txCall.TransactItems[1].Put.Item;
    expect(sub1.PK).toBe('EVENT_SUB#booking.confirmed');
    expect(sub1.SK).toMatch(/^WEBHOOK#user-1#/);
    expect(sub1.userId).toBe('user-1');
    expect(sub1.signingSecretHash).toBe(userOwned.signingSecret);
    expect(sub1.active).toBe(true);

    const sub2 = txCall.TransactItems[2].Put.Item;
    expect(sub2.PK).toBe('EVENT_SUB#booking.cancelled');
    expect(sub2.SK).toMatch(/^WEBHOOK#user-1#/);
  });

  test('rejects unknown event types with 400 INVALID_EVENT_TYPE', async () => {
    const result = await handler(
      mockEvent('user-1', 'POST', {
        url: 'https://example.com/hook',
        events: ['booking.confirmed', 'invented.event'],
      }),
      {} as any,
      () => {},
    );

    expect(result!.statusCode).toBe(400);
    const body = JSON.parse(result!.body);
    expect(body.error).toBe('INVALID_EVENT_TYPE');
    expect(body.details.invalidTypes).toEqual(['invented.event']);
  });

  test('returns 500 if TransactWriteCommand fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('TransactionCanceledException'));

    const result = await handler(
      mockEvent('user-1', 'POST', {
        url: 'https://example.com/hook',
        events: ['booking.confirmed'],
      }),
      {} as any,
      () => {},
    );

    expect(result!.statusCode).toBe(500);
  });

  test('returns 400 if url missing', async () => {
    const result = await handler(
      mockEvent('user-1', 'POST', { events: ['booking.confirmed'] }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(400);
  });

  test('returns 400 if events empty', async () => {
    const result = await handler(
      mockEvent('user-1', 'POST', { url: 'https://example.com', events: [] }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(400);
  });
});

describe('webhook-delete with EVENT_SUB# cleanup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('deletes user-owned row + all EVENT_SUB# rows', async () => {
    // GetCommand returns the existing webhook with events
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'USER#user-1',
        SK: 'WEBHOOK#wh-123',
        webhookId: 'wh-123',
        events: ['booking.confirmed', 'message.received'],
        url: 'https://example.com',
        active: true,
      },
    });
    // TransactWriteCommand succeeds
    mockSend.mockResolvedValueOnce({});

    const result = await handler(
      mockEvent('user-1', 'DELETE', null, { webhookId: 'wh-123' }),
      {} as any,
      () => {},
    );

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.webhookId).toBe('wh-123');
    expect(body.deletedAt).toBeDefined();

    // Verify TransactWriteCommand deletes 3 items: 1 user-owned + 2 EVENT_SUB#
    const txCall = mockSend.mock.calls[1][0];
    expect(txCall.TransactItems).toHaveLength(3);
    expect(txCall.TransactItems[0].Delete.Key).toEqual({
      PK: 'USER#user-1', SK: 'WEBHOOK#wh-123',
    });
    expect(txCall.TransactItems[1].Delete.Key).toEqual({
      PK: 'EVENT_SUB#booking.confirmed', SK: 'WEBHOOK#user-1#wh-123',
    });
    expect(txCall.TransactItems[2].Delete.Key).toEqual({
      PK: 'EVENT_SUB#message.received', SK: 'WEBHOOK#user-1#wh-123',
    });
  });

  test('idempotent — deleting already-deleted webhook returns 200', async () => {
    // GetCommand returns no item
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(
      mockEvent('user-1', 'DELETE', null, { webhookId: 'never-existed' }),
      {} as any,
      () => {},
    );

    expect(result!.statusCode).toBe(200);
    // TransactWrite should NOT be called
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('returns 500 if TransactWriteCommand fails during delete', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: 'USER#user-1',
        SK: 'WEBHOOK#wh-123',
        events: ['booking.confirmed'],
      },
    });
    mockSend.mockRejectedValueOnce(new Error('TransactionCanceledException'));

    const result = await handler(
      mockEvent('user-1', 'DELETE', null, { webhookId: 'wh-123' }),
      {} as any,
      () => {},
    );

    expect(result!.statusCode).toBe(500);
  });
});

describe('webhook-list (GET)', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns webhooks without signingSecret', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { PK: 'USER#user-1', SK: 'WEBHOOK#wh-1', webhookId: 'wh-1', url: 'https://a.com', events: ['booking.confirmed'], signingSecret: 'hash', active: true },
      ],
    });

    const result = await handler(mockEvent('user-1', 'GET'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.webhooks).toHaveLength(1);
    expect(body.webhooks[0].signingSecret).toBeUndefined();
    expect(body.webhooks[0].webhookId).toBe('wh-1');
  });
});
