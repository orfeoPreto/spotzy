import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchGetCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import ngeohash from 'ngeohash';
import { badRequest, ok } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { AvailabilityRule, AvailabilityBlock } from '../../../shared/types/availability';
import { isWithinAvailabilityRules, findNextAvailableSlot } from '../../../shared/availability/resolver';

interface ListingItem {
  listingId: string;
  status: string;
  pricePerHour?: number | null;
  spotType?: string;
  isPrivate?: boolean;
  addressLat: number;
  addressLng: number;
  nextAvailableAt?: string;
  // Session 26 pool extensions
  isPool?: boolean;
  bayCount?: number;
  totalBayCount?: number;
  availableBayCount?: number;
  [key: string]: unknown;
}


const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

// Haversine distance in km
const haversine = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Compute all geohash cells (precision 5) that intersect a bounding box.
 * Uses a grid approach: sample every ~0.01 degree within the bbox.
 */
function geohashCellsForBbox(swLat: number, swLng: number, neLat: number, neLng: number): string[] {
  const seen = new Set<string>();
  const step = 0.15; // ~precision-5 cell size
  for (let lat = swLat; lat <= neLat + step; lat += step) {
    for (let lng = swLng; lng <= neLng + step; lng += step) {
      const clampedLat = Math.min(lat, neLat);
      const clampedLng = Math.min(lng, neLng);
      seen.add(ngeohash.encode(clampedLat, clampedLng, 5));
    }
  }
  return Array.from(seen);
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('listing-search', event.requestContext.requestId);

  const qs = event.queryStringParameters ?? {};

  // Determine geohash cells to query
  let cells: string[];
  let searchLat = 0;
  let searchLng = 0;
  const hasBbox = qs.swLat && qs.swLng && qs.neLat && qs.neLng;

  if (hasBbox) {
    // Bounding box search — takes priority over lat/lng
    const swLat = parseFloat(qs.swLat!);
    const swLng = parseFloat(qs.swLng!);
    const neLat = parseFloat(qs.neLat!);
    const neLng = parseFloat(qs.neLng!);
    searchLat = (swLat + neLat) / 2;
    searchLng = (swLng + neLng) / 2;
    cells = geohashCellsForBbox(swLat, swLng, neLat, neLng);
    log.info('bbox search', { swLat, swLng, neLat, neLng, cells: cells.length });
  } else {
    if (!qs.lat) { log.warn('validation failed', { reason: 'missing lat' }); return badRequest('MISSING_LOCATION_PARAMS'); }
    if (!qs.lng) { log.warn('validation failed', { reason: 'missing lng' }); return badRequest('MISSING_REQUIRED_FIELD', { field: 'lng' }); }
    searchLat = parseFloat(qs.lat);
    searchLng = parseFloat(qs.lng);
    const geohash = ngeohash.encode(searchLat, searchLng, 5);
    const neighbors = ngeohash.neighbors(geohash);
    cells = [geohash, ...neighbors]; // 1 + 8 = 9
  }

  const lat = searchLat;
  const lng = searchLng;

  const startTime = qs.startDate ? new Date(qs.startDate) : null;
  const endTime = qs.endDate ? new Date(qs.endDate) : null;
  const hasDates = startTime !== null && endTime !== null && !isNaN(startTime.getTime()) && !isNaN(endTime.getTime());

  // Query GSI2 for each geohash cell
  const results = await Promise.all(
    cells.map((cell) =>
      client.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI2',
        KeyConditionExpression: 'geohash = :gh',
        ExpressionAttributeValues: { ':gh': cell },
      }))
    )
  );

  // Flatten and deduplicate by listingId (GSI2 is KEYS_ONLY — items have no full attributes yet)
  const seen = new Set<string>();
  const gsiKeys = results
    .flatMap((r) => r.Items ?? [])
    .filter((l) => {
      if (seen.has(l.listingId as string)) return false;
      seen.add(l.listingId as string);
      return true;
    });

  if (gsiKeys.length === 0) return ok({ listings: [], total: 0 });

  // BatchGet full listing items so we have all attributes (status, price, etc.)
  let listings = await batchGetListings(gsiKeys.map((l) => ({ PK: l.PK as string, SK: l.SK as string })));
  listings = listings.filter((l) => l.status === 'live');

  // Apply non-availability filters first (cheap)
  if (qs.maxPricePerHour) {
    const max = parseFloat(qs.maxPricePerHour);
    listings = listings.filter((l) => l.pricePerHour != null && l.pricePerHour <= max);
  }
  if (qs.spotType) listings = listings.filter((l) => l.spotType === qs.spotType);
  if (qs.covered === 'true') listings = listings.filter((l) => l.spotType !== 'OPEN_SPACE' && l.spotType !== 'DRIVEWAY');
  if (qs.privateOnly === 'true') listings = listings.filter((l) => l.isPrivate === true);

  if (listings.length === 0) {
    return ok({ listings: [], total: 0 });
  }

  // ---------------------------------------------------------------------------
  // Split pool listings (v2.x Session 26) from single-spot listings. Pool
  // listings don't use AVAIL_RULE#/AVAIL_BLOCK# — their availability is managed
  // at the bay level. For pools we compute availableBayCount + totalBayCount
  // from the BAY# rows and consider them always-available for the listing card.
  // ---------------------------------------------------------------------------
  const singleSpotListings: typeof listings = [];
  const poolListings: typeof listings = [];
  for (const l of listings) {
    if (l.isPool === true) poolListings.push(l);
    else singleSpotListings.push(l);
  }

  // Enrich each pool with bay counts
  for (const pool of poolListings) {
    try {
      const baysRes = await client.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LISTING#${pool.listingId}`, ':prefix': 'BAY#' },
      }));
      const allBays = baysRes.Items ?? [];
      const activeBays = allBays.filter((b) => (b.status ?? 'ACTIVE') === 'ACTIVE');
      pool.totalBayCount = allBays.length;
      pool.availableBayCount = activeBays.length;  // naive: no per-booking overlap check
      if (!pool.bayCount) pool.bayCount = allBays.length;
    } catch {
      // Best-effort — keep the pool visible even if bay lookup fails
      pool.totalBayCount = (pool.bayCount as number) ?? 0;
      pool.availableBayCount = (pool.bayCount as number) ?? 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Availability filtering — batch fetch AVAIL_RULE records (single-spot only)
  // ---------------------------------------------------------------------------
  const rulesMap = await batchFetchRules(singleSpotListings.map((l) => l.listingId));

  // Exclude single-spot listings with no rules at all
  listings = singleSpotListings.filter((l) => (rulesMap.get(l.listingId) ?? []).length > 0);

  if (hasDates) {
    // Batch fetch AVAIL_BLOCK records for all remaining listings over the requested period
    const fromDate = startTime!.toISOString().slice(0, 10);
    const toDate = endTime!.toISOString().slice(0, 10);
    const blocksMap = await batchFetchBlocks(listings.map((l) => l.listingId), fromDate, toDate);

    listings = listings.filter((l) => {
      const rules = rulesMap.get(l.listingId) ?? [];
      const { covered } = isWithinAvailabilityRules(rules, startTime!, endTime!);
      if (!covered) return false;
      // Check blocks
      const blocks = blocksMap.get(l.listingId) ?? [];
      const { covered: stillCovered } = isWithinAvailabilityRules(
        rules.filter((r) => r.type === 'ALWAYS' ? !hasBlockConflict(blocks, startTime!, endTime!) : true),
        startTime!, endTime!
      );
      // Simpler: check if any block fully covers the period
      return !hasBlockConflict(blocks, startTime!, endTime!);
    });
  } else {
    // No dates — include only listings that have at least one slot in the next 30 days
    const now = new Date();
    const fromDate = now.toISOString().slice(0, 10);
    const toDate = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    const blocksMap = await batchFetchBlocks(listings.map((l) => l.listingId), fromDate, toDate);

    const withAvailability: typeof listings = [];
    for (const l of listings) {
      const rules = rulesMap.get(l.listingId) ?? [];
      const blocks = blocksMap.get(l.listingId) ?? [];
      const nextSlot = findNextAvailableSlot(rules, blocks, now, 30);
      if (nextSlot !== null) {
        l.nextAvailableAt = nextSlot.toISOString();
        withAvailability.push(l);
      }
    }
    listings = withAvailability;
  }

  // Merge pool listings back in — pools bypass listing-level availability rules
  // because bay availability is computed per-bay at booking time.
  listings = [...listings, ...poolListings];

  // Sort by distance
  listings.sort((a, b) =>
    haversine(lat, lng, a.addressLat, a.addressLng) - haversine(lat, lng, b.addressLat, b.addressLng)
  );

  listings = listings.slice(0, 50);

  // Enrich with host profile data (name + photo for listing card footer)
  const hostIds = [...new Set(listings.map((l) => l.hostId as string).filter(Boolean))];
  const hostProfiles = new Map<string, Record<string, unknown>>();
  if (hostIds.length > 0) {
    const profileResults = await Promise.all(
      hostIds.map((hid) =>
        client.send(new GetCommand({
          TableName: TABLE,
          Key: { PK: `USER#${hid}`, SK: 'PROFILE' },
          ProjectionExpression: 'userId, #n, photoUrl',
          ExpressionAttributeNames: { '#n': 'name' },
        }))
      )
    );
    for (const r of profileResults) {
      if (r.Item) hostProfiles.set(r.Item.userId as string, r.Item);
    }
  }

  const enrichedListings = listings.map((l) => {
    const host = hostProfiles.get(l.hostId as string);
    const fullName = (host?.name as string) ?? '';
    const parts = fullName.trim().split(/\s+/);
    return {
      ...l,
      hostId: l.hostId,
      hostFirstName: parts[0] ?? '',
      hostLastName: parts.length > 1 ? `${parts[parts.length - 1][0]}.` : '',
      hostPhotoUrl: (host?.photoUrl as string) ?? null,
    };
  });

  log.info('search complete', { lat: qs.lat, lng: qs.lng, total: enrichedListings.length });
  return ok({ listings: enrichedListings, total: enrichedListings.length });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function batchFetchRules(listingIds: string[]): Promise<Map<string, AvailabilityRule[]>> {
  const map = new Map<string, AvailabilityRule[]>();
  if (listingIds.length === 0) return map;

  // Query per listing (can't BatchGet with begins_with — must Query individually but in parallel)
  const queries = await Promise.all(
    listingIds.map((id) =>
      client.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LISTING#${id}`, ':prefix': 'AVAIL_RULE#' },
      }))
    )
  );

  listingIds.forEach((id, i) => {
    map.set(id, (queries[i].Items ?? []) as AvailabilityRule[]);
  });
  return map;
}

