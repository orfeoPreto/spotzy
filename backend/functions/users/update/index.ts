import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized } from '../../../shared/utils/response';
import { userProfileKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';
import { SUPPORTED_LOCALES } from '../../../shared/locales/constants';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const IMMUTABLE = new Set(['userId', 'email', 'PK', 'SK', 'GSI1PK', 'GSI1SK', 'createdAt']);

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('user-update', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const body = JSON.parse(event.body ?? '{}');
  if (body.pseudo !== undefined && body.pseudo.trim() === '') body.pseudo = null;
  log.info('update attempt', { fields: Object.keys(body) });

  // Validate preferredLocale if present
  if (body.preferredLocale !== undefined) {
    if (!(SUPPORTED_LOCALES as readonly string[]).includes(body.preferredLocale)) {
      return badRequest('INVALID_LOCALE');
    }
    body.preferredLocaleSetAt = new Date().toISOString();
  }

  // Validate vehicles
  if (body.vehicles !== undefined) {
    if (body.vehicles.length > 5) return badRequest('MAX_VEHICLES_EXCEEDED', { maxVehicles: 5 });
    for (const v of body.vehicles) {
      if (!v.plate || v.plate.trim() === '') return badRequest('VEHICLE_PLATE_EMPTY');
      if (v.plate.length > 15) return badRequest('VEHICLE_PLATE_TOO_LONG', { maxLength: 15 });
    }
  }

  const userResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(claims.userId) }));
  const existing = userResult.Item ?? {};

  // Build update — strip immutable fields
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!IMMUTABLE.has(k)) updates[k] = v;
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

  log.info('user updated', { updatedFields: Object.keys(updates) });
  return ok(result.Attributes ?? { ...existing, ...updates });
};
