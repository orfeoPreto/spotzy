import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('user-become-host', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const now = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `USER#${claims.userId}`, SK: 'PROFILE' },
    UpdateExpression: 'SET stripeConnectEnabled = :t, #role = :both, updatedAt = :now',
    ExpressionAttributeNames: { '#role': 'role' },
    ExpressionAttributeValues: { ':t': true, ':both': 'both', ':now': now },
  }));

  log.info('become-host activated', { userId: claims.userId });
  return ok({ success: true });
};
