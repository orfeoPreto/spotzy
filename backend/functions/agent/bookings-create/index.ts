import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
  const log = createLogger('agent-booking-create', event.requestContext.requestId);
  const userId = event.requestContext.authorizer?.userId
    ?? event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { listingId, startTime, endTime } = JSON.parse(event.body ?? '{}');
  if (!listingId || !startTime || !endTime) return badRequest('listingId, startTime, and endTime are required');

  // Fetch listing
  const listingResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND SK = :sk',
    ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':sk': 'METADATA' },
  }));
  const listing = listingResult.Items?.[0];
  if (!listing) return notFound();

  // Self-booking check
  if (listing.hostId === userId) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'CANNOT_BOOK_OWN_LISTING' }) };
  }

  // Availability check
  const blocks = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'AVAIL_BLOCK#' },
  }));

  const reqStart = new Date(startTime).getTime();
  const reqEnd = new Date(endTime).getTime();
  const isBlocked = (blocks.Items ?? []).some(b => {
    const bStart = new Date(b.startTime).getTime();
    const bEnd = new Date(b.endTime).getTime();
    return bStart < reqEnd && bEnd > reqStart;
  });

  if (isBlocked) return conflict('LISTING_UNAVAILABLE');

  // Calculate price
  const durationHours = (reqEnd - reqStart) / 3_600_000;
  const pricePerHour = listing.pricePerHour ?? (listing.pricePerDay ? listing.pricePerDay / 24 : 0);
  const subtotalEur = round2(pricePerHour * durationHours);
  const totalEur = round2(subtotalEur * 1.15);

  const bookingId = ulid();
  const confirmationRef = `SPZ-${Date.now().toString().slice(-7)}`;
  const now = new Date().toISOString();

  // Write booking
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `BOOKING#${bookingId}`,
      SK: 'METADATA',
      GSI1PK: `SPOTTER#${userId}`,
      GSI1SK: `BOOKING#${bookingId}`,
      bookingId, confirmationRef, listingId,
      spotterId: userId, hostId: listing.hostId,
      startTime, endTime, totalEur,
      status: 'CONFIRMED',
      createdAt: now, updatedAt: now,
      listingAddress: listing.address,
      spotType: listing.spotType,
      source: 'AGENT_API',
    },
  }));

  // Write availability block
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `LISTING#${listingId}`,
      SK: `AVAIL_BLOCK#${bookingId}`,
      bookingId, startTime, endTime,
    },
  }));

  // Publish event
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: EVENT_BUS,
      Source: 'spotzy.agent',
      DetailType: 'booking.confirmed',
      Detail: JSON.stringify({
        bookingId, confirmationRef, listingId,
        listingAddress: listing.address, spotType: listing.spotType,
        startTime, endTime, totalEur, userId, hostId: listing.hostId,
      }),
    }],
  }));

  log.info('agent booking created', { bookingId, listingId, totalEur });
  return created({
    bookingId, confirmationRef, listingId,
    listingAddress: listing.address, spotType: listing.spotType,
    startTime, endTime, status: 'CONFIRMED', totalEur,
  });
};
