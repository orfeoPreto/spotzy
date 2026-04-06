# Session 06 — Users & Preferences (TDD)

## What this session does
Tests first, then implementation for user profile and preference learning.

## Feed to Claude Code
This file only.

---

## Function 1 — user-get

### Tests first: `__tests__/users/get.test.ts`

**Happy path:**
- User record exists → returns profile without sensitive fields
- `stripeConnectAccountId` NOT present in response (stripped)
- `role`, `stripeConnectEnabled` (boolean) ARE present

**Auto-create:**
- User record not found in DynamoDB → creates minimal profile from Cognito claims → returns 200 (not 404)
- Created profile has `role=SPOTTER` by default

**Auth:**
- Missing auth → 401

### Implementation: `functions/users/get/index.ts`

---

## Function 2 — user-update

### Tests first: `__tests__/users/update.test.ts`

**Happy path:**
- Update `name` → stored, 200 returned
- Update `vehicles` array with valid vehicle → stored
- Phone number change → `phoneVerified=false`, new phone stored as `pendingPhone`, SNS OTP sent

**Validation:**
- Vehicle `plate` empty string → 400
- Vehicle `plate` over 15 chars → 400
- More than 5 vehicles in array → 400 `MAX_VEHICLES_EXCEEDED`
- Attempt to update `userId` or `email` directly → those fields ignored

**Phone OTP:**
- Phone changed → `SNSClient.send` called once with the new phone number
- Phone unchanged → no SNS call

### Implementation: `functions/users/update/index.ts`

---

## Function 3 — preference-learn

### Tests first: `__tests__/users/preference-learn.test.ts`

**booking.completed event:**
- First booking for user → creates PREFS record with initial counts
- Second booking → increments existing counts correctly
- `destinationHistory`: same geohash appears twice → count incremented to 2 (not two separate entries)
- `spotTypeHistory`: `COVERED_GARAGE` booked → count for that type incremented
- `coveredCount` incremented when spot was covered
- `totalBookings` incremented by 1

**search.performed event:**
- `searchHistory` entry added for destination geohash
- Same geohash searched 3 times → count = 3 (deduplicated)
- `filterHistory` tracks which filters were used

**`generateSuggestions` helper — test separately:**
```typescript
// Test cases for generateSuggestions(prefs)
// 5 bookings: 4 covered, 1 uncovered → prefersCovered = true (4/5 = 0.8 > 0.6)
// 2 bookings: 1 covered, 1 uncovered → prefersCovered = false (1/2 = 0.5 < 0.6)
// Prices [3, 5, 7, 4] → avg = 4.75, suggestedMaxPrice = 4.75 * 1.2 = 5.70
// Top 3 destinations by count → returns top 3 geohashes sorted by count desc
```

### Implementation: `functions/preferences/learn/index.ts`

---

## Cognito post-confirmation trigger

### Tests first: `__tests__/users/post-confirmation.test.ts`

**Happy path:**
- Valid Cognito post-confirmation event → DynamoDB PutItem called with correct PK/SK
- `role=SPOTTER` set by default
- `stripeConnectEnabled=false` set
- Returns the original Cognito event unchanged (required by Cognito)
- GSI1PK=`EMAIL#{email}` set correctly

**Idempotency:**
- User record already exists → DynamoDB conditional write prevents overwrite (attribute_not_exists condition)
- Returns Cognito event without error (do not throw on condition failure)

### Implementation: `functions/users/post-confirmation/index.ts`
