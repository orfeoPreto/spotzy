import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ok, notFound, badRequest, forbidden } from '../../../shared/utils/response';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  const poolId = event.pathParameters?.poolId;
  if (!poolId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'poolId' });

  const pool = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `POOL#${poolId}`, SK: 'METADATA' } }));
  if (!pool.Item) return notFound();
  if (pool.Item.managerId !== userId) return forbidden();

  // Get spots
  const spots = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `POOL#${poolId}`, ':prefix': 'SPOT#' },
  }));

  // Get bookings
  const bookings = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `POOL#${poolId}`, ':prefix': 'BOOKING#' },
  }));

  const activeBookings = (bookings.Items ?? []).filter(b => ['CONFIRMED', 'ACTIVE'].includes(b.status));
  const completedBookings = (bookings.Items ?? []).filter(b => b.status === 'COMPLETED');
  const earningsTotal = completedBookings.reduce((sum, b) => sum + (b.totalEur ?? 0), 0);
  const totalSpots = pool.Item.totalSpots ?? (spots.Items ?? []).length;

  // Simple occupancy: active bookings / total spots
  const occupancyRate = totalSpots > 0 ? activeBookings.length / totalSpots : 0;

  return ok({
    poolId, name: pool.Item.name, totalSpots,
    activeBookings: activeBookings.length,
    occupancyRate: Math.round(occupancyRate * 100) / 100,
    earningsTotal: Math.round(earningsTotal * 100) / 100,
    upcomingBookings: activeBookings.map(({ PK, SK, ...rest }) => rest),
    spots: (spots.Items ?? []).map(({ PK, SK, ...rest }) => rest),
  });
};
