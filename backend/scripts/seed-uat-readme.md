# UAT Seed Script — Operator Guide

Session 31. Populates the staging environment with the deterministic dataset every test
case in `Spotzy-UAT-Plan-v1.docx` references.

---

## Prerequisites

| Requirement | Details |
|---|---|
| Node.js 20.x | Same version as Lambda runtime |
| `ts-node` | Install globally: `npm i -g ts-node` or use `npx ts-node` |
| AWS credentials | Profile must resolve to account `034797416555` (staging only) |
| Environment variables | See table below |
| Stripe CLI / keys | Test-mode key required |

### Required environment variables

```bash
export AWS_PROFILE=spotzy-staging          # must resolve to account 034797416555
export AWS_REGION=eu-west-3
export TABLE_NAME=spotzy-main              # staging table (NOT spotzy-main-prod)
export USER_POOL_ID=eu-west-3_BkzpEu2CA   # staging Cognito pool
export STRIPE_SECRET_KEY=sk_test_...       # must start with sk_test_
```

> `TABLE_NAME` defaults to `spotzy-main` if not set. The guard rejects `spotzy-main-prod`.

---

## Running the seeder

```bash
cd backend

# Full seed (idempotent — safe to re-run)
npm run seed:uat

# Wipe all UAT data then exit (no re-seed)
npm run seed:uat:wipe

# Skip Stripe Connect onboarding (faster partial reseed)
npx ts-node scripts/seed-uat.ts --skip-stripe

# Quiet mode (suppress INFO logs)
npx ts-node scripts/seed-uat.ts --quiet

# Custom manifest output path
npx ts-node scripts/seed-uat.ts --manifest /tmp/uat-manifest.json
```

---

## Safety guards

The seeder refuses to run unless **all** of the following are true.
There is no `--force` flag. These guards cannot be bypassed.

| Guard | Check |
|---|---|
| AWS account | `aws sts get-caller-identity` must return `034797416555` |
| Stripe key | `STRIPE_SECRET_KEY` must start with `sk_test_` |
| DynamoDB table | `TABLE_NAME` must NOT be `spotzy-main-prod` |
| Cognito pool | `USER_POOL_ID` must be set and contain `BkzpEu2CA` |

Failure exits with code 1 and a human-readable explanation.

---

## What gets created

| Entity type | Count | Notes |
|---|---|---|
| Cognito users | 14 | One per account fixture |
| DynamoDB user profiles | 14 | With GSI1 email-lookup rows |
| Stripe Connect accounts | 5 | `host-fr-01`, `host-nl-01`, `sm-fr-01`, `sm-nl-01`, `sm-en-01` (onboarded); `host-fr-02` (created, not onboarded) |
| Listings | 12 single + 3 pools | See listing distribution in fixtures file |
| Pool bays | 22 total | 6 (sm-fr-01) + 12 (sm-nl-01) + 4 (sm-en-01) |
| Availability rules | 1 per listing | Weekdays 07:00-22:00 for 90 days |
| Bookings | 6 | Various statuses; priceBreakdown snapshots computed at seed time |
| Block requests | 2 | 1 PLANS_PROPOSED, 1 SETTLED |
| Block allocations | 3 | 2 under block-uat-001, 1 under block-uat-002 |
| Reviews | 1 | Left by spotter-fr-01 on booking-uat-006 |
| RC submissions | 4 | APPROVED (sm-fr-01, sm-nl-01, sm-en-01=EXPIRED), PENDING (sm-fr-02) |
| CONFIG records | 2 | PLATFORM_FEE and VAT_RATES (skipped if already present) |
| Placeholder photos | 3 S3 objects | Uploaded once to `spotzy-media-public/uat/photos/` |

---

## Wipe behaviour

`--wipe-only` cascades all UAT data by querying DynamoDB for every row with
`email *@uat.spotzy.test` and then deletes all related partitions:

- `USER#` (all SK items)
- `LISTING#` (all SK items — includes `METADATA`, `BAY#`, `AVAIL_RULE#`, `BOOKING#`, `BLOCKALLOC#`)
- `BOOKING#` (all SK items)
- `BLOCKREQ#` (all SK items — includes `BLOCKALLOC#`)
- `REVIEW#` (bookingId-keyed)
- `RC_REVIEW_QUEUE` pending items

Cognito users are deleted by listing users whose `email` ends with `@uat.spotzy.test`.

Stripe Connect accounts are deleted by listing accounts whose `email` ends with `@uat.spotzy.test`.
This is safe because only seeder-created accounts have UAT email addresses.

`CONFIG#` records are **never** touched by wipe.

Placeholder S3 photos are **not** deleted (harmless to leave; re-used on next seed run).

---

## Manifest file

After a successful seed, `scripts/uat-manifest.json` is written (or the path from `--manifest`).

It contains:
- All 14 account IDs, userIds, emails, Stripe Connect IDs
- All listing IDs with owner and status
- All booking IDs with spotter and status
- All block request IDs with owner and status
- The shared password for all accounts
- The table name, user pool ID, and region used

The manifest is the single source of truth for test executors. It is `.gitignore`-listed (generated artefact).

### Sample manifest location

`scripts/uat-manifest.example.json` — committed to source control as documentation reference.

---

## Password rotation

The shared password is defined in `scripts/seed-uat.fixtures.ts` as:

```typescript
export const UAT_PASSWORD = 'UAT-Test-2026!';
```

To rotate:
1. Update `UAT_PASSWORD` in `seed-uat.fixtures.ts`.
2. Run `npm run seed:uat:wipe` then `npm run seed:uat`.
3. Distribute the new password to the UAT team out-of-band.

---

## VAT numbers

All VAT numbers in the fixtures are pre-validated against the Belgian Mod-97 checksum.
Do not regenerate them. If validation fails, that is a bug in the validator.

| Account | VAT Number |
|---|---|
| sm-fr-01 | BE0123456749 |
| sm-nl-01 | BE0987654312 |
| sm-en-01 | BE0234567819 |
| bs-corp-01 | BE0345678916 |
| bs-event-01 | BE0456789013 |

---

## Idempotency

Every entity creation is guarded by a `getItem` check before `putItem`.
Re-running the seeder on an already-seeded environment is safe and produces an
identical manifest (modulo the `generatedAt` timestamp).

Stable entity IDs mean test case references never break between re-seeds.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `FATAL: AWS account mismatch` | Wrong `AWS_PROFILE` | `export AWS_PROFILE=spotzy-staging` |
| `FATAL: STRIPE_SECRET_KEY does not start with sk_test_` | Live key set | Use a test-mode key |
| `FATAL: USER_POOL_ID is not set` | Missing env var | Export `USER_POOL_ID` |
| `FATAL: TABLE_NAME is spotzy-main-prod` | Production table | Change `TABLE_NAME` |
| Stripe rate limit errors | Too many concurrent accounts | Script is sequential; retry after a few seconds |
| DynamoDB `ResourceNotFoundException` | Table or GSI not deployed | Run CDK deploy first |
| Photo upload fails | S3 bucket not accessible | Check IAM permissions for `spotzy-media-public` |
| Script times out (>90s) | Network latency or Cognito throttling | Re-run; seeder is idempotent |
