import { handler } from '../../functions/agent/apikey-monthly-reset/index';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    ScanCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'ScanCommand' })),
    UpdateCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'UpdateCommand' })),
    __mockSend: mockSend,
  };
});

jest.mock('@aws-sdk/client-cloudwatch', () => {
  const mockCwSend = jest.fn().mockResolvedValue({});
  return {
    CloudWatchClient: jest.fn().mockImplementation(() => ({ send: mockCwSend })),
    PutMetricDataCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'PutMetricDataCommand' })),
    __mockCwSend: mockCwSend,
  };
});

const mockSend = require('@aws-sdk/lib-dynamodb').__mockSend;
const mockCwSend = require('@aws-sdk/client-cloudwatch').__mockCwSend;

describe('apikey-monthly-reset Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resets monthlySpendingSoFarEur to 0 on all active API keys', async () => {
    // Scan returns 3 active keys
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { PK: 'APIKEY#hash1', SK: 'METADATA', monthlySpendingSoFarEur: 15.5 },
          { PK: 'APIKEY#hash2', SK: 'METADATA', monthlySpendingSoFarEur: 250 },
          { PK: 'APIKEY#hash3', SK: 'METADATA', monthlySpendingSoFarEur: 0 },
        ],
        LastEvaluatedKey: undefined,
      })
      // 3 UpdateCommand calls
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const result = await handler({ time: '2026-04-01T00:00:00Z' });

    expect(result.resetCount).toBe(3);
    // Verify UpdateCommand was called 3 times (not the scan)
    expect(mockSend).toHaveBeenCalledTimes(4); // 1 scan + 3 updates
    // Verify the update expression sets spending to 0
    const updateCalls = mockSend.mock.calls.slice(1);
    for (const [cmd] of updateCalls) {
      expect(cmd.UpdateExpression).toBe('SET monthlySpendingSoFarEur = :zero, monthlyResetAt = :now');
      expect(cmd.ExpressionAttributeValues[':zero']).toBe(0);
      expect(cmd.ExpressionAttributeValues[':now']).toBe('2026-04-01T00:00:00.000Z');
    }
  });

  test('skips revoked API keys via FilterExpression', async () => {
    // The scan with FilterExpression already excludes revoked keys,
    // so we only test that it filters at the scan level
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await handler({ time: '2026-04-01T00:00:00Z' });

    expect(result.resetCount).toBe(0);
    // Verify scan includes the filter
    const scanCmd = mockSend.mock.calls[0][0];
    expect(scanCmd.FilterExpression).toContain('attribute_not_exists(revokedAt)');
  });

  test('handles ConditionalCheckFailedException for keys revoked between scan and update', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { PK: 'APIKEY#hash1', SK: 'METADATA', monthlySpendingSoFarEur: 10 },
        ],
        LastEvaluatedKey: undefined,
      })
      .mockRejectedValueOnce(Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' }));

    const result = await handler({ time: '2026-04-01T00:00:00Z' });

    expect(result.resetCount).toBe(0); // Skipped, not counted
  });

  test('paginates through large key sets', async () => {
    // First page with continuation
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { PK: 'APIKEY#hash1', SK: 'METADATA', monthlySpendingSoFarEur: 5 },
        ],
        LastEvaluatedKey: { PK: 'APIKEY#hash1', SK: 'METADATA' },
      })
      .mockResolvedValueOnce({}) // update for hash1
      // Second page, no more
      .mockResolvedValueOnce({
        Items: [
          { PK: 'APIKEY#hash2', SK: 'METADATA', monthlySpendingSoFarEur: 5 },
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({}); // update for hash2

    const result = await handler({ time: '2026-04-01T00:00:00Z' });

    expect(result.resetCount).toBe(2);
    expect(mockSend).toHaveBeenCalledTimes(4); // 2 scans + 2 updates
  });

  test('idempotent — running twice is a no-op the second time', async () => {
    // First run
    mockSend
      .mockResolvedValueOnce({
        Items: [{ PK: 'APIKEY#hash1', SK: 'METADATA', monthlySpendingSoFarEur: 10 }],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({});

    const result1 = await handler({ time: '2026-04-01T00:00:00Z' });
    expect(result1.resetCount).toBe(1);

    // Second run — key already reset (spending is 0), but update still works
    mockSend
      .mockResolvedValueOnce({
        Items: [{ PK: 'APIKEY#hash1', SK: 'METADATA', monthlySpendingSoFarEur: 0 }],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({});

    const result2 = await handler({ time: '2026-04-01T00:00:00Z' });
    expect(result2.resetCount).toBe(1); // Still succeeds, just sets 0 to 0
  });

  test('emits CloudWatch metric with the count of keys reset', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [
          { PK: 'APIKEY#hash1', SK: 'METADATA', monthlySpendingSoFarEur: 10 },
          { PK: 'APIKEY#hash2', SK: 'METADATA', monthlySpendingSoFarEur: 20 },
        ],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await handler({ time: '2026-04-01T00:00:00Z' });

    expect(mockCwSend).toHaveBeenCalledTimes(1);
    const cwCmd = mockCwSend.mock.calls[0][0];
    expect(cwCmd.Namespace).toBe('Spotzy/AgentApi');
    expect(cwCmd.MetricData[0].MetricName).toBe('MonthlyResetCount');
    expect(cwCmd.MetricData[0].Value).toBe(2);
  });

  test('throws on non-conditional DynamoDB errors', async () => {
    mockSend
      .mockResolvedValueOnce({
        Items: [{ PK: 'APIKEY#hash1', SK: 'METADATA', monthlySpendingSoFarEur: 10 }],
        LastEvaluatedKey: undefined,
      })
      .mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));

    await expect(handler({ time: '2026-04-01T00:00:00Z' })).rejects.toThrow();
  });
});
