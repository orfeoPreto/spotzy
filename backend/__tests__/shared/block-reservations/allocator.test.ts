import { bulkAllocate, deriveWeights } from '../../../shared/block-reservations/allocator';
import type { PoolCandidate, AllocationItem } from '../../../shared/block-reservations/allocator';
import type { BlockRequestPreferences } from '../../../shared/block-reservations/types';

const defaultPrefs: BlockRequestPreferences = {
  minPoolRating: null,
  requireVerifiedSpotManager: null,
  noIndividualSpots: true,
  maxCounterparties: null,
  maxWalkingTimeFromPoint: null,
  clusterTogether: null,
};

function makePool(overrides: Partial<PoolCandidate>): PoolCandidate {
  return {
    poolListingId: 'pool-1',
    spotManagerUserId: 'sm-1',
    totalBayCount: 10,
    availableBayIds: ['bay-01', 'bay-02', 'bay-03', 'bay-04', 'bay-05'],
    pricePerBayEur: 25,
    riskShareMode: 'PERCENTAGE',
    riskShareRate: 0.30,
    poolRating: 4.5,
    spotManagerVerified: true,
    walkingDistanceMeters: null,
    latitude: 50.85,
    longitude: 4.35,
    ...overrides,
  };
}

describe('deriveWeights', () => {
  test('default preferences favour cost (0.8) over geo (0.2)', () => {
    expect(deriveWeights(defaultPrefs)).toEqual({ cost: 0.8, geo: 0.2 });
  });

  test('maxWalkingTimeFromPoint set -> geo dominates (0.4 cost / 0.6 geo)', () => {
    const prefs = { ...defaultPrefs, maxWalkingTimeFromPoint: { minutes: 10, lat: 50.85, lng: 4.35 } };
    expect(deriveWeights(prefs)).toEqual({ cost: 0.4, geo: 0.6 });
  });

  test('clusterTogether set -> balanced (0.5 / 0.5)', () => {
    const prefs = { ...defaultPrefs, clusterTogether: true };
    expect(deriveWeights(prefs)).toEqual({ cost: 0.5, geo: 0.5 });
  });
});

describe('bulkAllocate — single pool', () => {
  test('assigns each item to a unique bay (no double-booking)', () => {
    const items: AllocationItem[] = [
      { itemId: 'guest-a' },
      { itemId: 'guest-b' },
      { itemId: 'guest-c' },
    ];
    const pools = [makePool({})];
    const result = bulkAllocate(items, pools, defaultPrefs);

    expect(result).toHaveLength(3);
    const bayIds = result.map((r) => r.bayId);
    expect(new Set(bayIds).size).toBe(3);
    expect(result.every((r) => r.poolListingId === 'pool-1')).toBe(true);
  });

  test('deterministic — same inputs produce same outputs', () => {
    const items: AllocationItem[] = [{ itemId: 'g1' }, { itemId: 'g2' }];
    const pools = [makePool({})];
    const r1 = bulkAllocate(items, pools, defaultPrefs);
    const r2 = bulkAllocate(items, pools, defaultPrefs);
    expect(r1).toEqual(r2);
  });

  test('tiebreak picks lexicographically lowest bayId', () => {
    const items: AllocationItem[] = [{ itemId: 'g1' }];
    const pools = [makePool({ availableBayIds: ['bay-99', 'bay-01', 'bay-50'] })];
    const result = bulkAllocate(items, pools, defaultPrefs);
    expect(result[0].bayId).toBe('bay-01');
  });
});

describe('bulkAllocate — multi-pool with cost', () => {
  test('with PERCENTAGE pools, cheaper pool wins when both have capacity', () => {
    const cheap = makePool({ poolListingId: 'pool-cheap', pricePerBayEur: 10, availableBayIds: ['bay-c1'] });
    const expensive = makePool({ poolListingId: 'pool-expensive', pricePerBayEur: 30, availableBayIds: ['bay-e1'] });
    const result = bulkAllocate([{ itemId: 'g1' }], [cheap, expensive], defaultPrefs);
    expect(result[0].poolListingId).toBe('pool-cheap');
  });
});

describe('bulkAllocate — geo bias', () => {
  test('with maxWalkingTimeFromPoint set, closer pool wins even if more expensive', () => {
    const close = makePool({
      poolListingId: 'pool-close',
      pricePerBayEur: 30,
      availableBayIds: ['bay-cl'],
      latitude: 50.85,
      longitude: 4.35,
    });
    const far = makePool({
      poolListingId: 'pool-far',
      pricePerBayEur: 10,
      availableBayIds: ['bay-fr'],
      latitude: 50.90,
      longitude: 4.35,
    });
    const prefs: BlockRequestPreferences = {
      ...defaultPrefs,
      maxWalkingTimeFromPoint: { minutes: 10, lat: 50.85, lng: 4.35 },
    };
    const result = bulkAllocate([{ itemId: 'g1' }], [close, far], prefs);
    expect(result[0].poolListingId).toBe('pool-close');
  });
});

describe('bulkAllocate — capacity exhaustion', () => {
  test('returns fewer results than items if total available bays is insufficient', () => {
    const items: AllocationItem[] = [{ itemId: 'g1' }, { itemId: 'g2' }, { itemId: 'g3' }];
    const pools = [makePool({ availableBayIds: ['bay-01'] })];
    const result = bulkAllocate(items, pools, defaultPrefs);
    expect(result).toHaveLength(1);
    expect(result[0].itemId).toBe('g1');
  });

  test('allocates across multiple pools when no single pool has capacity', () => {
    const items: AllocationItem[] = [{ itemId: 'g1' }, { itemId: 'g2' }, { itemId: 'g3' }];
    const pools = [
      makePool({ poolListingId: 'pool-a', availableBayIds: ['a1', 'a2'] }),
      makePool({ poolListingId: 'pool-b', availableBayIds: ['b1', 'b2'] }),
    ];
    const result = bulkAllocate(items, pools, defaultPrefs);
    expect(result).toHaveLength(3);
    const poolIds = result.map((r) => r.poolListingId);
    expect(poolIds).toContain('pool-a');
    expect(poolIds).toContain('pool-b');
  });
});
