import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ulid } from 'ulid';
import { extractClaims } from '../../../shared/utils/auth';
import { created, badRequest, unauthorized, notFound, forbidden } from '../../../shared/utils/response';
import { bookingMetadataKey, disputeByBookingKey, disputeMessageKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';
import { generateDisputeResponse } from '../shared/ai-respond';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';


export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('dispute-create', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const body = JSON.parse(event.body ?? '{}');
  const { bookingId, reason } = body;
  log.info('dispute attempt', { bookingId });

  const bookingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(bookingId) }));
  if (!bookingResult.Item) return notFound();
  const booking = bookingResult.Item;

  const isSpotter = claims.userId === booking.spotterId;
  const isHost = claims.userId === booking.hostId;
  if (!isSpotter && !isHost) return forbidden();

  // Time window check — allow CONFIRMED, ACTIVE unconditionally; COMPLETED within 7 days
  const ALLOWED_DISPUTE_STATUSES = new Set(['CONFIRMED', 'ACTIVE']);
  if (booking.status === 'COMPLETED') {
    const endTime = booking.completedAt ?? booking.endTime;
    const daysSinceEnd = (Date.now() - new Date(endTime).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceEnd > 7) return badRequest('DISPUTE_WINDOW_EXPIRED');
  } else if (!ALLOWED_DISPUTE_STATUSES.has(booking.status as string)) {
    return badRequest('INVALID_BOOKING_STATUS');
  }

  // Check for existing open dispute
  const existingDisputes = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: '#status = :open',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':pk': `BOOKING#${bookingId}`, ':open': 'OPEN' },
  }));
  if (existingDisputes.Items && existingDisputes.Items.length > 0) {
    return { statusCode: 409, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'A dispute is already open', code: 'DISPUTE_ALREADY_OPEN' }) };
  }

  const disputeId = ulid();
  const referenceNumber = disputeId.slice(0, 8).toUpperCase();
  const now = new Date().toISOString();

  // Write dispute record
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      ...disputeByBookingKey(bookingId, disputeId),
      disputeId,
      bookingId,
      initiatorId: claims.userId,
      hostId: booking.hostId,
      spotterId: booking.spotterId,
      reason,
      status: 'OPEN',
      referenceNumber,
      createdAt: now,
      updatedAt: now,
    },
  }));

  // Write initial message
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      ...disputeMessageKey(disputeId, now),
      disputeId,
      authorId: claims.userId,
      content: reason,
      createdAt: now,
    },
  }));

  // Write bot confirmation message
  const confirmAt = new Date(Date.now() + 1).toISOString();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      ...disputeMessageKey(disputeId, confirmAt),
      disputeId,
      authorId: 'SYSTEM',
      content: `Your dispute has been created (ref: ${referenceNumber}). We'll review it shortly.`,
      createdAt: confirmAt,
    },
  }));

  // Generate AI follow-up based on the dispute reason
  const aiFollowUp = await generateDisputeResponse([
    { role: 'user', content: reason },
  ]);
  const followUpAt = new Date(Date.now() + 2).toISOString();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      ...disputeMessageKey(disputeId, followUpAt),
      disputeId,
      authorId: 'SYSTEM',
      content: aiFollowUp,
      requestsEvidence: true,
      createdAt: followUpAt,
    },
  }));

  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS, Source: 'spotzy', DetailType: 'dispute.created',
      Detail: JSON.stringify({ disputeId, bookingId, initiatorId: claims.userId, hostId: booking.hostId, spotterId: booking.spotterId, listingAddress: booking.listingAddress }),
    }],
  }));

  log.info('dispute created', { disputeId, bookingId, referenceNumber });
  return created({ disputeId, status: 'OPEN', referenceNumber });
};
