import type { BlockRequestPreferences, RiskShareMode } from './types';

export interface PoolCandidate {
  poolListingId: string;
  spotManagerUserId: string;
  totalBayCount: number;
  availableBayIds: string[];
  pricePerBayEur: number;
  riskShareMode: RiskShareMode;
  riskShareRate: number;
  poolRating: number;
  spotManagerVerified: boolean;
  walkingDistanceMeters: number | null;
  latitude: number;
  longitude: number;
}

export interface AllocationItem {
  itemId: string;
  preferredLat?: number;
  preferredLng?: number;
}

export interface AllocationResult {
  itemId: string;
  poolListingId: string;
  bayId: string;
  marginalCostEur: number;
}

export interface AllocatorWeights {
  cost: number;
  geo: number;
}

/**
 * Haversine distance in meters between two lat/lng pairs.
 */
function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function deriveWeights(preferences: BlockRequestPreferences): AllocatorWeights {
  if (preferences.maxWalkingTimeFromPoint) {
    return { cost: 0.4, geo: 0.6 };
  }
  if (preferences.clusterTogether) {
    return { cost: 0.5, geo: 0.5 };
  }
  return { cost: 0.8, geo: 0.2 };
}

interface CandidateBay {
  poolListingId: string;
  bayId: string;
  marginalCostEur: number;
  distanceMeters: number;
}

/**
 * Compute weighted greedy allocation of items to bays.
 *
 * Deterministic: same inputs always produce same outputs.
 * Tiebreak: lowest bayId (lexicographic).
 */
export function bulkAllocate(
  items: AllocationItem[],
  pools: PoolCandidate[],
  preferences: BlockRequestPreferences
): AllocationResult[] {
  const weights = deriveWeights(preferences);

  // Deep copy available bay sets so we can mutate
  const available = new Map<string, Set<string>>();
  const poolMap = new Map<string, PoolCandidate>();
  for (const pool of pools) {
    available.set(pool.poolListingId, new Set([...pool.availableBayIds].sort()));
    poolMap.set(pool.poolListingId, pool);
  }

  // Track per-pool allocation count for marginal cost computation
  const poolAllocCount = new Map<string, number>();
  for (const pool of pools) {
    poolAllocCount.set(pool.poolListingId, 0);
  }

  // Sort items by itemId lexicographically (deterministic)
  const sortedItems = [...items].sort((a, b) => a.itemId.localeCompare(b.itemId));

  const results: AllocationResult[] = [];

  for (const item of sortedItems) {
    // Build candidate bays
    const candidates: CandidateBay[] = [];
    for (const pool of pools) {
      const baySet = available.get(pool.poolListingId)!;
      for (const bayId of baySet) {
        const allocCount = poolAllocCount.get(pool.poolListingId)!;
        const marginalCost = computeMarginalCost(pool, allocCount);
        // Use item's preferred position, falling back to the preference reference point
        const refLat = item.preferredLat ?? preferences.maxWalkingTimeFromPoint?.lat;
        const refLng = item.preferredLng ?? preferences.maxWalkingTimeFromPoint?.lng;
        const dist =
          refLat !== undefined && refLng !== undefined
            ? haversineMeters(refLat, refLng, pool.latitude, pool.longitude)
            : 0;
        candidates.push({
          poolListingId: pool.poolListingId,
          bayId,
          marginalCostEur: marginalCost,
          distanceMeters: dist,
        });
      }
    }

    if (candidates.length === 0) break;

    // Compute scores
    const maxCost = Math.max(...candidates.map((c) => c.marginalCostEur));
    const maxDist = Math.max(...candidates.map((c) => c.distanceMeters));

    const scored = candidates.map((c) => {
      const costScore =
        maxCost === 0 ? 1.0 : 1.0 - c.marginalCostEur / maxCost;
      const geoScore =
        maxDist === 0 ? 1.0 : 1.0 - c.distanceMeters / maxDist;
      const score = weights.cost * costScore + weights.geo * geoScore;
      return { ...c, score };
    });

    // Sort by score desc, tiebreak by bayId asc
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.bayId.localeCompare(b.bayId);
    });

    const best = scored[0];
    results.push({
      itemId: item.itemId,
      poolListingId: best.poolListingId,
      bayId: best.bayId,
      marginalCostEur: best.marginalCostEur,
    });

    // Remove used bay
    available.get(best.poolListingId)!.delete(best.bayId);
    poolAllocCount.set(
      best.poolListingId,
      poolAllocCount.get(best.poolListingId)! + 1
    );
  }

  return results;
}

function computeMarginalCost(pool: PoolCandidate, currentAllocCount: number): number {
  // For PERCENTAGE mode: floor is 0 (no minimum bays), so every bay has cost
  // The marginal cost represents the incremental cost of filling one more bay
  if (pool.riskShareMode === 'PERCENTAGE') {
    // In PERCENTAGE mode the Block Spotter pays (1 - riskShareRate) * pricePerBayEur
    // for each filled bay, but riskShareRate * pricePerBayEur for each unfilled bay.
    // Filling a bay costs pricePerBayEur but saves riskShareRate * pricePerBayEur.
    // So marginal cost = pricePerBayEur * (1 - riskShareRate)
    return pool.pricePerBayEur * (1 - pool.riskShareRate);
  }

  // MIN_BAYS_FLOOR: below the floor, marginal cost is 0 (already paying for those bays)
  const floorCount = Math.ceil(pool.totalBayCount * pool.riskShareRate);
  if (currentAllocCount < floorCount) {
    return 0;
  }

  return pool.pricePerBayEur;
}
