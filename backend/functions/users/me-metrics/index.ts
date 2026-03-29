import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('user-me-metrics', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const [listingsResult, bookingsResult] = await Promise.all([
    ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `HOST#${claims.userId}` },
    })),
    ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `SPOTTER#${claims.userId}` },
    })),
  ]);

  const listings = listingsResult.Items ?? [];
  const bookings = bookingsResult.Items ?? [];

  const liveListings = listings.filter((l) => l.status === 'live').length;
  const activeBookings = bookings.filter((b) => b.status === 'ACTIVE' || b.status === 'CONFIRMED').length;

  // MTD earnings: sum hostPayout for COMPLETED bookings this month
  const now = new Date();
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const mtdEarnings = bookings
    .filter((b) => b.status === 'COMPLETED' && b.updatedAt >= mtdStart)
    .reduce((sum, b) => sum + ((b.hostPayout as number) ?? 0), 0);

  // Average rating from host's listings
  const ratedListings = listings.filter((l) => l.avgRating != null);
  const avgRating = ratedListings.length > 0
    ? ratedListings.reduce((sum, l) => sum + (l.avgRating as number), 0) / ratedListings.length
    : 0;

  log.info('metrics computed', { liveListings, activeBookings, mtdEarnings });
  return ok({
    liveListings,
    activeBookings,
    mtdEarnings: Math.round(mtdEarnings * 100) / 100,
    avgRating: Math.round(avgRating * 10) / 10,
  });
};
