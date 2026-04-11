import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ok, badRequest } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import * as ngeohash from 'ngeohash';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('agent-search', event.requestContext.requestId);
  const params = event.queryStringParameters ?? {};
  const { lat, lng, startTime, endTime, maxPricePerDayEur, covered, evCharging } = params;

  if (!lat || !lng) return badRequest('lat and lng are required');

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  if (isNaN(latitude) || isNaN(longitude)) return badRequest('lat and lng must be numbers');

  const precision = 5;
  const centerHash = ngeohash.encode(latitude, longitude, precision);
  const neighbors = ngeohash.neighbors(centerHash);
  const hashes = [centerHash, ...Object.values(neighbors)];

  const listings: any[] = [];
  for (const hash of hashes) {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI2',
      KeyConditionExpression: 'geohash = :gh',
      ExpressionAttributeValues: { ':gh': hash },
    }));

    for (const item of result.Items ?? []) {
      // Fetch full listing
      const full = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: { ':pk': `LISTING#${item.listingId}`, ':sk': 'METADATA' },
      }));
      const listing = full.Items?.[0];
      if (!listing || listing.status !== 'LIVE') continue;
      if (listing.inPool) continue; // Pool listings excluded from individual search

      // Apply filters
      if (covered === 'true' && !listing.covered) continue;
      if (evCharging === 'true' && !listing.evCharging) continue;
      if (maxPricePerDayEur && listing.pricePerDay > parseFloat(maxPricePerDayEur)) continue;

      listings.push({
        listingId: listing.listingId ?? item.listingId,
        address: listing.address,
        spotType: listing.spotType,
        spotTypeLabel: listing.spotTypeLabel ?? listing.spotType,
        pricePerHour: listing.pricePerHour ?? null,
        pricePerDay: listing.pricePerDay ?? null,
        rating: listing.avgRating ?? null,
        reviewCount: listing.reviewCount ?? 0,
        evCharging: listing.evCharging ?? false,
        covered: listing.covered ?? false,
        walkingMinutes: listing.walkingMinutes ?? null,
      });
    }
  }

  log.info('agent search', { lat: latitude, lng: longitude, results: listings.length });
  return ok({ listings, total: listings.length });
};
