import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { readPlatformFeeConfig } from '../../../shared/platform-fee/read';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('readPlatformFeeConfig', () => {
  test('returns the seeded record when it exists', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'CONFIG#PLATFORM_FEE',
        SK: 'METADATA',
        singleShotPct: 0.12,
        blockReservationPct: 0.18,
        lastModifiedBy: 'admin-1',
        lastModifiedAt: '2026-03-01T00:00:00.000Z',
        historyLog: [
          { singleShotPct: 0.15, blockReservationPct: 0.15, modifiedBy: 'admin-1', modifiedAt: '2026-02-01T00:00:00.000Z' },
        ],
      },
    });

    const config = await readPlatformFeeConfig(ddbMock as unknown as DynamoDBDocumentClient, 'spotzy-main');
    expect(config.singleShotPct).toBe(0.12);
    expect(config.blockReservationPct).toBe(0.18);
    expect(config.lastModifiedBy).toBe('admin-1');
    expect(config.lastModifiedAt).toBe('2026-03-01T00:00:00.000Z');
    expect(config.historyLog).toHaveLength(1);
  });

  test('returns defaults when the record does not exist (no throw)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const config = await readPlatformFeeConfig(ddbMock as unknown as DynamoDBDocumentClient, 'spotzy-main');
    expect(config.singleShotPct).toBe(0.15);
    expect(config.blockReservationPct).toBe(0.15);
    expect(config.lastModifiedBy).toBeNull();
    expect(config.lastModifiedAt).toBeNull();
    expect(config.historyLog).toEqual([]);
  });

  test('handles missing optional fields on legacy records', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'CONFIG#PLATFORM_FEE',
        SK: 'METADATA',
        singleShotPct: 0.15,
        blockReservationPct: 0.15,
        // no lastModifiedBy, lastModifiedAt, historyLog
      },
    });

    const config = await readPlatformFeeConfig(ddbMock as unknown as DynamoDBDocumentClient, 'spotzy-main');
    expect(config.lastModifiedBy).toBeNull();
    expect(config.lastModifiedAt).toBeNull();
    expect(config.historyLog).toEqual([]);
  });
});
