import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { forbidden } from '../../../shared/utils/admin-response';
import { ok, badRequest, notFound } from '../../../shared/utils/response';
import { userProfileKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const ACTIVE_LISTING_STATUSES = new Set(['live', 'draft', 'LIVE', 'DRAFT']);
const ACTIVE_BOOKING_STATUSES = new Set(['PENDING', 'CONFIRMED', 'ACTIVE']);

export const handler: APIGatewayProxyHandler = async (event) => {
  const admin = extractAdminClaims(event);
  const log = createLogger('admin-customer-get', event.requestContext.requestId, admin?.userId);
  if (!admin) return forbidden();

  const userId = event.pathParameters?.userId;
  if (!userId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'userId' });

  const includeHistory = event.queryStringParameters?.includeHistory === 'true';

  // Fetch user profile
  const userResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(userId) }));
  if (!userResult.Item) return notFound();
  const user = userResult.Item;

  // Fetch listings (HOST#userId via GSI1)
  const listingsResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `HOST#${userId}` },
  }));
  const allListings = listingsResult.Items ?? [];
  const activeListings = allListings.filter((l) => ACTIVE_LISTING_STATUSES.has(l.status as string));
  const historyListings = allListings.filter((l) => !ACTIVE_LISTING_STATUSES.has(l.status as string));

  // Fetch bookings (SPOTTER#userId via GSI1)
  const bookingsResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `SPOTTER#${userId}` },
  }));
  const allBookings = bookingsResult.Items ?? [];
  const activeBookings = allBookings.filter((b) => ACTIVE_BOOKING_STATUSES.has(b.status as string));
  const historyBookings = allBookings.filter((b) => !ACTIVE_BOOKING_STATUSES.has(b.status as string));

  // Fetch disputes (scan for disputes where host or spotter is this user)
  const disputesResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `DISPUTES_BY_USER#${userId}` },
  }));
  // Fallback: if no dedicated partition, just return any disputes found in bookings
  let disputes = disputesResult.Items ?? [];
  if (disputes.length === 0) {
    // Query disputes for each booking
    const bookingIds = allBookings.map((b) => b.bookingId as string);
    const disputePromises = bookingIds.map((bId) =>
      ddb.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: { ':pk': `BOOKING#${bId}`, ':sk': 'DISPUTE#' },
      })),
    );
    const results = await Promise.all(disputePromises);
    disputes = results.flatMap((r) => r.Items ?? []);
  }

  const personas: string[] = ['SPOTTER'];
  if (user.isHost === true || user.stripeConnectEnabled === true || user.role === 'HOST' || user.role === 'both') {
    personas.push('HOST');
  }

  const response: Record<string, unknown> = {
    userId,
    displayName: (user.pseudo as string)?.trim() || (user.firstName as string) || (user.name as string)?.split(' ')[0] || 'Unknown',
    firstName: user.firstName ?? (user.name as string)?.split(' ')[0],
    lastName: user.lastName ?? (user.name as string)?.split(' ').slice(1).join(' '),
    email: user.email,
    phone: user.phone,
    photoUrl: user.profilePhotoUrl ?? user.photoUrl ?? null,
    personas,
    rating: user.rating ?? null,
    memberSince: user.createdAt,
    status: user.status ?? 'ACTIVE',
    listings: {
      active: activeListings.map(simplifyListing),
      ...(includeHistory ? { history: historyListings.map(simplifyListing) } : {}),
    },
    bookings: {
      active: activeBookings.map(simplifyBooking),
      ...(includeHistory ? { history: historyBookings.map(simplifyBooking) } : {}),
    },
    disputes: disputes.map(simplifyDispute),
  };

  log.info('customer fetched', { userId });
  return ok(response);
};

function simplifyListing(l: Record<string, unknown>) {
  return {
    listingId: l.listingId,
    address: l.address,
    status: l.status,
    pricePerHour: l.pricePerHour,
  };
}

function simplifyBooking(b: Record<string, unknown>) {
  return {
    bookingId: b.bookingId,
    status: b.status,
    listingAddress: b.listingAddress,
    startTime: b.startTime,
    endTime: b.endTime,
    totalPrice: b.totalPrice,
  };
}

function simplifyDispute(d: Record<string, unknown>) {
  return {
    disputeId: d.disputeId,
    status: d.status,
    bookingId: d.bookingId,
    reason: d.reason,
    createdAt: d.createdAt,
  };
}