async function batchFetchBlocks(
  listingIds: string[],
  fromDate: string,
  toDate: string,
): Promise<Map<string, AvailabilityBlock[]>> {
  const map = new Map<string, AvailabilityBlock[]>();
  if (listingIds.length === 0) return map;

  const queries = await Promise.all(
    listingIds.map((id) =>
      client.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
        ExpressionAttributeValues: {
          ':pk': `LISTING#${id}`,
          ':from': `AVAIL_BLOCK#${fromDate}`,
          ':to': `AVAIL_BLOCK#${toDate}~`,
        },
      }))
    )
  );

  listingIds.forEach((id, i) => {
    map.set(id, (queries[i].Items ?? []) as AvailabilityBlock[]);
  });
  return map;
}

async function batchGetListings(keys: Array<{ PK: string; SK: string }>): Promise<ListingItem[]> {
  if (keys.length === 0) return [];
  const all: ListingItem[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const res = await client.send(new BatchGetCommand({
      RequestItems: { [TABLE]: { Keys: chunk } },
    }));
    all.push(...((res.Responses?.[TABLE] ?? []) as ListingItem[]));
  }
  return all;
}


function hasBlockConflict(blocks: AvailabilityBlock[], startTime: Date, endTime: Date): boolean {
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  return blocks.some((b) => {
    const bStart = new Date(b.startTime).getTime();
    const bEnd = new Date(b.endTime).getTime();
    return startMs < bEnd && endMs > bStart;
  });
}
