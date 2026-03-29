import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized } from '../../../shared/utils/response';
import { userProfileKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const IMMUTABLE = new Set(['userId', 'email', 'PK', 'SK', 'GSI1PK', 'GSI1SK', 'createdAt']);

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('user-update', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const body = JSON.parse(event.body ?? '{}');
  log.info('update attempt', { fields: Object.keys(body) });

  // Validate vehicles
  if (body.vehicles !== undefined) {
    if (body.vehicles.length > 5) return badRequest(JSON.stringify({ code: 'MAX_VEHICLES_EXCEEDED', message: 'Maximum 5 vehicles allowed' }));
    for (const v of body.vehicles) {
      if (!v.plate || v.plate.trim() === '') return badRequest('Vehicle plate cannot be empty');
      if (v.plate.length > 15) return badRequest('Vehicle plate must be 15 characters or less');
    }
  }

  const userResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(claims.userId) }));
  const existing = userResult.Item ?? {};

  // Build update — strip immutable fields
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!IMMUTABLE.has(k) && k !== 'phone') updates[k] = v;
  }

  // Phone change handling
  let phoneSent = false;
  if (body.phone !== undefined && body.phone !== existing.phone) {
    updates.pendingPhone = body.phone;
    updates.phoneVerified = false;
    phoneSent = true;
  }

  updates.updatedAt = new Date().toISOString();

  const setExpressions = Object.keys(updates).map(k => `#${k} = :${k}`).join(', ');
  const names = Object.fromEntries(Object.keys(updates).map(k => [`#${k}`, k]));
  const values = Object.fromEntries(Object.entries(updates).map(([k, v]) => [`:${k}`, v]));

  const result = await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: userProfileKey(claims.userId),
    UpdateExpression: `SET ${setExpressions}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW',
  }));

  if (phoneSent) {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await sns.send(new PublishCommand({
      PhoneNumber: body.phone as string,
      Message: `Your Spotzy verification code: ${otp}`,
    }));
  }

  log.info('user updated', { updatedFields: Object.keys(updates), phoneSent });
  return ok(result.Attributes ?? { ...existing, ...updates });
};
