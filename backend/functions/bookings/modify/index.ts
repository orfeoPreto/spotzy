import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound } from '../../../shared/utils/response';
import { bookingMetadataKey, listingMetadataKey } from '../../../shared/db/keys';
import { calculatePrice } from '../shared/price-calculator';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

const BLOCKING_STATUSES = new Set(['CONFIRMED', 'ACTIVE', 'PENDING_PAYMENT']);

const conflictError = (code: string, message: string) => ({
  statusCode: 409,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ error: message, code }),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('booking-modify', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const bookingId = event.pathParameters?.id;
  if (!bookingId) return notFound();

  const body = JSON.parse(event.body ?? '{}');
  const { newStartTime, newEndTime } = body;
  if (!newStartTime || !newEndTime) return badRequest('newStartTime and newEndTime are required');

  log.info('modify attempt', { bookingId, newStartTime, newEndTime });

  const newStart = new Date(newStartTime).getTime();
  const newEnd = new Date(newEndTime).getTime();

  // Fetch booking
  const bookingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(bookingId) }));
  if (!bookingResult.Item) return notFound();
  const booking = bookingResult.Item;

  const isActive = booking.status === 'ACTIVE';
  const startChanged = newStartTime !== booking.startTime;

  // Active bookings: only end time changes allowed
  if (isActive && startChanged) return badRequest(JSON.stringify({ code: 'CANNOT_CHANGE_START_ACTIVE', message: 'Cannot change start time of an active booking' }));

  if (!isActive) {
    if (newStart <= Date.now()) return badRequest(JSON.stringify({ code: 'START_TIME_IN_PAST', message: 'New start time must be in the future' }));
    const twoHoursFromNow = Date.now() + 2 * 3600000;
    if (newStart < twoHoursFromNow) return badRequest(JSON.stringify({ code: 'TOO_CLOSE_TO_START', message: 'Cannot modify booking less than 2 hours before start' }));
  }

  // Fetch listing for price recalculation
  const listingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: listingMetadataKey(booking.listingId) }));
  if (!listingResult.Item) return notFound();
  const listing = listingResult.Item;

  // Availability check (exclude this booking from conflict check)
  const conflictCheck = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `LISTING#${booking.listingId}`, ':prefix': 'BOOKING#' },
  }));
  const conflicting = (conflictCheck.Items ?? []).filter((b) => {
    if (b.bookingId === bookingId) return false;
    if (!BLOCKING_STATUSES.has(b.status)) return false;
    const bStart = new Date(b.startTime).getTime();
    const bEnd = new Date(b.endTime).getTime();
    return newStart < bEnd && newEnd > bStart;
  });
  if (conflicting.length > 0) return conflictError('SLOT_UNAVAILABLE', 'The new time slot is not available');

  const newPrice = calculatePrice(listing, newStartTime, newEndTime);
  const priceDifference = Math.round((newPrice - booking.totalPrice) * 100) / 100;
  const now = new Date().toISOString();

  // Optimistic locking — up to 3 retries
  let attempts = 0;
  let updated = false;

  while (attempts < 3 && !updated) {
    try {
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: bookingMetadataKey(bookingId),
        UpdateExpression: 'SET startTime = :s, endTime = :e, totalPrice = :p, version = :v, updatedAt = :now',
        ConditionExpression: 'version = :oldV',
        ExpressionAttributeValues: {
          ':s': newStartTime,
          ':e': newEndTime,
          ':p': newPrice,
          ':v': booking.version + 1,
          ':oldV': booking.version,
          ':now': now,
        },
      }));
      updated = true;
    } catch (e: unknown) {
      attempts++;
    }
  }

  if (!updated) {
    log.warn('concurrent modification conflict', { bookingId });
    return conflictError('CONCURRENT_MODIFICATION', 'Booking was modified concurrently, please retry');
  }

  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS,
      Source: 'spotzy',
      DetailType: 'booking.modified',
      Detail: JSON.stringify({
        bookingId,
        listingId: booking.listingId,
        listingAddress: booking.listingAddress ?? listing.address,
        hostId: booking.hostId,
        spotterId: booking.spotterId,
        oldStartTime: booking.startTime,
        oldEndTime: booking.endTime,
        newStartTime,
        newEndTime,
        priceDifference,
      }),
    }],
  }));

  const response: Record<string, unknown> = {
    bookingId,
    startTime: newStartTime,
    endTime: newEndTime,
    totalPrice: newPrice,
    status: booking.status,
  };

  if (priceDifference > 0) {
    response.requiresAdditionalPayment = true;
    response.priceDifference = priceDifference;
  } else if (priceDifference < 0) {
    response.pendingRefundAmount = Math.abs(priceDifference);
  }

  log.info('booking modified', { bookingId, newStartTime, newEndTime, priceDifference });
  return ok(response);
};
