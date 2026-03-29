import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, unauthorized } from '../../../shared/utils/response';
import { userProfileKey, emailLookupKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const SENSITIVE_FIELDS = new Set(['stripeConnectAccountId']);

const strip = (user: Record<string, unknown>): Record<string, unknown> => {
  const result = { ...user };
  for (const field of SENSITIVE_FIELDS) delete result[field];
  return result;
};

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('user-get', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(claims.userId) }));

  if (result.Item) {
    log.info('user fetched');
    const user = strip(result.Item);
    const isHost = result.Item.stripeConnectEnabled === true;
    const personas = ['GUEST', ...(isHost ? ['HOST'] : [])];
    return ok({ ...user, isHost, personas });
  }

  // Auto-create minimal profile
  const now = new Date().toISOString();
  const profile = {
    ...emailLookupKey(claims.email, claims.userId),
    userId: claims.userId,
    email: claims.email,
    name: claims.email.split('@')[0],
    role: 'SPOTTER',
    stripeConnectEnabled: false,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: TABLE, Item: profile }));
  log.info('user profile auto-created');
  return ok(strip(profile));
};
