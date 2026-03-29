import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ulid } from 'ulid';
import { extractClaims } from '../../../shared/utils/auth';
import { created, ok, badRequest, unauthorized, notFound } from '../../../shared/utils/response';
import { listingMetadataKey, bookingBySpotterKey, listingBookingKey } from '../../../shared/db/keys';
import { calculatePrice, NoPriceConfiguredError } from '../shared/price-calculator';
import { isWithinAvailabilityRules } from '../../../shared/availability/resolver';
import { AvailabilityRule, AvailabilityBlock } from '../../../shared/types/availability';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

const BLOCKING_STATUSES = new Set(['CONFIRMED', 'ACTIVE', 'PENDING_PAYMENT']);
const PLATFORM_FEE = 0.15;
const DEFAULT_CANCELLATION_POLICY = { gt48h: 100, between24and48h: 50, lt24h: 0 };

const conflictError = (code: string, message: string) => ({
  statusCode: 409,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ error: message, code }),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('booking-create', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const body = JSON.parse(event.body ?? '{}');
  const { listingId, startTime, endTime, vehicleId, idempotencyKey } = body;

  log.info('booking attempt', { listingId, startTime, endTime });

  // Basic time validation
  if (!startTime || !endTime) return badRequest('startTime and endTime are required');
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  if (startMs <= Date.now()) return badRequest(JSON.stringify({ code: 'START_TIME_IN_PAST', message: 'Start time must be in the future' }));
  if (endMs <= startMs) return badRequest(JSON.stringify({ code: 'INVALID_TIME_RANGE', message: 'End time must be after start time' }));

  // Fetch listing
  const listingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: listingMetadataKey(listingId) }));
  if (!listingResult.Item) return notFound();
  const listing = listingResult.Item;

  // Self-booking prevention — BR-SB01
  const spotterId = claims.userId;
  if (spotterId === listing.hostId) {
    log.warn('self-booking attempt blocked', { listingId, spotterId });
    return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'CANNOT_BOOK_OWN_LISTING' }) };
  }

  // Duration validation
  const durationHours = (endMs - startMs) / 3600000;
  if (listing.minDurationHours && durationHours < listing.minDurationHours) {
    return badRequest(JSON.stringify({ code: 'BELOW_MINIMUM_DURATION', message: `Minimum duration is ${listing.minDurationHours}h` }));
  }
  if (listing.maxDurationHours && durationHours > listing.maxDurationHours) {
    return badRequest(JSON.stringify({ code: 'EXCEEDS_MAXIMUM_DURATION', message: `Maximum duration is ${listing.maxDurationHours}h` }));
  }

  // Idempotency check — query by spotter + idempotency key
  if (idempotencyKey) {
    const idempotencyCheck = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      FilterExpression: 'idempotencyKey = :ikey',
      ExpressionAttributeValues: { ':pk': `SPOTTER#${claims.userId}`, ':ikey': idempotencyKey },
    }));
    const match = (idempotencyCheck.Items ?? []).find(item => item.idempotencyKey === idempotencyKey);
    if (match) {
      return ok(match);
    }
  }

  // Step 1a: Availability rules check
  const rulesRes = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'AVAIL_RULE#' },
  }));
  const rules = (rulesRes.Items ?? []) as AvailabilityRule[];
  const ruleCheck = isWithinAvailabilityRules(rules, new Date(startTime), new Date(endTime));
  if (!ruleCheck.covered) {
    log.warn('outside availability window', { listingId, startTime, endTime });
    return badRequest(JSON.stringify({
      code: 'OUTSIDE_AVAILABILITY_WINDOW',
      message: 'The requested period is outside this listing\'s availability schedule',
      uncoveredPeriods: ruleCheck.uncoveredPeriods,
      coveredWindows: rules.map((r) => ({
        type: r.type, daysOfWeek: r.daysOfWeek,
        startTime: r.startTime, endTime: r.endTime,
      })),
    }));
  }

  // Step 1b: Strongly consistent availability block check
  const fromDate = new Date(startTime).toISOString().slice(0, 10);
  const toDate = new Date(endTime).toISOString().slice(0, 10);
  const blocksRes = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
    ExpressionAttributeValues: {
      ':pk': `LISTING#${listingId}`,
      ':from': `AVAIL_BLOCK#${fromDate}`,
      ':to': `AVAIL_BLOCK#${toDate}~`,
    },
    ConsistentRead: true,
  }));
  const blocks = (blocksRes.Items ?? []) as AvailabilityBlock[];
  const hasConflict = blocks.some((b) => {
    const bStart = new Date(b.startTime).getTime();
    const bEnd = new Date(b.endTime).getTime();
    return startMs < bEnd && endMs > bStart;
  });
  if (hasConflict) {
    log.warn('spot unavailable — block conflict', { listingId, startTime, endTime });
    return conflictError('SPOT_UNAVAILABLE', 'This spot is not available for the requested period');
  }

  // Step 1c: Legacy booking record conflict check (belt-and-suspenders)
  const conflictCheck = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'BOOKING#' },
  }));
  const conflicting = (conflictCheck.Items ?? []).filter((b) => {
    if (!BLOCKING_STATUSES.has(b.status)) return false;
    const bStart = new Date(b.startTime).getTime();
    const bEnd = new Date(b.endTime).getTime();
    return startMs < bEnd && endMs > bStart;
  });
  if (conflicting.length > 0) {
    log.warn('spot unavailable', { listingId, startTime, endTime });
    return conflictError('SPOT_UNAVAILABLE', 'This spot is not available for the requested period');
  }

  // Calculate price
  let totalPrice: number;
  try {
    totalPrice = calculatePrice(listing, startTime, endTime);
  } catch (e) {
    if (e instanceof NoPriceConfiguredError) return badRequest('No price configured for this listing');
    throw e;
  }

  const hostPayout = Math.round(totalPrice * (1 - PLATFORM_FEE) * 100) / 100;
  const bookingId = ulid();
  const now = new Date().toISOString();

  const booking = {
    ...bookingBySpotterKey(claims.userId, bookingId),
    bookingId,
    listingId,
    spotterId: claims.userId,
    hostId: listing.hostId,
    startTime,
    endTime,
    vehicleId,
    totalPrice,
    platformFeePercent: PLATFORM_FEE * 100,
    hostPayout,
    status: 'PENDING_PAYMENT',
    cancellationPolicy: DEFAULT_CANCELLATION_POLICY,
    idempotencyKey,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };

  // Write booking metadata record
  await ddb.send(new PutCommand({ TableName: TABLE, Item: booking }));

  // Write listing→booking relationship record
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { ...listingBookingKey(listingId, bookingId), bookingId, listingId, startTime, endTime, status: 'PENDING_PAYMENT' },
  }));

  // Emit event
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS,
      Source: 'spotzy',
      DetailType: 'booking.created',
      Detail: JSON.stringify({ bookingId, listingId, spotterId: claims.userId, hostId: listing.hostId, startTime, endTime, totalPrice }),
    }],
  }));

  log.info('booking created', { bookingId, listingId, totalPrice, status: 'PENDING_PAYMENT' });
  return created(booking);
};
