import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger } from '../../../shared/utils/logger';
import { bulkAllocate } from '../../../shared/block-reservations/allocator';
import type { PoolCandidate, AllocationItem } from '../../../shared/block-reservations/allocator';
import type { PlanSummary, PlanAllocation, BlockRequestPreferences } from '../../../shared/block-reservations/types';
import {
  MAX_PLANS_RETURNED,
  DEFAULT_HISTORICAL_ALLOCATION_RATE,
  PERCENTAGE_RATE,
  MIN_BAYS_FLOOR_RATIO,
} from '../../../shared/block-reservations/constants';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler = async (event: any) => {
  const reqId = event.detail?.reqId;
  const log = createLogger('block-match', reqId ?? 'unknown');

  if (!reqId) {
    log.error('missing reqId in event detail');
    return;
  }

  // Load the block request
  const reqResult = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
  }));

  const blockReq = reqResult.Item;
  if (!blockReq) {
    log.warn('block request not found', { reqId });
    return;
  }

  if (blockReq.status !== 'PENDING_MATCH') {
    log.info('skipping — not in PENDING_MATCH', { reqId, status: blockReq.status });
    return;
  }

  const preferences = (blockReq.preferences ?? {}) as BlockRequestPreferences;

  // Compute the block window duration (in hours) — used to derive per-bay price
  const startsAt = new Date(blockReq.startsAt as string);
  const endsAt = new Date(blockReq.endsAt as string);
  const windowHours = Math.max(1, Math.ceil((endsAt.getTime() - startsAt.getTime()) / 3600_000));
  const windowDays = Math.max(1, Math.ceil(windowHours / 24));

  // Load eligible pools via the POOL_OPTED_IN projection (sparse — only exists
  // when a Spot Manager opts the pool into block reservations). Each projection
  // row carries the listingId; we then BatchGet the full LISTING# records to
  // get the current pool metadata (bay counts, pricing, risk share mode, etc.).
  const optedInResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': 'POOL_OPTED_IN', ':prefix': 'LISTING#' },
  }));

  const optedInIds = (optedInResult.Items ?? []).map((r) => r.listingId as string).filter(Boolean);
  let pools: Record<string, any>[] = [];
  if (optedInIds.length > 0) {
    // BatchGetItem handles up to 100 keys per call; pool opt-in is rare enough that
    // a single call is sufficient for dev-local + early production.
    const batchRes = await ddb.send(new BatchGetCommand({
      RequestItems: {
        [TABLE]: {
          Keys: optedInIds.map((id) => ({ PK: `LISTING#${id}`, SK: 'METADATA' })),
        },
      },
    }));
    pools = (batchRes.Responses?.[TABLE] ?? [])
      // Keep only live pools — opt-in projection might point at a draft/suspended listing
      .filter((p) => p.isPool === true && (p.status === 'live' || !p.status));
  }
  log.info('pools discovered', { count: pools.length });

  // Filter by minPoolRating (rating lives on the listing when populated)
  if (preferences.minPoolRating) {
    pools = pools.filter((p) => (p.rating as number ?? p.poolRating as number ?? 5.0) >= preferences.minPoolRating!);
  }

  // `blockReservationCapable` lives on the owner's USER PROFILE, not on the listing.
  // For requireVerifiedSpotManager, batch-fetch each unique owner's profile and keep
  // only pools whose owner has blockReservationCapable === true (i.e. RC insurance
  // approved by admin).
  if (preferences.requireVerifiedSpotManager && pools.length > 0) {
    const uniqueOwnerIds = [...new Set(pools.map((p) => p.hostId as string).filter(Boolean))];
    const profileMap = new Map<string, boolean>();
    for (const ownerId of uniqueOwnerIds) {
      const profileRes = await ddb.send(new GetCommand({
        TableName: TABLE,
        Key: { PK: `USER#${ownerId}`, SK: 'PROFILE' },
      }));
      profileMap.set(ownerId, profileRes.Item?.blockReservationCapable === true);
    }
    pools = pools.filter((p) => profileMap.get(p.hostId as string) === true);
    log.info('pools filtered by verified spot manager', { count: pools.length });
  }

  // Build candidate pools with bay availability
  const candidates: PoolCandidate[] = [];
  for (const pool of pools) {
    const listingId = pool.listingId as string;

    // Query bays under this listing
    const baysResult = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `LISTING#${listingId}`,
        ':prefix': 'BAY#',
      },
    }));

    const allBays = baysResult.Items ?? [];
    // Session 26: BAY status is ACTIVE | TEMPORARILY_CLOSED | PERMANENTLY_REMOVED
    const availableBayIds = allBays
      .filter((b) => (b.status ?? 'ACTIVE') === 'ACTIVE')
      .map((b) => b.bayId as string);

    if (availableBayIds.length === 0) continue;

    // Per-bay price for this block window: derive from pricePerHourEur using the daily
    // tier (dailyDiscountPct). For multi-day blocks, multiply by the number of days.
    const pricePerHourEur = (pool.pricePerHourEur as number) ?? (pool.pricePerHour as number) ?? 0;
    const dailyDiscountPct = (pool.dailyDiscountPct as number) ?? 0.60;
    const dailyRate = pricePerHourEur * 24 * dailyDiscountPct;
    const pricePerBayEur = Math.round(dailyRate * windowDays * 100) / 100;

    candidates.push({
      poolListingId: listingId,
      spotManagerUserId: pool.hostId as string,
      totalBayCount: (pool.bayCount as number) ?? allBays.length,
      availableBayIds,
      pricePerBayEur,
      riskShareMode: (pool.riskShareMode as 'PERCENTAGE' | 'MIN_BAYS_FLOOR' | undefined) ?? 'PERCENTAGE',
      riskShareRate: pool.riskShareMode === 'MIN_BAYS_FLOOR' ? MIN_BAYS_FLOOR_RATIO : PERCENTAGE_RATE,
      poolRating: (pool.rating as number) ?? 5.0,
      spotManagerVerified: pool.spotManagerVerified === true || pool.blockReservationCapable === true,
      walkingDistanceMeters: null,
      latitude: (pool.addressLat as number) ?? 50.85,
      longitude: (pool.addressLng as number) ?? 4.35,
    });
  }

  log.info('eligible pool candidates', { count: candidates.length });

  // Filter by maxWalkingTimeFromPoint
  if (preferences.maxWalkingTimeFromPoint) {
    const ref = preferences.maxWalkingTimeFromPoint;
    const maxMeters = ref.minutes * 80; // ~80m per minute walking
    candidates.forEach((c) => {
      const R = 6_371_000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(c.latitude - ref.lat);
      const dLng = toRad(c.longitude - ref.lng);
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(ref.lat)) * Math.cos(toRad(c.latitude)) * Math.sin(dLng / 2) ** 2;
      c.walkingDistanceMeters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    });
    const filtered = candidates.filter((c) => (c.walkingDistanceMeters ?? Infinity) <= maxMeters);
    candidates.length = 0;
    candidates.push(...filtered);
  }

  // Generate plans
  const bayCount = blockReq.bayCount as number;
  const plans: PlanSummary[] = [];

  // Sort candidates by cost for the primary plan
  const byCost = [...candidates].sort((a, b) => a.pricePerBayEur - b.pricePerBayEur);

  // Generate a greedy plan from a sorted candidate list
  const generatePlan = (sorted: PoolCandidate[], rationale: string, planIndex: number): PlanSummary | null => {
    let remaining = bayCount;
    const allocations: PlanAllocation[] = [];

    for (const pool of sorted) {
      if (remaining <= 0) break;
      if (preferences.maxCounterparties && allocations.length >= preferences.maxCounterparties) break;

      const contribute = Math.min(pool.availableBayIds.length, remaining);
      if (contribute === 0) continue;

      allocations.push({
        poolListingId: pool.poolListingId,
        spotManagerUserId: pool.spotManagerUserId,
        contributedBayCount: contribute,
        riskShareMode: pool.riskShareMode,
        riskShareRate: pool.riskShareRate,
        pricePerBayEur: pool.pricePerBayEur,
        walkingDistanceMeters: pool.walkingDistanceMeters,
        poolRating: pool.poolRating,
      });
      remaining -= contribute;
    }

    if (allocations.length === 0) return null;

    const worstCaseEur = allocations.reduce((sum, a) => sum + a.contributedBayCount * a.pricePerBayEur, 0);
    const bestCaseEur = allocations.reduce((sum, a) => {
      if (a.riskShareMode === 'PERCENTAGE') {
        return sum + a.contributedBayCount * a.pricePerBayEur * a.riskShareRate;
      }
      // MIN_BAYS_FLOOR
      const floor = Math.ceil(a.contributedBayCount * a.riskShareRate);
      return sum + floor * a.pricePerBayEur;
    }, 0);
    const historicalRate = DEFAULT_HISTORICAL_ALLOCATION_RATE;
    const projectedCaseEur = bestCaseEur + (worstCaseEur - bestCaseEur) * historicalRate;

    return {
      planIndex,
      rationale,
      worstCaseEur: Math.round(worstCaseEur * 100) / 100,
      bestCaseEur: Math.round(bestCaseEur * 100) / 100,
      projectedCaseEur: Math.round(projectedCaseEur * 100) / 100,
      allocations,
    };
  };

  // Plan 1: cheapest pools
  const plan1 = generatePlan(byCost, 'Lowest cost', 0);
  if (plan1) plans.push(plan1);

  // Plan 2: fewest counterparties (sort by capacity desc)
  const byCapacity = [...candidates].sort((a, b) => b.availableBayIds.length - a.availableBayIds.length);
  const plan2 = generatePlan(byCapacity, 'Fewest counterparties', 1);
  if (plan2 && JSON.stringify(plan2.allocations.map(a => a.poolListingId)) !== JSON.stringify(plan1?.allocations.map(a => a.poolListingId))) {
    plans.push(plan2);
  }

  // Plan 3: highest rated
  const byRating = [...candidates].sort((a, b) => b.poolRating - a.poolRating);
  const plan3 = generatePlan(byRating, 'Highest rated pools', 2);
  if (plan3) {
    const existingIds = plans.map(p => JSON.stringify(p.allocations.map(a => a.poolListingId)));
    const plan3Ids = JSON.stringify(plan3.allocations.map(a => a.poolListingId));
    if (!existingIds.includes(plan3Ids)) {
      plans.push(plan3);
    }
  }

  // Sort plans by tiebreak: fewest counterparties → lowest cost → shortest walking → highest rating
  plans.sort((a, b) => {
    if (a.allocations.length !== b.allocations.length) return a.allocations.length - b.allocations.length;
    if (a.worstCaseEur !== b.worstCaseEur) return a.worstCaseEur - b.worstCaseEur;
    return 0;
  });

  // Re-index
  const topPlans = plans.slice(0, MAX_PLANS_RETURNED).map((p, i) => ({ ...p, planIndex: i }));

  const now = new Date().toISOString();

  // Write plans to BLOCKREQ#
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
    UpdateExpression: 'SET #status = :s, proposedPlans = :plans, proposedPlansComputedAt = :now, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':s': 'PLANS_PROPOSED',
      ':plans': topPlans,
      ':now': now,
    },
  }));

  log.info('block match complete', { reqId, planCount: topPlans.length });
};
