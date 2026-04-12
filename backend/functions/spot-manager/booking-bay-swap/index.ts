import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, conflict } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const ACTIVE_BOOKING_STATUSES = new Set(['CONFIRMED', 'ACTIVE', 'PENDING_PAYMENT']);

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('booking-bay-swap', event.requestContext.requestId, claims?.userId);

  if (!claims) {
    log.warn('unauthorized');
    return unauthorized();
  }

  const bookingId = event.pathParameters?.bookingId;
  if (!bookingId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'bookingId' });

  let body: any;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return badRequest('INVALID_JSON_BODY');
  }

  const { targetBayId } = body;
  if (!targetBayId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'targetBayId' });

  // Load booking
  const bookingResult = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
  }));
  const booking = bookingResult.Item;
  if (!booking) return notFound();

  // Verify it's a pool booking
  const poolId = booking.listingId;
  if (!booking.poolSpotId) {
    return badRequest('NOT_A_POOL_BOOKING');
  }

  // Verify caller is pool owner
  const listingResult = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `LISTING#${poolId}`, SK: 'METADATA' },
  }));
  const listing = listingResult.Item;
  if (!listing) return notFound();
  if (listing.hostId !== claims.userId) {
    log.warn('not pool owner', { poolId, userId: claims.userId });
    return unauthorized();
  }

  // Validate target bay is in same pool and is ACTIVE
  const targetBayResult = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `LISTING#${poolId}`, SK: `BAY#${targetBayId}` },
  }));
  const targetBay = targetBayResult.Item;
  if (!targetBay) return badRequest('BAY_NOT_FOUND');
  if (targetBay.status !== 'ACTIVE') {
    return badRequest('BAY_NOT_ACTIVE');
  }

  // Check target bay availability for booking window
  const bookingsResult = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `LISTING#${poolId}`, ':prefix': 'BOOKING#' },
  }));
  const conflicting = (bookingsResult.Items ?? []).filter((b) => {
    if (b.bookingId === bookingId) return false; // skip current booking
    if (b.poolSpotId !== targetBayId) return false;
    if (!ACTIVE_BOOKING_STATUSES.has(b.status)) return false;
    const bStart = new Date(b.startTime).getTime();
    const bEnd = new Date(b.endTime).getTime();
    const start = new Date(booking.startTime).getTime();
    const end = new Date(booking.endTime).getTime();
    return start < bEnd && end > bStart;
  });

  if (conflicting.length > 0) {
    return conflict('BAY_NOT_AVAILABLE');
  }

  // Perform the swap
  const now = new Date().toISOString();
  const auditEntry = {
    action: 'BAY_SWAP',
    fromBayId: booking.poolSpotId,
    toBayId: targetBayId,
    swappedBy: claims.userId,
    timestamp: now,
  };

  const result = await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
    UpdateExpression: 'SET poolSpotId = :targetBayId, updatedAt = :now, auditLog = list_append(if_not_exists(auditLog, :emptyList), :auditEntry)',
    ExpressionAttributeValues: {
      ':targetBayId': targetBayId,
      ':now': now,
      ':auditEntry': [auditEntry],
      ':emptyList': [],
    },
    ReturnValues: 'ALL_NEW',
  }));

  log.info('bay swap completed', { bookingId, fromBay: booking.poolSpotId, toBay: targetBayId });

  return ok(result.Attributes);
};
