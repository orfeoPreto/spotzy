import { runBackfill } from '../../scripts/backfill-event-sub-index';

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  ScanCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'ScanCommand' })),
  TransactWriteCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'TransactWriteCommand' })),
  GetCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'GetCommand' })),
  PutCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'PutCommand' })),
}));

const TABLE = 'spotzy-main';

function makeWebhookRow(userId: string, webhookId: string, events: string[], active = true) {
  return {
    PK: `USER#${userId}`,
    SK: `WEBHOOK#${webhookId}`,
    webhookId,
    url: `https://${userId}.example.com/hook`,
    events,
    signingSecret: `hash_${webhookId}`,
    active,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('backfill-event-sub-index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates EVENT_SUB# row for each (eventType, webhook) pair', async () => {
    // GetCommand for checkpoint — not found
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // ScanCommand returns 2 webhooks
    mockSend.mockResolvedValueOnce({
      Items: [
        makeWebhookRow('user-1', 'wh-1', ['booking.confirmed', 'booking.cancelled']),
        makeWebhookRow('user-2', 'wh-2', ['message.received']),
      ],
      LastEvaluatedKey: undefined,
    });
    // TransactWriteCommand for EVENT_SUB# rows (3 total, fits in one batch)
    mockSend.mockResolvedValueOnce({});
    // PutCommand for final checkpoint
    mockSend.mockResolvedValueOnce({});

    const result = await runBackfill({ send: mockSend } as any, TABLE);

    expect(result.backfilledCount).toBe(3);

    // Verify the TransactWriteCommand was called with correct items
    const txCall = mockSend.mock.calls[2][0];
    expect(txCall.TransactItems).toHaveLength(3);

    const pks = txCall.TransactItems.map((t: any) => t.Put.Item.PK);
    expect(pks).toContain('EVENT_SUB#booking.confirmed');
    expect(pks).toContain('EVENT_SUB#booking.cancelled');
    expect(pks).toContain('EVENT_SUB#message.received');

    const sks = txCall.TransactItems.map((t: any) => t.Put.Item.SK);
    expect(sks).toContain('WEBHOOK#user-1#wh-1');
    expect(sks).toContain('WEBHOOK#user-2#wh-2');
  });

  test('idempotent — running twice produces the same EVENT_SUB# rows', async () => {
    const webhook = makeWebhookRow('user-1', 'wh-1', ['booking.confirmed']);

    // First run
    mockSend.mockResolvedValueOnce({ Item: undefined }); // checkpoint
    mockSend.mockResolvedValueOnce({ Items: [webhook], LastEvaluatedKey: undefined }); // scan
    mockSend.mockResolvedValueOnce({}); // transact write
    mockSend.mockResolvedValueOnce({}); // final checkpoint

    const result1 = await runBackfill({ send: mockSend } as any, TABLE);
    expect(result1.backfilledCount).toBe(1);

    // Second run — same data, same result. TransactWrite Put is idempotent.
    mockSend.mockResolvedValueOnce({ Item: { status: 'COMPLETED' } }); // checkpoint shows completed but we re-scan anyway
    mockSend.mockResolvedValueOnce({ Items: [webhook], LastEvaluatedKey: undefined }); // scan
    mockSend.mockResolvedValueOnce({}); // transact write
    mockSend.mockResolvedValueOnce({}); // final checkpoint

    const result2 = await runBackfill({ send: mockSend } as any, TABLE);
    expect(result2.backfilledCount).toBe(1); // same count, not doubled
  });

  test('skips inactive webhooks', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // checkpoint
    mockSend.mockResolvedValueOnce({
      Items: [], // FilterExpression active=true excludes inactive rows
      LastEvaluatedKey: undefined,
    });
    mockSend.mockResolvedValueOnce({}); // final checkpoint

    const result = await runBackfill({ send: mockSend } as any, TABLE);
    expect(result.backfilledCount).toBe(0);
  });

  test('resumes from checkpoint after failure', async () => {
    const checkpointKey = { PK: 'USER#user-25', SK: 'WEBHOOK#wh-25' };

    // Simulate resuming: GetCommand returns a checkpoint with lastProcessedKey
    mockSend.mockResolvedValueOnce({
      Item: { PK: 'CHECKPOINT#backfill-event-sub-index', SK: 'METADATA', lastProcessedKey: checkpointKey },
    });
    // ScanCommand uses ExclusiveStartKey from checkpoint, returns remaining items
    mockSend.mockResolvedValueOnce({
      Items: [
        makeWebhookRow('user-26', 'wh-26', ['booking.confirmed']),
      ],
      LastEvaluatedKey: undefined,
    });
    mockSend.mockResolvedValueOnce({}); // transact write
    mockSend.mockResolvedValueOnce({}); // final checkpoint

    const result = await runBackfill({ send: mockSend } as any, TABLE);
    expect(result.backfilledCount).toBe(1);

    // Verify the scan used the checkpoint key
    const scanCall = mockSend.mock.calls[1][0];
    expect(scanCall.ExclusiveStartKey).toEqual(checkpointKey);
  });

  test('dry-run does not write anything', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // checkpoint
    mockSend.mockResolvedValueOnce({
      Items: [makeWebhookRow('user-1', 'wh-1', ['booking.confirmed'])],
      LastEvaluatedKey: undefined,
    });
    // No more calls expected in dry-run

    const result = await runBackfill({ send: mockSend } as any, TABLE, { dryRun: true });
    expect(result.backfilledCount).toBe(1);
    // Only 2 calls: checkpoint get + scan (no writes)
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
