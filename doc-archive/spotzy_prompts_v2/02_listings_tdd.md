# Session 02 — Listings Domain (TDD: tests first, then implementation)

## What this session does
Writes Jest unit tests for all listing business rules first, then implements the Lambda functions that make those tests pass.

## Feed to Claude Code
This file only.

## Instructions for Claude Code

**Follow this pattern for every function:**
1. Write the Jest unit test file first (`__tests__/listings/{function}.test.ts`)
2. Run the tests — they must fail (red)
3. Write the implementation (`functions/listings/{function}/index.ts`)
4. Run the tests — they must pass (green)
5. Refactor if needed, keeping tests green

Use `jest.mock()` for all AWS SDK calls. Never call real AWS services in unit tests.

---

## Test setup (create once, reuse across all listing tests)

**`backend/__tests__/setup.ts`**
```typescript
// Mock all AWS SDK modules
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-rekognition');
jest.mock('@aws-sdk/client-eventbridge');
jest.mock('@aws-sdk/s3-request-presigner');

// Test constants
export const TEST_USER_ID = 'user_01HX1234';
export const TEST_LISTING_ID = 'listing_01HX5678';
export const TEST_HOST_ID = 'user_01HX1234';

// JWT claims mock
export const mockAuthContext = (userId = TEST_USER_ID) => ({
  requestContext: {
    authorizer: { claims: { sub: userId, email: 'test@spotzy.com' } }
  }
});
```

**`backend/jest.config.ts`**
```typescript
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterFramework: ['<rootDir>/__tests__/setup.ts'],
  collectCoverageFrom: ['functions/**/*.ts', 'shared/**/*.ts'],
  coverageThreshold: { global: { branches: 80, functions: 90, lines: 90 } },
};
```

---

## Function 1 — listing-create

### Tests first: `__tests__/listings/create.test.ts`

Write tests covering ALL of the following cases:

**Happy path:**
- Creates listing with all required fields → returns 201 with listingId, status=DRAFT
- Computes geohash from lat/lng (precision 5) and stores it
- Sets hostId from JWT sub claim
- At least one price field is sufficient (pricePerHour only → valid)

**Validation failures (each must return 400):**
- Missing `address` → 400 with field name in error
- Missing `addressLat` or `addressLng` → 400
- Missing `spotType` → 400
- Invalid `spotType` value (not in enum) → 400
- No price provided (all price fields absent) → 400 with message "At least one price is required"
- Description exceeds 500 characters → 400

**Auth:**
- Missing auth context → 401

**DynamoDB:**
- DynamoDB `PutItem` is called exactly once with correct PK/SK pattern
- GSI1PK is set to `HOST#{userId}`

### Implementation: `functions/listings/create/index.ts`

Implement to make all the above tests pass. Requirements:
- Authenticated. Extract `userId` from Cognito JWT claims (`sub`).
- Generate `listingId` as `ulid()`.
- Required fields: `address`, `addressLat`, `addressLng`, `spotType` (enum: COVERED_GARAGE | CARPORT | DRIVEWAY | OPEN_SPACE), `dimensions` (STANDARD | LARGE), `evCharging` (boolean).
- Optional: `description` (max 500 chars), `pricePerHour`, `pricePerDay`, `pricePerMonth` (at least one required), `minDurationHours`, `maxDurationHours`, `reclaimNoticeHours`.
- Compute `geohash` from lat/lng using `ngeohash` precision 5.
- Initial status: DRAFT.
- DynamoDB write: PK=`LISTING#{listingId}`, SK=`METADATA`, GSI1PK=`HOST#{userId}`, GSI1SK=`LISTING#{listingId}`.
- Return 201 with created listing.

---

## Function 2 — listing-update

### Tests first: `__tests__/listings/update.test.ts`

**Happy path:**
- Updates allowed fields → returns 200 with updated values
- Address change → geohash is recomputed
- Status LIVE listing → update applies immediately without unpublishing

**Auth / ownership:**
- Requesting user is not the host → 403
- Missing auth → 401

**Edge cases:**
- Updating `listingId` or `hostId` in body → those fields are ignored (not updated)
- Empty body → 200 with unchanged listing (no-op is valid)

### Implementation: `functions/listings/update/index.ts`

- Authenticated. Fetch listing. Verify `hostId` matches JWT `sub` → 403 if not.
- Allow updating any field except `listingId` and `hostId` (strip those from input).
- Recompute geohash if address changes.
- Return 200 with full updated listing.

---

## Function 3 — listing-publish

### Tests first: `__tests__/listings/publish.test.ts`

**Happy path:**
- All checks pass → status set to LIVE, publishedAt set, EventBridge event emitted, 200 returned
- EventBridge called with event detail-type `listing.published` and correct payload

