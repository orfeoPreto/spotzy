import { APIGatewayProxyHandler } from 'aws-lambda';
import { createHash, randomBytes } from 'crypto';
import { ulid } from 'ulid';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ok, created, badRequest, notFound, forbidden } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const generateKey = () => `sk_spotzy_live_${randomBytes(16).toString('hex')}`;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const startOfNextMonth = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('agent-keys', event.requestContext.requestId);
  const userId = event.requestContext.authorizer?.claims?.sub
    ?? event.requestContext.authorizer?.userId;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  const method = event.httpMethod;

  if (method === 'POST') {
    const body = JSON.parse(event.body ?? '{}');
    const { name, spendingLimitPerBookingEur, monthlySpendingLimitEur } = body;
    if (!name?.trim()) return badRequest('MISSING_REQUIRED_FIELD', { field: 'name' });

    const rawKey = generateKey();
    const hash = sha256(rawKey);
    const keyId = ulid();
    const now = new Date().toISOString();

    await ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: {
              PK: `APIKEY#${hash}`, SK: 'METADATA',
              userId, keyId, name: name.trim(),
              spendingLimitPerBookingEur: spendingLimitPerBookingEur ?? null,
              monthlySpendingLimitEur: monthlySpendingLimitEur ?? null,
              monthlySpendingSoFarEur: 0,
              monthlyResetAt: startOfNextMonth(),
              createdAt: now, lastUsedAt: null, revokedAt: null,
            },
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              PK: `USER#${userId}`, SK: `APIKEY#${keyId}`,
              keyId, name: name.trim(), createdAt: now, lastUsedAt: null, active: true,
            },
          },
        },
      ],
    }));

    log.info('api key created', { userId, keyId });
    return created({
      key: rawKey, keyId, name: name.trim(), createdAt: now,
      spendingLimitPerBookingEur: spendingLimitPerBookingEur ?? null,
      monthlySpendingLimitEur: monthlySpendingLimitEur ?? null,
      monthlySpendingSoFarEur: 0,
    });
  }

  if (method === 'GET') {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'APIKEY#' },
    }));

    const keys = (result.Items ?? []).map(({ PK, SK, ...rest }) => rest);
    return ok({ keys });
  }

  if (method === 'DELETE') {
    const keyId = event.pathParameters?.keyId;
    if (!keyId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'keyId' });

    // Verify ownership
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': `APIKEY#${keyId}` },
    }));

    if (!result.Items?.length) {
      return forbidden();
    }

    const now = new Date().toISOString();
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: `APIKEY#${keyId}` },
      UpdateExpression: 'SET active = :f, revokedAt = :now',
      ExpressionAttributeValues: { ':f': false, ':now': now },
    }));

    log.info('api key revoked', { userId, keyId });
    return ok({ keyId, revokedAt: now });
  }

  return badRequest('UNSUPPORTED_METHOD');
};
