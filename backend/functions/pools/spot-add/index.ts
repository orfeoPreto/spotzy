import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ok, badRequest, notFound, conflict } from '../../../shared/utils/response';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  const poolId = event.pathParameters?.poolId;
  if (!poolId) return badRequest('poolId required');

  const { listingId } = JSON.parse(event.body ?? '{}');
  if (!listingId) return badRequest('listingId is required');

  // Verify pool ownership
  const pool = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `POOL#${poolId}`, SK: 'METADATA' } }));
  if (!pool.Item) return notFound();
  if (pool.Item.managerId !== userId) return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) };

  // Verify listing ownership
  const listing = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `LISTING#${listingId}`, SK: 'METADATA' } }));
  if (!listing.Item) return notFound();
  if (listing.Item.hostId !== userId) return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) };

  // Check if already in pool
  const existing = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `POOL#${poolId}`, SK: `SPOT#${listingId}` } }));
  if (existing.Item) return conflict('SPOT_ALREADY_IN_POOL');

  // Add spot to pool
  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: `POOL#${poolId}`, SK: `SPOT#${listingId}`, listingId, addedAt: now, active: true },
  }));

  // Mark listing as in pool
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `LISTING#${listingId}`, SK: 'METADATA' },
    UpdateExpression: 'SET inPool = :t, poolId = :pid',
    ExpressionAttributeValues: { ':t': true, ':pid': poolId },
  }));

  // Increment totalSpots
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `POOL#${poolId}`, SK: 'METADATA' },
    UpdateExpression: 'ADD totalSpots :one',
    ExpressionAttributeValues: { ':one': 1 },
  }));

  return ok({ poolId, listingId, addedAt: now });
};
