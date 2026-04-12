import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { forbidden } from '../../../shared/utils/admin-response';
import { ok, badRequest, conflict } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const TTL_BUFFER_S = 60; // 60 seconds after expiry for DynamoDB TTL cleanup

export const handler: APIGatewayProxyHandler = async (event) => {
  const admin = extractAdminClaims(event);
  const log = createLogger('admin-rc-review-lock', event.requestContext.requestId, admin?.userId);
  if (!admin) return forbidden();

  const submissionId = event.pathParameters?.submissionId;
  if (!submissionId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'submissionId' });

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + LOCK_DURATION_MS).toISOString();
  const ttl = Math.floor(new Date(now.getTime() + LOCK_DURATION_MS).getTime() / 1000) + TTL_BUFFER_S;

  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `RC_SOFT_LOCK#${submissionId}`,
        SK: 'METADATA',
        submissionId,
        lockedBy: admin.userId,
        lockedAt: nowIso,
        expiresAt,
        ttl,
      },
      ConditionExpression: 'attribute_not_exists(PK) OR lockedBy = :adminId OR expiresAt < :now',
      ExpressionAttributeValues: {
        ':adminId': admin.userId,
        ':now': nowIso,
      },
    }));

    log.info('lock acquired', { submissionId, expiresAt });
    return ok({ submissionId, lockedBy: admin.userId, lockedAt: nowIso, expiresAt });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      log.warn('lock held by another admin', { submissionId });
      return conflict('LOCK_HELD');
    }
    throw err;
  }
};
