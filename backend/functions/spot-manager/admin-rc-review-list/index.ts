import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { forbidden } from '../../../shared/utils/admin-response';
import { ok } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

/**
 * Compute business hours (Mon-Fri 09:00-18:00 CET) elapsed between two ISO timestamps.
 * Each business day has 9 hours of capacity.
 */
export function businessHoursBetween(fromIso: string, toIso: string): number {
  const start = new Date(fromIso);
  const end = new Date(toIso);
  if (end <= start) return 0;

  let hours = 0;
  const cursor = new Date(start);

  while (cursor < end) {
    const day = cursor.getUTCDay(); // 0=Sun,6=Sat
    const hour = cursor.getUTCHours();

    // CET is UTC+1 (simplified; ignore DST for SLA purposes)
    const cetHour = (hour + 1) % 24;
    const cetDay = hour >= 23 ? (day + 1) % 7 : day;

    const isBusinessDay = cetDay >= 1 && cetDay <= 5;
    const isBusinessHour = cetHour >= 9 && cetHour < 18;

    if (isBusinessDay && isBusinessHour) {
      // Advance by 1 hour or to 'end', whichever is sooner
      const nextHour = new Date(cursor.getTime() + 3_600_000);
      if (nextHour <= end) {
        hours += 1;
      } else {
        hours += (end.getTime() - cursor.getTime()) / 3_600_000;
      }
    }

    cursor.setTime(cursor.getTime() + 3_600_000);
  }

  return Math.round(hours * 100) / 100;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const admin = extractAdminClaims(event);
  const log = createLogger('admin-rc-review-list', event.requestContext.requestId, admin?.userId);
  if (!admin) return forbidden();

  // Query the RC_REVIEW_QUEUE for PENDING# items (FIFO ordering by SK)
  const queueResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': 'RC_REVIEW_QUEUE',
      ':prefix': 'PENDING#',
    },
  }));

  const items = queueResult.Items ?? [];
  if (items.length === 0) {
    log.info('rc review queue empty');
    return ok({ submissions: [], total: 0 });
  }

  // BatchGetItem to fetch lock indicators for each submission
  const submissionIds = items.map((i) => i.submissionId as string);
  const lockKeys = submissionIds.map((id) => ({
    PK: `RC_SOFT_LOCK#${id}`,
    SK: 'METADATA',
  }));

  // DynamoDB BatchGetItem supports max 100 keys per request
  const lockMap = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < lockKeys.length; i += 100) {
    const batch = lockKeys.slice(i, i + 100);
    const batchResult = await ddb.send(new BatchGetCommand({
      RequestItems: {
        [TABLE]: { Keys: batch },
      },
    }));
    const responses = batchResult.Responses?.[TABLE] ?? [];
    for (const lock of responses) {
      lockMap.set(lock.submissionId as string, lock);
    }
  }

  const now = new Date().toISOString();
  const submissions = items.map((item) => {
    const submissionId = item.submissionId as string;
    const createdAt = item.createdAt as string;
    const slaHoursElapsed = businessHoursBetween(createdAt, now);
    const slaWarning = slaHoursElapsed > 60;

    const lock = lockMap.get(submissionId);
    const lockInfo = lock
      ? {
          lockedBy: lock.lockedBy as string,
          lockedAt: lock.lockedAt as string,
          expiresAt: lock.expiresAt as string,
          isExpired: lock.expiresAt as string < now,
        }
      : null;

    return {
      submissionId,
      userId: item.userId as string,
      hostName: item.hostName as string ?? null,
      createdAt,
      status: item.status as string,
      slaHoursElapsed,
      slaWarning,
      lock: lockInfo,
    };
  });

  log.info('rc review queue listed', { total: submissions.length });
  return ok({ submissions, total: submissions.length });
};
