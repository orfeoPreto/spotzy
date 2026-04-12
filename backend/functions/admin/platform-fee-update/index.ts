import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { forbidden } from '../../../shared/utils/admin-response';
import { ok, badRequest } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { PLATFORM_FEE_MIN, PLATFORM_FEE_MAX, PLATFORM_FEE_DEFAULT_SINGLE_SHOT, PLATFORM_FEE_DEFAULT_BLOCK_RESERVATION } from '../../../shared/pricing/constants';
import type { PlatformFeeHistoryEntry } from '../../../shared/pricing/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const MAX_HISTORY = 100;

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractAdminClaims(event);
  const log = createLogger('admin-platform-fee-update', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('forbidden'); return forbidden(); }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return badRequest('INVALID_JSON_BODY');
  }

  const { singleShotPct, blockReservationPct } = body;

  if (typeof singleShotPct !== 'number' || typeof blockReservationPct !== 'number') {
    return badRequest('PLATFORM_FEE_OUT_OF_BOUNDS');
  }

  if (singleShotPct < PLATFORM_FEE_MIN || singleShotPct > PLATFORM_FEE_MAX) {
    return badRequest('PLATFORM_FEE_OUT_OF_BOUNDS');
  }

  if (blockReservationPct < PLATFORM_FEE_MIN || blockReservationPct > PLATFORM_FEE_MAX) {
    return badRequest('PLATFORM_FEE_OUT_OF_BOUNDS');
  }

  const now = new Date().toISOString();

  // Read current record
  const existing = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: 'CONFIG#PLATFORM_FEE', SK: 'METADATA' },
  }));

  const currentLog: PlatformFeeHistoryEntry[] = existing.Item?.historyLog ?? [];

  const newEntry: PlatformFeeHistoryEntry = {
    singleShotPct: singleShotPct as number,
    blockReservationPct: blockReservationPct as number,
    modifiedBy: claims.userId,
    modifiedAt: now,
  };

  // Append and truncate to last MAX_HISTORY entries
  const updatedLog = [...currentLog, newEntry].slice(-MAX_HISTORY);

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: 'CONFIG#PLATFORM_FEE',
      SK: 'METADATA',
      singleShotPct,
      blockReservationPct,
      lastModifiedBy: claims.userId,
      lastModifiedAt: now,
      historyLog: updatedLog,
    },
  }));

  log.info('platform fee config updated', { singleShotPct, blockReservationPct });

  return ok({
    singleShotPct,
    blockReservationPct,
    lastModifiedBy: claims.userId,
    lastModifiedAt: now,
    historyLog: updatedLog,
  });
};
