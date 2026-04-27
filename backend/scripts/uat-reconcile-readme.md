# UAT Pricing Reconciliation Script

7-surface comparator that verifies every `priceBreakdown` agrees to the cent
across DynamoDB snapshot, canonical recompute, listing card, Stripe PaymentIntent,
Stripe application fee, Stripe Connect transfer, and receipt PDF.

**Exit code contract**: `0` = all surfaces in agreement, `1` = any mismatch.

This script is the enforcement mechanism for UAT exit criterion §5.2 (LD-018).
It also becomes the production nightly canary post-launch (Session 32b Lambda wrapper).

---

## Prerequisites

1. AWS credentials for the staging account (`034797416555`)
2. A Stripe test-mode secret key (`sk_test_...`)
3. The staging DynamoDB table already seeded (`npm run seed:uat`)
4. Node.js 20.x + `ts-node` installed

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Yes | — | Must start with `sk_test_`. Script refuses to run otherwise. |
| `TABLE_NAME` | No | `spotzy-main` | Staging DynamoDB table name |
| `AWS_REGION` | No | `eu-west-3` | AWS region |
| `AWS_PROFILE` | No | default | AWS credentials profile |

---

## Usage

```bash
# Run against default sample of 20 bookings
npm run uat:reconcile

# Check only specific bookings
npm run uat:reconcile -- --booking-ids booking-uat-003,booking-uat-005

# Check specific block alloc (reqId/allocId format)
npm run uat:reconcile -- --booking-ids blockreq-uat-001/alloc-uat-001

# Increase sample size
npm run uat:reconcile -- --count 50

# Filter by status
npm run uat:reconcile -- --filter status=SETTLED

# Filter by VAT status
npm run uat:reconcile -- --filter vatStatus=VAT_REGISTERED

# Combine filters (comma-separated key=value pairs)
npm run uat:reconcile -- --filter status=COMPLETED,vatStatus=EXEMPT_FRANCHISE

# Stop on first mismatch
npm run uat:reconcile -- --bail-fast

# Suppress per-row output (only summary)
npm run uat:reconcile -- --quiet

# Custom report output path
npm run uat:reconcile -- --report ./reports/my-report.json

# Combine options
npm run uat:reconcile -- --count 30 --bail-fast --report ./reports/sprint-42.json
```

---

## Surfaces compared

| # | Surface | Source | Check |
|---|---|---|---|
| 1 | Snapshot | `BOOKING#{id}.priceBreakdown` in DynamoDB | Reference — all others compared to this |
| 2 | Recompute | `computeFullPriceBreakdown()` with booking's stored inputs | Proves function determinism and input capture |
| 3 | Listing card | Pricing function called with listing's current pricing + booking duration | Checks `spotterGrossTotalEur` per LD-013 |
| 4 | Stripe PaymentIntent | `stripe.paymentIntents.retrieve(piId).amount` | Must equal `spotterGrossTotalEur × 100` cents |
| 5 | Stripe app fee | `charge.application_fee_amount` on the captured charge | Must equal `(platformFeeEur + platformFeeVatEur) × 100` cents |
| 6 | Stripe transfer | `stripe.transfers.list({ transfer_group: 'BOOKING_{id}' })` | Sum must equal `hostGrossTotalEur × 100` cents |
| 7 | Receipt PDF | `receipts/render.ts` handler | SKIPPED until Session 14 receipt handler is implemented |

For BLOCKALLOC records:
- Surface 3 is replaced by the block plan summary (`BLOCKREQ.proposedPlans[i].priceBreakdown`)
- Surface 7 is replaced by the block invoice PDF (SKIPPED until implemented)

---

## Tolerance

**Zero cents.** Any cent-level difference is a `FAIL`. This is not configurable.
All comparisons are performed in integer cents to avoid float drift.

---

## Sampling strategy

When `--booking-ids` is not given, the script scans DynamoDB for completed/settled
bookings that have a `priceBreakdown` field, then distributes the sample across
the three VAT status values:

- Roughly equal thirds: `VAT_REGISTERED`, `EXEMPT_FRANCHISE`, `NONE`
- Any remainder goes to the largest available bucket
- Falls back to proportional if the dataset is imbalanced

The distribution is logged at the start of each run.

---

## JSON report

Every run writes a JSON report to `./reports/uat-reconcile-{timestamp}.json`
(or the path set by `--report`). This report is the audit artifact for UAT
sign-off and for production canary alerting.

Report shape:

```json
{
  "metadata": {
    "generatedAt": "ISO-8601",
    "environment": "staging",
    "stripeMode": "test",
    "tableName": "spotzy-main",
    "region": "eu-west-3",
    "samplingStrategy": "balanced-vat-status",
    "count": 20,
    "distribution": {
      "VAT_REGISTERED": 7,
      "EXEMPT_FRANCHISE": 7,
      "NONE": 6
    }
  },
  "summary": {
    "checked": 20,
    "passed": 18,
    "failed": 2,
    "skipped": 0
  },
  "rows": [ ... ]
}
```

---

## Interpreting failures

| Surface | Common causes |
|---|---|
| `recompute` | Pricing function changed after booking was created. Fix: re-examine `computeFullPriceBreakdown` for rounding changes. |
| `listingCard` | Listing pricing was edited after booking. The listing's current `hostNetPricePerHourEur` now differs from the booking's implicit rate. |
| `stripeCharge` | Booking snapshot was modified after charge, or fee config changed without snapshotting. |
| `stripeAppFee` | Platform fee rate changed between booking creation and charge. Or fee VAT not included in application fee transfer. |
| `stripeTransfer` | Host payout was for wrong amount. Check whether multiple transfers were created or whether a transfer was retried. |
| `receiptPdf` | Receipt template reading current `vatStatus` instead of snapshotted `hostVatStatusAtCreation`. |

---

## Safety guards (non-negotiable — no --force flag exists)

1. `STRIPE_SECRET_KEY` must start with `sk_test_`
2. AWS account must be `034797416555` (staging)

The script calls `aws sts get-caller-identity` and inspects the Stripe key before
any DynamoDB reads or Stripe API calls.

---

## Stripe surfaces and seed data

Bookings created by `npm run seed:uat` use placeholder `stripePaymentIntentId`
values (format: `pi_uat_*`). These **do not exist in Stripe**. Surfaces 4, 5, and 6
will be `SKIPPED` for such bookings with an explanatory message.

To test full 7-surface reconciliation, run the actual booking flow end-to-end in
staging to generate real `PaymentIntent`, `Charge`, and `Transfer` objects in Stripe
test mode, then run the reconciler.

---

## Production canary (Session 32b)

Once promoted to production, a Lambda wrapper (`backend/functions/canary/reconcile.ts`)
will package this script. The wrapper calls the exported `runReconciliation()` function
(not the CLI shim) and emits:

- CloudWatch metric `Spotzy/Reconciliation/Mismatch` on any failure
- SNS notification to `spotzy-prod-alarms`

The Lambda wrapper is out of scope for this session.
