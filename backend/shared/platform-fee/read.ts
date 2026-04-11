import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { PLATFORM_FEE_DEFAULT_SINGLE_SHOT, PLATFORM_FEE_DEFAULT_BLOCK_RESERVATION } from '../pricing/constants';
import type { PlatformFeeConfig } from '../pricing/types';

/**
 * Reads the current PlatformFeeConfig from DynamoDB.
 *
 * If the record doesn't exist (e.g. on first deploy before the seed Lambda has run),
 * falls back to default values rather than throwing. This makes the function safe to
 * call from any settlement Lambda even on a brand-new environment.
 */
export async function readPlatformFeeConfig(
  client: DynamoDBDocumentClient,
  tableName: string
): Promise<PlatformFeeConfig> {
  const result = await client.send(new GetCommand({
    TableName: tableName,
    Key: { PK: 'CONFIG#PLATFORM_FEE', SK: 'METADATA' },
  }));

  if (!result.Item) {
    return {
      singleShotPct: PLATFORM_FEE_DEFAULT_SINGLE_SHOT,
      blockReservationPct: PLATFORM_FEE_DEFAULT_BLOCK_RESERVATION,
      lastModifiedBy: null,
      lastModifiedAt: null,
      historyLog: [],
    };
  }

  return {
    singleShotPct: result.Item.singleShotPct,
    blockReservationPct: result.Item.blockReservationPct,
    lastModifiedBy: result.Item.lastModifiedBy ?? null,
    lastModifiedAt: result.Item.lastModifiedAt ?? null,
    historyLog: result.Item.historyLog ?? [],
  };
}
