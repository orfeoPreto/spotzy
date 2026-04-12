import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import * as ngeohash from 'ngeohash';
import { created, badRequest, forbidden } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('pool-create', event.requestContext.requestId);
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  const body = JSON.parse(event.body ?? '{}');
  const { name, address, spotType, pricePerHour, pricePerDay, minDurationHours, maxDurationHours, description, lat, lng } = body;

  if (!name?.trim() || !address?.trim()) return badRequest('MISSING_REQUIRED_FIELD', { field: 'name, address' });

  // Verify user is a host
  const user = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
  }));
  if (!user.Item?.stripeConnectEnabled) {
    return forbidden();
  }

  const poolId = ulid();
  const now = new Date().toISOString();
  const geohashValue = lat && lng ? ngeohash.encode(lat, lng, 5) : undefined;

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `POOL#${poolId}`, SK: 'METADATA',
      GSI1PK: `MANAGER#${userId}`, GSI1SK: `POOL#${poolId}`,
      ...(geohashValue ? { geohash: geohashValue, listingId: `pool-${poolId}` } : {}),
      poolId, managerId: userId, name: name.trim(), description: description ?? null,
      address: address.trim(), spotType: spotType ?? null,
      pricePerHour: pricePerHour ?? null, pricePerDay: pricePerDay ?? null,
      minDurationHours: minDurationHours ?? null, maxDurationHours: maxDurationHours ?? null,
      lat: lat ?? null, lng: lng ?? null,
      status: 'ACTIVE', totalSpots: 0,
      createdAt: now, updatedAt: now,
    },
  }));

  // Reverse lookup
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: `USER#${userId}`, SK: `POOL#${poolId}`, poolId, name: name.trim(), createdAt: now },
  }));

  log.info('pool created', { poolId, userId });
  return created({ poolId, name: name.trim(), address: address.trim(), status: 'ACTIVE', createdAt: now });
};
