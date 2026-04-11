import { handler } from '../../functions/agent/webhook-delivery/index';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'QueryCommand' })),
    __mockSend: mockSend,
  };
});

const mockSend = require('@aws-sdk/lib-dynamodb').__mockSend;

// Mock global fetch
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function makeEventSubRow(userId: string, webhookId: string, eventType: string, active = true) {
  return {
    PK: `EVENT_SUB#${eventType}`,
    SK: `WEBHOOK#${userId}#${webhookId}`,
    webhookId,
    userId,
    url: `https://${userId}.example.com/hook`,
    signingSecretHash: `secret_${webhookId}`,
    active,
    registeredAt: '2026-01-01T00:00:00Z',
  };
}

describe('webhook-delivery with EVENT_SUB# index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  test('dispatches to all webhooks subscribed to the event type, regardless of user', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEventSubRow('user-a', 'wh-a', 'booking.confirmed'),
        makeEventSubRow('user-b', 'wh-b', 'booking.confirmed'),
        makeEventSubRow('user-c', 'wh-c', 'booking.confirmed'),
      ],
      LastEvaluatedKey: undefined,
    });

    await handler({
      'detail-type': 'booking.confirmed',
      detail: { bookingId: 'b-1' },
    });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Verify each URL was called
    const calledUrls = mockFetch.mock.calls.map((c: any[]) => c[0]);
    expect(calledUrls).toContain('https://user-a.example.com/hook');
    expect(calledUrls).toContain('https://user-b.example.com/hook');
    expect(calledUrls).toContain('https://user-c.example.com/hook');
  });

  test('event with no subscribers is a no-op (no errors)', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    await handler({
      'detail-type': 'message.received',
      detail: { conversationId: 'c-1' },
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('inactive subscriptions are skipped via the FilterExpression', async () => {
    // FilterExpression active=:t handles this at DynamoDB level,
    // so the query only returns the active subscription
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEventSubRow('user-b', 'wh-b', 'booking.confirmed', true),
      ],
      LastEvaluatedKey: undefined,
    });

    await handler({
      'detail-type': 'booking.confirmed',
      detail: {},
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('Query uses single PK EVENT_SUB#{eventType}', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeEventSubRow('user-a', 'wh-a', 'booking.confirmed')],
      LastEvaluatedKey: undefined,
    });

    await handler({
      'detail-type': 'booking.confirmed',
      detail: {},
    });

    const queryCmd = mockSend.mock.calls[0][0];
    expect(queryCmd.KeyConditionExpression).toBe('PK = :pk');
    expect(queryCmd.ExpressionAttributeValues[':pk']).toBe('EVENT_SUB#booking.confirmed');
    // No user filter in the key condition
    expect(queryCmd.KeyConditionExpression).not.toContain('SK');
  });

  test('includes HMAC signature in delivery headers', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeEventSubRow('user-a', 'wh-a', 'booking.confirmed')],
      LastEvaluatedKey: undefined,
    });

    await handler({
      'detail-type': 'booking.confirmed',
      detail: { bookingId: 'b-1' },
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['X-Spotzy-Signature']).toMatch(/^sha256=/);
    expect(opts.headers['X-Spotzy-Webhook-Id']).toBe('wh-a');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  test('handles delivery failure gracefully without throwing', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeEventSubRow('user-a', 'wh-a', 'booking.confirmed'),
        makeEventSubRow('user-b', 'wh-b', 'booking.confirmed'),
      ],
      LastEvaluatedKey: undefined,
    });

    // First succeeds, second fails
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockRejectedValueOnce(new Error('Connection refused'));

    // Should not throw
    await handler({
      'detail-type': 'booking.confirmed',
      detail: {},
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('paginates through query results', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [makeEventSubRow('user-a', 'wh-a', 'booking.confirmed')],
        LastEvaluatedKey: { PK: 'EVENT_SUB#booking.confirmed', SK: 'WEBHOOK#user-a#wh-a' },
      })
      .mockResolvedValueOnce({
        Items: [makeEventSubRow('user-b', 'wh-b', 'booking.confirmed')],
        LastEvaluatedKey: undefined,
      });

    await handler({
      'detail-type': 'booking.confirmed',
      detail: {},
    });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('skips event with no detail-type', async () => {
    await handler({
      'detail-type': '',
      detail: {},
    });

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
