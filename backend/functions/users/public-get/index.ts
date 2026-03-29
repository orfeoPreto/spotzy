import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound } from '../../../shared/utils/response';
import { userProfileKey, hostListingsGsi1Key, reviewKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

// Fields that must never be returned in public profile
const PII_FIELDS = new Set(['email', 'phone', 'address', 'stripeConnectAccountId', 'PK', 'SK', 'GSI1PK', 'GSI1SK']);

function formatPublicName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function stripPii(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!PII_FIELDS.has(k)) result[k] = v;
  }
  return result;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('user-public-get', event.requestContext.requestId, claims?.userId);
  if (!claims) return unauthorized();

  const userId = event.pathParameters?.id;
  if (!userId) return badRequest('Missing user id');

  // Fetch user profile
  const userRes = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: userProfileKey(userId),
  }));
  if (!userRes.Item) return notFound();

  const user = userRes.Item;
  const publicName = formatPublicName(user.name ?? user.displayName ?? 'User');

  // Fetch LIVE listings if user is a host
  let listings: Record<string, unknown>[] = [];
  const hostListingsRes = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: '#status = :live',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':pk': `HOST#${userId}`,
      ':live': 'live',
    },
  }));

  listings = (hostListingsRes.Items ?? []).map((l) => ({
    listingId: l.listingId,
    address: l.address,
    spotType: l.spotType,
    pricePerHour: l.pricePerHour,
    rating: l.rating,
    photos: l.photos ? [(l.photos as string[])[0]] : [],
  }));

  // Fetch bookings as spotter (for completedBookings count and responseRate)
  const spotterBookingsRes = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `SPOTTER#${userId}` },
  }));
  const allSpotterBookings = spotterBookingsRes.Items ?? [];
  const completedBookings = allSpotterBookings.filter((b) => b.status === 'COMPLETED').length;

  // Response rate: only show when >= 5 completed bookings
  // Calculated as percentage of bookings that were completed (not cancelled)
  let responseRate: number | null = null;
  if (completedBookings >= 5) {
    const totalFinished = allSpotterBookings.filter(
      (b) => b.status === 'COMPLETED' || b.status === 'CANCELLED'
    ).length;
    responseRate = totalFinished > 0
      ? Math.round((completedBookings / totalFinished) * 100)
      : 100;
  }

  // Fetch published reviews for this user
  const reviewsRes = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    FilterExpression: 'published = :t',
    ExpressionAttributeValues: {
      ':pk': `REVIEW#${userId}`,
      ':t': true,
    },
  }));

  const reviews = (reviewsRes.Items ?? []).map((r) => ({
    reviewId: r.reviewId,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
  }));

  const publicProfile = {
    userId,
    name: publicName,
    memberSince: user.createdAt,
    listings,
    reviews,
    reviewCount: reviews.length,
    averageRating: reviews.length > 0
      ? reviews.reduce((sum, r) => sum + (r.rating as number), 0) / reviews.length
      : null,
    completedBookings,
    responseRate,
  };

  log.info('public profile fetched', { userId, listingCount: listings.length });
  return ok(publicProfile);
};
