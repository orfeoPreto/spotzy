import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const REVENUE_STATUSES = new Set(['CONFIRMED', 'ACTIVE', 'COMPLETED']);

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('portfolio', event.requestContext.requestId, claims?.userId);

  if (!claims) {
    log.warn('unauthorized');
    return unauthorized();
  }

  // Check spotManagerStatus
  const userResult = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USER#${claims.userId}`, SK: 'PROFILE' },
  }));
  const user = userResult.Item;
  if (!user || !['STAGED', 'ACTIVE'].includes(user.spotManagerStatus)) {
    log.warn('spot manager status invalid', { status: user?.spotManagerStatus });
    return badRequest('SPOT_MANAGER_STATUS_REQUIRED');
  }

  // Get all user's listings via GSI1
  const listingsResult = await client.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `HOST#${claims.userId}`,
      ':prefix': 'LISTING#',
    },
  }));
  const listings = listingsResult.Items ?? [];

  const now = new Date();
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  let totalPools = 0;
  let totalBays = 0;
  let occupiedBays = 0;
  let mtdRevenue = 0;
  let allTimeRevenue = 0;

  const listingBreakdowns: any[] = [];

  for (const listing of listings) {
    const listingId = listing.listingId;

    // Get bookings for this listing
    const bookingsResult = await client.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'BOOKING#' },
    }));
    const bookings = bookingsResult.Items ?? [];

    const activeBookings = bookings.filter(
      (b) => REVENUE_STATUSES.has(b.status) && b.endTime > now.toISOString()
    );
    const completedBookings = bookings.filter(
      (b) => REVENUE_STATUSES.has(b.status)
    );

    const listingAllTimeRevenue = completedBookings.reduce(
      (sum, b) => sum + (b.hostPayout ?? 0), 0
    );
    const listingMtdRevenue = completedBookings
      .filter((b) => b.createdAt >= mtdStart)
      .reduce((sum, b) => sum + (b.hostPayout ?? 0), 0);

    allTimeRevenue += listingAllTimeRevenue;
    mtdRevenue += listingMtdRevenue;

    const breakdown: any = {
      listingId,
      address: listing.address,
      status: listing.status,
      isPool: listing.isPool ?? false,
      blockReservationsOptedIn: listing.blockReservationsOptedIn === true,
      riskShareMode: (listing.riskShareMode as string) ?? null,
      activeBookings: activeBookings.length,
      totalBookings: bookings.length,
      allTimeRevenue: Math.round(listingAllTimeRevenue * 100) / 100,
      mtdRevenue: Math.round(listingMtdRevenue * 100) / 100,
    };

    if (listing.isPool) {
      totalPools++;

      // Query BAY# children
      const baysResult = await client.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'BAY#' },
      }));
      const bays = baysResult.Items ?? [];

      const activeBays = bays.filter((b) => b.status === 'ACTIVE');
      const bayStatusGrid = bays.map((b) => ({
        bayId: b.bayId,
        label: b.label,
        status: b.status,
      }));

      // Count occupied bays (bays with at least one active booking)
      const occupiedBayIds = new Set(
        activeBookings
          .filter((b) => b.poolSpotId)
          .map((b) => b.poolSpotId)
      );

      totalBays += activeBays.length;
      occupiedBays += occupiedBayIds.size;

      breakdown.bayCount = bays.length;
      breakdown.activeBays = activeBays.length;
      breakdown.occupiedBays = occupiedBayIds.size;
      breakdown.bayStatusGrid = bayStatusGrid;
    }

    listingBreakdowns.push(breakdown);
  }

  log.info('portfolio fetched', {
    totalListings: listings.length,
    totalPools,
    totalBays,
  });

  return ok({
    summary: {
      totalListings: listings.length,
      totalPools,
      totalBays,
      occupiedBays,
      mtdRevenue: Math.round(mtdRevenue * 100) / 100,
      allTimeRevenue: Math.round(allTimeRevenue * 100) / 100,
    },
    listings: listingBreakdowns,
  });
};
