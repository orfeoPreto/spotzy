import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ulid } from 'ulid';
import { created, badRequest, notFound, conflict } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const EVENT_BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

const round2 = (n: number) => Math.round(n * 100) / 100;

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('pool-booking-create', event.requestContext.requestId);
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  const poolId = event.pathParameters?.poolId;
  if (!poolId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'poolId' });

  const { startTime, endTime } = JSON.parse(event.body ?? '{}');
  if (!startTime || !endTime) return badRequest('MISSING_REQUIRED_FIELD', { field: 'startTime, endTime' });

  const pool = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `POOL#${poolId}`, SK: 'METADATA' } }));
  if (!pool.Item) return notFound();

  // Get all spots in pool
  const spots = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    FilterExpression: 'active = :t',
    ExpressionAttributeValues: { ':pk': `POOL#${poolId}`, ':prefix': 'SPOT#', ':t': true },
  }));

  const reqStart = new Date(startTime).getTime();
  const reqEnd = new Date(endTime).getTime();

  // Find first available spot
  let assignedListingId: string | null = null;
  for (const spot of spots.Items ?? []) {
    const blocks = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `LISTING#${spot.listingId}`, ':prefix': 'AVAIL_BLOCK#' },
    }));

    const isBlocked = (blocks.Items ?? []).some(b => {
      const bStart = new Date(b.startTime).getTime();
      const bEnd = new Date(b.endTime).getTime();
      return bStart < reqEnd && bEnd > reqStart;
    });

    if (!isBlocked) {
      assignedListingId = spot.listingId;
      break;
    }
  }

  if (!assignedListingId) return conflict('POOL_FULLY_BOOKED');

  // Calculate price from pool pricing
  const durationHours = (reqEnd - reqStart) / 3_600_000;
  const pricePerHour = pool.Item.pricePerHour ?? 0;
  const subtotalEur = round2(pricePerHour * durationHours);
  const totalEur = round2(subtotalEur * 1.15);

  const bookingId = ulid();
  const confirmationRef = `SPZ-${Date.now().toString().slice(-7)}`;
  const now = new Date().toISOString();

  // Write booking
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `BOOKING#${bookingId}`, SK: 'METADATA',
      GSI1PK: `SPOTTER#${userId}`, GSI1SK: `BOOKING#${bookingId}`,
      bookingId, confirmationRef, listingId: assignedListingId,
      poolId, assignedListingId,
      spotterId: userId, hostId: pool.Item.managerId,
      startTime, endTime, totalEur,
      status: 'CONFIRMED', createdAt: now, updatedAt: now,
      listingAddress: pool.Item.address, spotType: pool.Item.spotType,
    },
  }));

  // Write availability block on the assigned spot
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: `LISTING#${assignedListingId}`, SK: `AVAIL_BLOCK#${bookingId}`, bookingId, startTime, endTime },
  }));

  // Write pool booking record
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: `POOL#${poolId}`, SK: `BOOKING#${bookingId}`, bookingId, assignedListingId, startTime, endTime, status: 'CONFIRMED' },
  }));

  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: EVENT_BUS, Source: 'spotzy.pools', DetailType: 'booking.confirmed',
      Detail: JSON.stringify({ bookingId, confirmationRef, poolId, assignedListingId, startTime, endTime, totalEur, userId }),
    }],
  }));

  log.info('pool booking created', { bookingId, poolId, assignedListingId });
  return created({ bookingId, confirmationRef, poolId, assignedListingId, startTime, endTime, status: 'CONFIRMED', totalEur });
};