**Completeness check failures (each → 400 with failedChecks array):**
- No description → `failedChecks` includes `"description"`
- Fewer than 2 photos → `failedChecks` includes `"photos"`
- Photos present but none with `validationStatus=PASS` → `failedChecks` includes `"photoValidation"`
- No availability windows → `failedChecks` includes `"availability"`
- No price set → `failedChecks` includes `"price"`
- Multiple missing fields → all appear in `failedChecks` in one response

**Photo under review:**
- Any photo with `validationStatus=REVIEW` → 400 with message `"Photos are under manual review"`

**Auth / ownership:**
- Not the host → 403

### Implementation: `functions/listings/publish/index.ts`

- Authenticated. Verify ownership → 403.
- Run all completeness checks. Collect all failures into `failedChecks[]`. If non-empty → 400.
- Check for REVIEW photos → 400.
- Set `status=LIVE`, `publishedAt`.
- Emit EventBridge `listing.published`.
- Return 200.

---

## Function 4 — listing-search

### Tests first: `__tests__/listings/search.test.ts`

**Happy path:**
- Returns only LIVE listings
- Queries geohash cell AND 8 adjacent cells (verify GSI2 is queried 9 times or with 9 keys)
- Results sorted by Haversine distance from query lat/lng ascending
- Returns max 50 results even if more exist

**Filtering:**
- `maxPricePerHour=5` → excludes listings with pricePerHour > 5
- `spotType=COVERED_GARAGE` → excludes other types
- `covered=true` → excludes uncovered spots
- `privateOnly=true` → excludes non-P2P listings
- Multiple filters combined → all applied

**Edge cases:**
- No results in any geohash cell → returns `{ listings: [], total: 0 }`
- Missing `lat` or `lng` → 400
- DRAFT listings in database → not returned

### Implementation: `functions/listings/search/index.ts`

- Public (no auth required).
- Query params: `lat`, `lng` (required), optional filters.
- Compute geohash from lat/lng at precision 5. Query GSI2 for geohash + 8 neighbors.
- Filter results in-memory. Sort by Haversine distance. Return max 50.
- Return `{ listings, total }`.

---

## Function 5 — listing-get

### Tests first: `__tests__/listings/get.test.ts`

**Happy path:**
- LIVE listing → returns full listing object with 200
- Owner requesting DRAFT listing → returns 200 (auth check)

**Not found / access:**
- Non-existent listing → 404
- DRAFT listing, requester is NOT the host → 404 (treats draft as not found for public)

### Implementation: `functions/listings/get/index.ts`

- Public (no auth required, but check optional auth header).
- Fetch by PK=`LISTING#{id}`, SK=`METADATA`.
- If not found → 404.
- If DRAFT and requester is not the host → 404.
- Return full listing.

---

## Function 6 — listing-ai-validate

### Tests first: `__tests__/listings/ai-validate.test.ts`

**Rekognition label detection:**
- Labels include `Garage` with confidence 90% → validationStatus=PASS, file copied to public bucket
- Labels include `Parking` with confidence 85% → PASS
- No parking-related labels found → FAIL, rejection reason set, file NOT copied
- Parking label confidence 60% (between 50-80%) → REVIEW, flagged for manual review

**Moderation:**
- `detectModerationLabels` returns `SuggestiveFemale` with confidence 75% → FAIL regardless of label detection result

**Cleanliness:**
- Label `Trash` with confidence 65% → FAIL
- Label `Clutter` with confidence 70% → FAIL

**S3 copy:**
- On PASS: `CopyObject` called from uploads bucket to public bucket with correct key
- On FAIL: `CopyObject` NOT called
- On REVIEW: `CopyObject` NOT called

**DynamoDB update:**
- Listing record updated with `photos[photoIndex].validationStatus` and `validationReason`

### Implementation: `functions/listings/ai-validate/index.ts`

- Triggered by S3 event (photo upload).
- Extract `listingId`, `photoIndex` from S3 key: `listings/{listingId}/photos/{photoIndex}.jpg`.
- Call Rekognition detectLabels — check for parking-related labels at 80% confidence.
- Call Rekognition detectModerationLabels — fail on any label >= 70%.
- Cleanliness heuristic: fail on Trash/Garbage/Clutter >= 60%.
- Write result back to DynamoDB listing record.
- On PASS: copy to `spotzy-media-public`.

---

## Photo URL endpoint

### Tests first: `__tests__/listings/photo-url.test.ts`

**Happy path:**
- Owner requests upload URL → returns `{ uploadUrl, key }` with 200
- Pre-signed URL expires in 300 seconds
- Key follows pattern `listings/{listingId}/photos/{photoIndex}.jpg`

**Auth:**
- Not the listing owner → 403
- Missing auth → 401

**Validation:**
- `photoIndex` not 0 or 1 → 400 (only 2 photos allowed in MVP)
- Invalid `contentType` → 400

### Implementation: `functions/listings/photo-url/index.ts`

- Authenticated. Verify ownership.
- Generate S3 pre-signed PUT URL. Expiry 300s.
- Return `{ uploadUrl, key }`.
