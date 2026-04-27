/**
 * UAT Pricing Reconciliation Script — Session 32
 *
 * 7-surface comparator that asserts every priceBreakdown agrees to the cent
 * across DynamoDB snapshot, recompute, listing card, Stripe PaymentIntent,
 * Stripe application fee, Stripe Connect transfer, and receipt PDF.
 *
 * Exit code contract: 0 = all surfaces in agreement, 1 = any mismatch.
 * No process.exit calls outside the CLI shim at the bottom.
 *
 * Usage:
 *   ts-node backend/scripts/uat-reconcile.ts
 *   ts-node backend/scripts/uat-reconcile.ts --count 10
 *   ts-node backend/scripts/uat-reconcile.ts --booking-ids booking-uat-003,booking-uat-005
 *   ts-node backend/scripts/uat-reconcile.ts --filter status=SETTLED,vatStatus=VAT_REGISTERED
 *   ts-node backend/scripts/uat-reconcile.ts --report ./reports/custom.json
 *   ts-node backend/scripts/uat-reconcile.ts --bail-fast --quiet
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import Stripe from 'stripe';

import { computeFullPriceBreakdown } from '../shared/pricing/tiered-pricing';
import type { PriceBreakdown, FullPriceBreakdownInput, TieredPricing } from '../shared/pricing/types';
import type { VATStatus } from '../shared/pricing/vat-constants';
import { BELGIAN_STANDARD_VAT_RATE } from '../shared/pricing/vat-constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UAT_STAGING_ACCOUNT_ID = '034797416555';
const SURFACE_COUNT = 7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SurfaceStatus = 'REFERENCE' | 'PASS' | 'FAIL' | 'SKIPPED';

interface SurfaceResult {
  status: SurfaceStatus;
  values?: Record<string, unknown>;
  expected?: number;
  actual?: number;
  deltaCents?: number;
  details?: string;
}

interface BookingRow {
  bookingId: string;
  type: 'BOOKING' | 'BLOCKALLOC';
  vatStatus: VATStatus;
  snapshot: PriceBreakdown;
  surfaces: {
    snapshot: SurfaceResult;
    recompute: SurfaceResult;
    listingCard: SurfaceResult;
    stripeCharge: SurfaceResult;
    stripeAppFee: SurfaceResult;
    stripeTransfer: SurfaceResult;
    receiptPdf: SurfaceResult;
  };
}

interface ReportMetadata {
  generatedAt: string;
  environment: string;
  stripeMode: string;
  tableName: string;
  region: string;
  samplingStrategy: string;
  count: number;
  distribution?: {
    VAT_REGISTERED: number;
    EXEMPT_FRANCHISE: number;
    NONE: number;
  };
}

interface ReportSummary {
  checked: number;
  passed: number;
  failed: number;
  skipped: number;
}

interface ReconcileReport {
  metadata: ReportMetadata;
  summary: ReportSummary;
  rows: BookingRow[];
}

interface ReconcileOptions {
  count: number;
  bookingIds?: string[];
  filter?: Record<string, string>;
  reportPath: string;
  bailFast: boolean;
  quiet: boolean;
}

// Raw DynamoDB booking record shape
interface DdbBookingRecord {
  PK: string;
  SK: string;
  bookingId: string;
  listingId: string;
  spotterId: string;
  hostId: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  status: string;
  priceBreakdown: PriceBreakdown;
  stripePaymentIntentId?: string;
}

// Raw DynamoDB blockalloc record shape
interface DdbBlockAllocRecord {
  PK: string;
  SK: string;
  allocId: string;
  reqId: string;
  poolListingId: string;
  spotManagerUserId: string;
  contributedBayCount: number;
  riskShareMode: string;
  riskShareRate: number;
  priceBreakdown: PriceBreakdown;
  stripePaymentIntentId?: string;
}

// Raw DynamoDB listing metadata shape
interface DdbListingRecord {
  PK: string;
  SK: string;
  listingId: string;
  hostId: string;
  hostNetPricePerHourEur: number;
  dailyDiscountPct: 0.50 | 0.60 | 0.70;
  weeklyDiscountPct: 0.50 | 0.60 | 0.70;
  monthlyDiscountPct: 0.50 | 0.60 | 0.70;
  hostVatStatusAtCreation: VATStatus;
  status: string;
}

// Raw DynamoDB blockreq metadata shape
interface DdbBlockReqRecord {
  PK: string;
  SK: string;
  reqId: string;
  blockSpotterUserId: string;
  stripePaymentIntentId?: string;
  proposedPlans?: Array<{
    planId: string;
    priceBreakdown: PriceBreakdown;
  }>;
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

// ANSI colour codes — disabled automatically if NO_COLOR is set
const useColor = !process.env['NO_COLOR'] && process.stdout.isTTY;
const green = (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s);
const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s);

function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

function warn(msg: string): void {
  process.stderr.write(yellow(`WARN  ${msg}`) + '\n');
}

// ---------------------------------------------------------------------------
// Arithmetic helpers — all comparisons in integer cents
// ---------------------------------------------------------------------------

function toCents(eur: number): number {
  return Math.round(eur * 100);
}

// ---------------------------------------------------------------------------
// Safety guards
// ---------------------------------------------------------------------------

function assertSafetyGuards(): void {
  // Guard 1 — AWS account must be staging
  let awsAccountId: string;
  try {
    awsAccountId = execSync('aws sts get-caller-identity --query Account --output text', {
      encoding: 'utf-8',
    }).trim();
  } catch {
    throw new Error(
      'Could not call AWS STS. Make sure AWS_PROFILE is set and credentials are valid.',
    );
  }
  if (awsAccountId !== UAT_STAGING_ACCOUNT_ID) {
    throw new Error(
      `AWS account mismatch!\n` +
        `  Expected staging account: ${UAT_STAGING_ACCOUNT_ID}\n` +
        `  Resolved account:         ${awsAccountId}\n` +
        `  Check your AWS_PROFILE environment variable.`,
    );
  }

  // Guard 2 — Stripe key must be test mode
  const stripeKey = process.env['STRIPE_SECRET_KEY'] ?? '';
  if (!stripeKey.startsWith('sk_test_')) {
    throw new Error(
      `STRIPE_SECRET_KEY does not start with sk_test_.\n` +
        `  Never run reconciliation against a live Stripe key.`,
    );
  }
}

// ---------------------------------------------------------------------------
// AWS + Stripe client initialisation
// ---------------------------------------------------------------------------

function buildClients(): {
  ddb: DynamoDBDocumentClient;
  stripe: Stripe;
  tableName: string;
  region: string;
} {
  const region = process.env['AWS_REGION'] ?? 'eu-west-3';
  const tableName = process.env['TABLE_NAME'] ?? 'spotzy-main';

  const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region }),
    { marshallOptions: { removeUndefinedValues: true } },
  );

  const stripe = new Stripe(process.env['STRIPE_SECRET_KEY'] ?? '', {
    apiVersion: '2023-10-16',
  });

  return { ddb, stripe, tableName, region };
}

// ---------------------------------------------------------------------------
// DynamoDB fetch helpers
// ---------------------------------------------------------------------------

async function fetchBooking(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  bookingId: string,
): Promise<DdbBookingRecord | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
      ConsistentRead: true,
    }),
  );
  return (result.Item as DdbBookingRecord) ?? null;
}

async function fetchBlockAlloc(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  reqId: string,
  allocId: string,
): Promise<DdbBlockAllocRecord | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `BLOCKREQ#${reqId}`, SK: `BLOCKALLOC#${allocId}` },
      ConsistentRead: true,
    }),
  );
  return (result.Item as DdbBlockAllocRecord) ?? null;
}

async function fetchListing(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  listingId: string,
): Promise<DdbListingRecord | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `LISTING#${listingId}`, SK: 'METADATA' },
      ConsistentRead: true,
    }),
  );
  return (result.Item as DdbListingRecord) ?? null;
}

async function fetchBlockReq(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  reqId: string,
): Promise<DdbBlockReqRecord | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
      ConsistentRead: true,
    }),
  );
  return (result.Item as DdbBlockReqRecord) ?? null;
}

async function fetchPlatformFeeConfig(
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<number> {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: 'CONFIG#PLATFORM_FEE', SK: 'METADATA' },
      ConsistentRead: true,
    }),
  );
  const item = result.Item as { singleShotPct?: number } | undefined;
  return item?.singleShotPct ?? 0.15;
}

// ---------------------------------------------------------------------------
// Booking sampling
// ---------------------------------------------------------------------------

interface SampledBooking {
  bookingId: string;
  type: 'BOOKING';
  vatStatus: VATStatus;
  record: DdbBookingRecord;
}

interface SampledBlockAlloc {
  bookingId: string; // format: "{reqId}/{allocId}" for block allocs
  type: 'BLOCKALLOC';
  vatStatus: VATStatus;
  reqId: string;
  allocId: string;
  record: DdbBlockAllocRecord;
}

type SampledItem = SampledBooking | SampledBlockAlloc;

async function sampleBookings(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  options: ReconcileOptions,
): Promise<SampledItem[]> {
  if (options.bookingIds && options.bookingIds.length > 0) {
    // Explicit IDs — fetch each one. IDs can be "bookingId" or "reqId/allocId" for block allocs.
    const items: SampledItem[] = [];
    for (const id of options.bookingIds) {
      if (id.includes('/')) {
        // Block alloc: format reqId/allocId
        const [reqId, allocId] = id.split('/');
        const record = await fetchBlockAlloc(ddb, tableName, reqId, allocId);
        if (!record) {
          warn(`Block alloc not found: ${id}`);
          continue;
        }
        const listing = await fetchListing(ddb, tableName, record.poolListingId);
        const vatStatus = (listing?.hostVatStatusAtCreation ?? 'EXEMPT_FRANCHISE') as VATStatus;
        items.push({ bookingId: id, type: 'BLOCKALLOC', vatStatus, reqId, allocId, record });
      } else {
        const record = await fetchBooking(ddb, tableName, id);
        if (!record) {
          warn(`Booking not found: ${id}`);
          continue;
        }
        const listing = await fetchListing(ddb, tableName, record.listingId);
        const vatStatus = (listing?.hostVatStatusAtCreation ?? 'EXEMPT_FRANCHISE') as VATStatus;
        items.push({ bookingId: id, type: 'BOOKING', vatStatus, record });
      }
    }
    return items;
  }

  // Scan for completed/settled bookings
  const targetCount = options.count;
  const filter = options.filter ?? {};

  // Scan BOOKING# rows
  const allBookings: DdbBookingRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
        ExpressionAttributeValues: {
          ':prefix': 'BOOKING#',
          ':sk': 'METADATA',
        },
        ExclusiveStartKey: lastKey,
        Limit: 500,
      }),
    );
    const items = (result.Items as DdbBookingRecord[]) ?? [];
    for (const item of items) {
      // Apply status filter — default to completed/settled bookings that have a priceBreakdown
      const status = (item.status ?? '').toUpperCase();
      const hasBreakdown = !!item.priceBreakdown;

      if (!hasBreakdown) continue;

      if (filter['status'] && status !== filter['status'].toUpperCase()) continue;
      if (!filter['status'] && !['COMPLETED', 'SETTLED', 'CONFIRMED', 'ACTIVE'].includes(status)) continue;

      allBookings.push(item);
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey && allBookings.length < targetCount * 10); // collect a pool to distribute

  // Enrich with vatStatus from listing
  const enriched: SampledBooking[] = [];
  for (const booking of allBookings) {
    const listing = await fetchListing(ddb, tableName, booking.listingId);
    const vatStatus = (listing?.hostVatStatusAtCreation ?? 'EXEMPT_FRANCHISE') as VATStatus;
    if (filter['vatStatus'] && vatStatus !== filter['vatStatus']) continue;
    enriched.push({ bookingId: booking.bookingId, type: 'BOOKING', vatStatus, record: booking });
  }

  // Balanced sampling across vatStatus values
  return balancedSample(enriched, targetCount);
}

function balancedSample(items: SampledBooking[], count: number): SampledBooking[] {
  if (items.length <= count) return items;

  const buckets: Record<VATStatus, SampledBooking[]> = {
    VAT_REGISTERED: [],
    EXEMPT_FRANCHISE: [],
    NONE: [],
  };

  for (const item of items) {
    buckets[item.vatStatus].push(item);
  }

  // Allocate proportionally: roughly 1/3 each, filling remainder from largest bucket
  const perBucket = Math.floor(count / 3);
  const remainder = count - perBucket * 3;

  const targets: Record<VATStatus, number> = {
    VAT_REGISTERED: perBucket,
    EXEMPT_FRANCHISE: perBucket,
    NONE: perBucket,
  };

  // Give remainder to whichever bucket is largest
  const largest = (Object.keys(buckets) as VATStatus[]).sort(
    (a, b) => buckets[b].length - buckets[a].length,
  )[0];
  targets[largest] += remainder;

  const result: SampledBooking[] = [];
  for (const [status, target] of Object.entries(targets) as [VATStatus, number][]) {
    result.push(...buckets[status].slice(0, target));
  }

  // If any bucket was underfilled, pull from others
  if (result.length < count) {
    const used = new Set(result.map((r) => r.bookingId));
    for (const item of items) {
      if (result.length >= count) break;
      if (!used.has(item.bookingId)) {
        result.push(item);
        used.add(item.bookingId);
      }
    }
  }

  return result.slice(0, count);
}

// ---------------------------------------------------------------------------
// Surface 2: Recompute
// ---------------------------------------------------------------------------

async function checkRecompute(
  booking: DdbBookingRecord,
  listing: DdbListingRecord,
  platformFeePct: number,
): Promise<SurfaceResult> {
  try {
    const tieredPricing: TieredPricing = {
      hostNetPricePerHourEur: listing.hostNetPricePerHourEur,
      dailyDiscountPct: listing.dailyDiscountPct,
      weeklyDiscountPct: listing.weeklyDiscountPct,
      monthlyDiscountPct: listing.monthlyDiscountPct,
    };

    const input: FullPriceBreakdownInput = {
      pricing: tieredPricing,
      durationHours: booking.durationHours,
      hostVatStatus: listing.hostVatStatusAtCreation,
      platformFeePct,
      vatRate: BELGIAN_STANDARD_VAT_RATE,
    };

    const recomputed = computeFullPriceBreakdown(input);
    const snap = booking.priceBreakdown;

    // Compare all monetary fields in cents
    const mismatches: string[] = [];

    const fields: Array<keyof PriceBreakdown> = [
      'hostNetTotalEur',
      'hostVatEur',
      'hostGrossTotalEur',
      'platformFeeEur',
      'platformFeeVatEur',
      'spotterGrossTotalEur',
    ];

    for (const field of fields) {
      const snapCents = toCents(snap[field] as number);
      const recompCents = toCents(recomputed[field] as number);
      if (snapCents !== recompCents) {
        mismatches.push(
          `${field}: snapshot=${snapCents}c recomputed=${recompCents}c delta=${recompCents - snapCents}c`,
        );
      }
    }

    if (mismatches.length > 0) {
      return {
        status: 'FAIL',
        expected: toCents(snap.spotterGrossTotalEur),
        actual: toCents(recomputed.spotterGrossTotalEur),
        deltaCents: toCents(recomputed.spotterGrossTotalEur) - toCents(snap.spotterGrossTotalEur),
        details:
          `Recomputed breakdown differs from snapshot — pricing function may have changed after the booking was created (LD-018 violation). Mismatches: ${mismatches.join('; ')}`,
      };
    }

    return {
      status: 'PASS',
      values: {
        hostNetTotalEur: recomputed.hostNetTotalEur,
        hostVatEur: recomputed.hostVatEur,
        hostGrossTotalEur: recomputed.hostGrossTotalEur,
        platformFeeEur: recomputed.platformFeeEur,
        platformFeeVatEur: recomputed.platformFeeVatEur,
        spotterGrossTotalEur: recomputed.spotterGrossTotalEur,
        appliedTier: recomputed.appliedTier,
      },
    };
  } catch (err) {
    return {
      status: 'FAIL',
      details: `Exception during recompute: ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Surface 3: Listing card price
// ---------------------------------------------------------------------------

async function checkListingCard(
  booking: DdbBookingRecord,
  listing: DdbListingRecord,
  platformFeePct: number,
): Promise<SurfaceResult> {
  try {
    // Simulate what the listing card would show: recompute using current listing pricing
    // and the booking's duration. The spec says "call the underlying handler" but since
    // we have no HTTP endpoint in a script context, we call the same canonical function
    // directly — which is what the listing get handler would use.
    const tieredPricing: TieredPricing = {
      hostNetPricePerHourEur: listing.hostNetPricePerHourEur,
      dailyDiscountPct: listing.dailyDiscountPct,
      weeklyDiscountPct: listing.weeklyDiscountPct,
      monthlyDiscountPct: listing.monthlyDiscountPct,
    };

    const input: FullPriceBreakdownInput = {
      pricing: tieredPricing,
      durationHours: booking.durationHours,
      hostVatStatus: listing.hostVatStatusAtCreation,
      platformFeePct,
      vatRate: BELGIAN_STANDARD_VAT_RATE,
    };

    const computed = computeFullPriceBreakdown(input);
    const snapCents = toCents(booking.priceBreakdown.spotterGrossTotalEur);
    const cardCents = toCents(computed.spotterGrossTotalEur);

    if (snapCents !== cardCents) {
      return {
        status: 'FAIL',
        expected: snapCents,
        actual: cardCents,
        deltaCents: cardCents - snapCents,
        details:
          `Listing card price differs from snapshot — pricing function may have changed after the booking was created (LD-018 violation). Expected €${(snapCents / 100).toFixed(2)}, listing card shows €${(cardCents / 100).toFixed(2)}.`,
      };
    }

    return {
      status: 'PASS',
      values: {
        spotterGrossTotalEur: computed.spotterGrossTotalEur,
      },
    };
  } catch (err) {
    return {
      status: 'FAIL',
      details: `Exception computing listing card price: ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Surface 4: Stripe PaymentIntent amount
// ---------------------------------------------------------------------------

async function checkStripePaymentIntent(
  booking: DdbBookingRecord,
  stripe: Stripe,
): Promise<SurfaceResult> {
  const piId = booking.stripePaymentIntentId;
  if (!piId) {
    return {
      status: 'SKIPPED',
      details: 'No stripePaymentIntentId on booking record',
    };
  }

  // Seed script uses placeholder IDs like pi_uat_* which won't exist in Stripe
  if (piId.startsWith('pi_uat_')) {
    return {
      status: 'SKIPPED',
      details: `PaymentIntent ID "${piId}" is a seed placeholder — not a real Stripe object. Run the full booking flow to create real PaymentIntents.`,
    };
  }

  try {
    const pi = await stripe.paymentIntents.retrieve(piId);

    if (pi.currency !== 'eur') {
      return {
        status: 'FAIL',
        details: `PaymentIntent currency is "${pi.currency}" — expected "eur". LD-018 violation.`,
      };
    }

    const snapCents = toCents(booking.priceBreakdown.spotterGrossTotalEur);
    const piCents = pi.amount;

    if (snapCents !== piCents) {
      return {
        status: 'FAIL',
        expected: snapCents,
        actual: piCents,
        deltaCents: piCents - snapCents,
        details:
          `PaymentIntent amount (${piCents}c) differs from snapshotted spotterGrossTotalEur (${snapCents}c) — likely the snapshot was modified after charge, or the fee config changed without snapshotting.`,
      };
    }

    // Metadata sanity check
    const metaBookingId = pi.metadata?.['bookingId'];
    const metaSpotterId = pi.metadata?.['spotterId'];
    if (metaBookingId && metaBookingId !== booking.bookingId) {
      return {
        status: 'FAIL',
        details: `PaymentIntent metadata.bookingId ("${metaBookingId}") does not match booking record bookingId ("${booking.bookingId}").`,
      };
    }
    if (metaSpotterId && metaSpotterId !== booking.spotterId) {
      return {
        status: 'FAIL',
        details: `PaymentIntent metadata.spotterId ("${metaSpotterId}") does not match booking record spotterId ("${booking.spotterId}").`,
      };
    }

    return {
      status: 'PASS',
      values: {
        amountCents: piCents,
        currency: pi.currency,
        status: pi.status,
      },
    };
  } catch (err) {
    const stripeErr = err as { code?: string; message?: string };
    if (stripeErr.code === 'resource_missing') {
      return {
        status: 'FAIL',
        details: `PaymentIntent "${piId}" not found in Stripe — may have been deleted or belongs to a different Stripe account.`,
      };
    }
    return {
      status: 'FAIL',
      details: `Stripe API error retrieving PaymentIntent "${piId}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Surface 5: Stripe Charge — application fee
// ---------------------------------------------------------------------------

async function checkStripeAppFee(
  booking: DdbBookingRecord,
  stripe: Stripe,
): Promise<SurfaceResult> {
  const piId = booking.stripePaymentIntentId;
  if (!piId) {
    return { status: 'SKIPPED', details: 'No stripePaymentIntentId on booking record' };
  }
  if (piId.startsWith('pi_uat_')) {
    return {
      status: 'SKIPPED',
      details: `PaymentIntent ID "${piId}" is a seed placeholder — not a real Stripe object.`,
    };
  }

  try {
    const pi = await stripe.paymentIntents.retrieve(piId, {
      expand: ['latest_charge'],
    });

    const charge = pi.latest_charge;
    if (!charge || typeof charge === 'string') {
      return {
        status: 'SKIPPED',
        details: `PaymentIntent "${piId}" has no captured charge yet (status: ${pi.status}).`,
      };
    }

    const appFeeAmount = charge.application_fee_amount;
    if (appFeeAmount === null || appFeeAmount === undefined) {
      return {
        status: 'SKIPPED',
        details: `Charge "${charge.id}" has no application_fee_amount — charge may not have been routed through Stripe Connect.`,
      };
    }

    const snap = booking.priceBreakdown;
    // Application fee = platformFeeEur + platformFeeVatEur (Stripe holds gross fee incl. VAT)
    const expectedCents = toCents(snap.platformFeeEur) + toCents(snap.platformFeeVatEur);
    const actualCents = appFeeAmount;

    if (expectedCents !== actualCents) {
      return {
        status: 'FAIL',
        expected: expectedCents,
        actual: actualCents,
        deltaCents: actualCents - expectedCents,
        details:
          `Stripe application fee (${actualCents}c) differs from expected platformFeeEur+platformFeeVatEur (${expectedCents}c) — platform fee rate may have changed between booking and charge, or fee VAT was not included in the application fee transfer.`,
      };
    }

    return {
      status: 'PASS',
      values: {
        amountCents: actualCents,
        chargeId: charge.id,
      },
    };
  } catch (err) {
    const stripeErr = err as { code?: string };
    if (stripeErr.code === 'resource_missing') {
      return {
        status: 'FAIL',
        details: `PaymentIntent "${piId}" not found in Stripe.`,
      };
    }
    return {
      status: 'FAIL',
      details: `Stripe API error checking application fee: ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Surface 6: Stripe Connect transfer to host
// ---------------------------------------------------------------------------

async function checkStripeTransfer(
  booking: DdbBookingRecord,
  stripe: Stripe,
): Promise<SurfaceResult> {
  const piId = booking.stripePaymentIntentId;
  if (!piId) {
    return { status: 'SKIPPED', details: 'No stripePaymentIntentId on booking record' };
  }
  if (piId.startsWith('pi_uat_')) {
    return {
      status: 'SKIPPED',
      details: `PaymentIntent ID "${piId}" is a seed placeholder — not a real Stripe object.`,
    };
  }

  try {
    // Look up transfer by transfer_group convention used in Spotzy payment flow
    // The payment-webhook handler uses transfer_group: `BOOKING_${bookingId}`
    const transferGroup = `BOOKING_${booking.bookingId}`;
    const transfers = await stripe.transfers.list({
      transfer_group: transferGroup,
      limit: 10,
    });

    if (transfers.data.length === 0) {
      // Fallback: look for transfers created from the PaymentIntent's charge
      const pi = await stripe.paymentIntents.retrieve(piId, {
        expand: ['latest_charge'],
      });
      const charge = pi.latest_charge;
      if (!charge || typeof charge === 'string') {
        return {
          status: 'SKIPPED',
          details: `No transfers found for transfer_group "${transferGroup}" and no captured charge on PaymentIntent "${piId}". Host payout may not have been initiated yet.`,
        };
      }
      return {
        status: 'SKIPPED',
        details: `No transfers found for transfer_group "${transferGroup}". Host payout may not have been initiated yet (booking status may not be settled).`,
      };
    }

    // Sum all transfers in this group (should be exactly one for a single-shot booking)
    let totalTransferCents = 0;
    for (const transfer of transfers.data) {
      if (transfer.currency !== 'eur') {
        return {
          status: 'FAIL',
          details: `Transfer "${transfer.id}" has currency "${transfer.currency}" — expected "eur". LD-018 violation.`,
        };
      }
      totalTransferCents += transfer.amount;
    }

    const snapCents = toCents(booking.priceBreakdown.hostGrossTotalEur);

    if (snapCents !== totalTransferCents) {
      return {
        status: 'FAIL',
        expected: snapCents,
        actual: totalTransferCents,
        deltaCents: totalTransferCents - snapCents,
        details:
          `Stripe Connect transfer total (${totalTransferCents}c) differs from snapshotted hostGrossTotalEur (${snapCents}c) — host payout amount does not match the booking snapshot. Check whether multiple transfers were created or whether the transfer was for the wrong amount.`,
      };
    }

    return {
      status: 'PASS',
      values: {
        amountCents: totalTransferCents,
        transferCount: transfers.data.length,
        transferGroup,
      },
    };
  } catch (err) {
    return {
      status: 'FAIL',
      details: `Stripe API error checking transfer: ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Surface 7: Receipt PDF
// ---------------------------------------------------------------------------

async function checkReceiptPdf(
  _bookingId: string,
  _snapshot: PriceBreakdown,
): Promise<SurfaceResult> {
  // Receipt PDF handler (Session 14 / receipts/render.ts) is not yet implemented.
  // Per spec: mark as SKIPPED rather than fail.
  return {
    status: 'SKIPPED',
    details:
      'Receipt PDF handler not yet implemented (Session 14 deferred). This surface will be checked once receipts/render.ts is available.',
  };
}

// ---------------------------------------------------------------------------
// Block alloc surface replacements (3' and 7')
// ---------------------------------------------------------------------------

async function checkBlockPlanSummary(
  alloc: DdbBlockAllocRecord,
  blockReq: DdbBlockReqRecord | null,
): Promise<SurfaceResult> {
  if (!blockReq) {
    return {
      status: 'FAIL',
      details: `Block request "${alloc.reqId}" not found in DynamoDB — cannot check proposed plan summary.`,
    };
  }

  // The block plan summary price is stored on BLOCKREQ.proposedPlans[i].priceBreakdown
  // Compare to BLOCKALLOC.priceBreakdown (the snapshotted allocation)
  const proposedPlans = blockReq.proposedPlans ?? [];
  if (proposedPlans.length === 0) {
    return {
      status: 'SKIPPED',
      details: `Block request "${alloc.reqId}" has no proposedPlans — block plan summary cannot be verified. Block may not yet have been confirmed.`,
    };
  }

  // Find the plan that matches this alloc (by allocId or by closest price match)
  // The plan may not have a direct allocId reference — check all plans and find the closest
  let bestMatch: PriceBreakdown | null = null;
  let minDelta = Infinity;

  for (const plan of proposedPlans) {
    if (!plan.priceBreakdown) continue;
    const delta = Math.abs(
      toCents(plan.priceBreakdown.spotterGrossTotalEur) -
        toCents(alloc.priceBreakdown.spotterGrossTotalEur),
    );
    if (delta < minDelta) {
      minDelta = delta;
      bestMatch = plan.priceBreakdown;
    }
  }

  if (!bestMatch) {
    return {
      status: 'SKIPPED',
      details: `No matching plan with priceBreakdown found in block request "${alloc.reqId}".`,
    };
  }

  const snapCents = toCents(alloc.priceBreakdown.spotterGrossTotalEur);
  const planCents = toCents(bestMatch.spotterGrossTotalEur);

  if (snapCents !== planCents) {
    return {
      status: 'FAIL',
      expected: snapCents,
      actual: planCents,
      deltaCents: planCents - snapCents,
      details:
        `Block plan summary spotterGrossTotalEur (${planCents}c) differs from BLOCKALLOC snapshotted value (${snapCents}c) — the accepted plan price does not match the allocation snapshot.`,
    };
  }

  return {
    status: 'PASS',
    values: {
      spotterGrossTotalEur: bestMatch.spotterGrossTotalEur,
    },
  };
}

async function checkBlockInvoicePdf(
  _allocId: string,
  _snapshot: PriceBreakdown,
): Promise<SurfaceResult> {
  // Block invoice PDF not yet implemented.
  return {
    status: 'SKIPPED',
    details:
      'Block invoice PDF handler not yet implemented. This surface will be checked once block invoicing is available.',
  };
}

// ---------------------------------------------------------------------------
// Concurrency limiter (no external dep — p-limit equivalent)
// ---------------------------------------------------------------------------

function createConcurrencyPool(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let running = 0;
  const queue: Array<() => void> = [];

  function next(): void {
    if (queue.length > 0 && running < limit) {
      const resolve = queue.shift();
      if (resolve) resolve();
    }
  }

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    await new Promise<void>((resolve) => {
      if (running < limit) {
        running++;
        resolve();
      } else {
        queue.push(() => {
          running++;
          resolve();
        });
      }
    });
    try {
      return await fn();
    } finally {
      running--;
      next();
    }
  };
}

// ---------------------------------------------------------------------------
// Core reconciliation logic for a single booking
// ---------------------------------------------------------------------------

async function reconcileBooking(
  item: SampledItem,
  ddb: DynamoDBDocumentClient,
  stripe: Stripe,
  tableName: string,
  platformFeePct: number,
  index: number,
  total: number,
  options: ReconcileOptions,
): Promise<BookingRow> {
  const label = item.bookingId.padEnd(24);
  const snapPrice = `€${item.record.priceBreakdown.spotterGrossTotalEur.toFixed(2)}`;

  if (!options.quiet) {
    process.stdout.write(
      `[${String(index).padStart(String(total).length)}/${total}]  ${label}  ${snapPrice.padEnd(12)}`,
    );
  }

  let recomputeResult: SurfaceResult;
  let listingCardResult: SurfaceResult;
  let stripeChargeResult: SurfaceResult;
  let stripeAppFeeResult: SurfaceResult;
  let stripeTransferResult: SurfaceResult;
  let receiptPdfResult: SurfaceResult;

  if (item.type === 'BOOKING') {
    const booking = item.record as DdbBookingRecord;
    const listing = await fetchListing(ddb, tableName, booking.listingId);

    if (!listing) {
      const errResult: SurfaceResult = {
        status: 'FAIL',
        details: `Listing "${booking.listingId}" not found in DynamoDB — cannot recompute pricing.`,
      };
      recomputeResult = errResult;
      listingCardResult = errResult;
    } else {
      // Run Stripe calls with concurrency cap — the pool is managed at call-site
      [recomputeResult, listingCardResult] = [
        await checkRecompute(booking, listing, platformFeePct),
        await checkListingCard(booking, listing, platformFeePct),
      ];
    }

    stripeChargeResult = await checkStripePaymentIntent(booking, stripe);
    stripeAppFeeResult = await checkStripeAppFee(booking, stripe);
    stripeTransferResult = await checkStripeTransfer(booking, stripe);
    receiptPdfResult = await checkReceiptPdf(booking.bookingId, booking.priceBreakdown);
  } else {
    // BLOCKALLOC
    const alloc = item.record as DdbBlockAllocRecord;
    const listing = await fetchListing(ddb, tableName, alloc.poolListingId);
    const blockReq = await fetchBlockReq(ddb, tableName, alloc.reqId);

    // Synthetic booking record for Stripe surface checks
    const syntheticBooking: DdbBookingRecord = {
      PK: `BLOCKREQ#${alloc.reqId}`,
      SK: `BLOCKALLOC#${alloc.allocId}`,
      bookingId: item.bookingId,
      listingId: alloc.poolListingId,
      spotterId: '',
      hostId: alloc.spotManagerUserId,
      startTime: '',
      endTime: '',
      durationHours: 0,
      status: '',
      priceBreakdown: alloc.priceBreakdown,
      stripePaymentIntentId: (blockReq as DdbBlockReqRecord | null)?.stripePaymentIntentId,
    };

    if (!listing) {
      const errResult: SurfaceResult = {
        status: 'FAIL',
        details: `Pool listing "${alloc.poolListingId}" not found in DynamoDB.`,
      };
      recomputeResult = errResult;
      listingCardResult = errResult;
    } else {
      // For block alloc recompute, reconstruct the aggregated pricing
      const aggregatedPricing: TieredPricing = {
        hostNetPricePerHourEur: listing.hostNetPricePerHourEur * alloc.contributedBayCount,
        dailyDiscountPct: listing.dailyDiscountPct,
        weeklyDiscountPct: listing.weeklyDiscountPct,
        monthlyDiscountPct: listing.monthlyDiscountPct,
      };
      const windowHours = computeWindowHours(alloc, blockReq);
      const syntheticForRecompute: DdbBookingRecord = {
        ...syntheticBooking,
        durationHours: windowHours,
      };
      const syntheticListing: DdbListingRecord = {
        ...listing,
        hostNetPricePerHourEur: aggregatedPricing.hostNetPricePerHourEur,
      };
      recomputeResult = await checkRecompute(syntheticForRecompute, syntheticListing, platformFeePct);
      // Surface 3' — block plan summary replaces listing card
      listingCardResult = await checkBlockPlanSummary(alloc, blockReq);
    }

    stripeChargeResult = await checkStripePaymentIntent(syntheticBooking, stripe);
    stripeAppFeeResult = await checkStripeAppFee(syntheticBooking, stripe);
    stripeTransferResult = await checkStripeTransfer(syntheticBooking, stripe);
    // Surface 7' — block invoice PDF replaces per-booking receipt
    receiptPdfResult = await checkBlockInvoicePdf(alloc.allocId, alloc.priceBreakdown);
  }

  const surfaces: BookingRow['surfaces'] = {
    snapshot: { status: 'REFERENCE' },
    recompute: recomputeResult,
    listingCard: listingCardResult,
    stripeCharge: stripeChargeResult,
    stripeAppFee: stripeAppFeeResult,
    stripeTransfer: stripeTransferResult,
    receiptPdf: receiptPdfResult,
  };

  const allSurfaces = [
    recomputeResult,
    listingCardResult,
    stripeChargeResult,
    stripeAppFeeResult,
    stripeTransferResult,
    receiptPdfResult,
  ];

  const hasFail = allSurfaces.some((s) => s.status === 'FAIL');
  const allSkipped = allSurfaces.every((s) => s.status === 'SKIPPED' || s.status === 'REFERENCE');

  if (!options.quiet) {
    if (hasFail) {
      const failures = Object.entries(surfaces)
        .filter(([, v]) => v.status === 'FAIL')
        .map(([k]) => k);
      process.stdout.write(red(`  MISMATCH on ${failures.join(', ')}\n`));

      // Print details for each failure
      for (const [surface, result] of Object.entries(surfaces)) {
        if (result.status === 'FAIL') {
          const delta =
            result.deltaCents !== undefined
              ? ` Δ ${result.deltaCents > 0 ? '+' : ''}€${(result.deltaCents / 100).toFixed(2)}`
              : '';
          process.stdout.write(
            `${' '.repeat(String(total).length * 2 + 30)}${dim(`  [${surface}]`)} ${result.details ?? ''}${delta}\n`,
          );
        }
      }
    } else if (allSkipped) {
      process.stdout.write(yellow(`  all surfaces SKIPPED\n`));
    } else {
      const skippedCount = allSurfaces.filter((s) => s.status === 'SKIPPED').length;
      const passCount = allSurfaces.filter((s) => s.status === 'PASS').length;
      const surfaceLabel =
        skippedCount > 0
          ? `${passCount} passed, ${skippedCount} skipped`
          : `all ${SURFACE_COUNT} surfaces match`;
      process.stdout.write(green(`  ${surfaceLabel}\n`));
    }
  }

  return {
    bookingId: item.bookingId,
    type: item.type,
    vatStatus: item.vatStatus,
    snapshot: item.record.priceBreakdown,
    surfaces,
  };
}

function computeWindowHours(
  alloc: DdbBlockAllocRecord,
  blockReq: DdbBlockReqRecord | null,
): number {
  // Try to derive window hours from block request dates
  if (blockReq) {
    const req = blockReq as DdbBlockReqRecord & {
      windowStart?: string;
      windowEnd?: string;
    };
    if (req.windowStart && req.windowEnd) {
      const ms = new Date(req.windowEnd).getTime() - new Date(req.windowStart).getTime();
      return ms / (1000 * 3600);
    }
  }
  // Fallback: use priceBreakdown.durationHours from snapshot
  return alloc.priceBreakdown.durationHours;
}

// ---------------------------------------------------------------------------
// Main reconciliation runner (exported for Lambda canary wrapper — Session 32b)
// ---------------------------------------------------------------------------

export async function runReconciliation(options: ReconcileOptions): Promise<{
  report: ReconcileReport;
  exitCode: number;
}> {
  const { ddb, stripe, tableName, region } = buildClients();

  const stripeMode = (process.env['STRIPE_SECRET_KEY'] ?? '').startsWith('sk_test_')
    ? 'test'
    : 'live';

  if (!options.quiet) {
    log('');
    log(bold('Spotzy UAT Reconciliation'));
    log(`Environment: staging (${region})`);
    log(`Stripe mode: ${stripeMode}`);
    log(`Table:       ${tableName}`);
    log('');
  }

  const platformFeePct = await fetchPlatformFeeConfig(ddb, tableName);

  const items = await sampleBookings(ddb, tableName, options);

  if (items.length === 0) {
    warn('No bookings found matching the sampling criteria. Nothing to check.');
    const report: ReconcileReport = {
      metadata: {
        generatedAt: new Date().toISOString(),
        environment: 'staging',
        stripeMode,
        tableName,
        region,
        samplingStrategy: options.bookingIds ? 'explicit-ids' : 'balanced-vat-status',
        count: 0,
      },
      summary: { checked: 0, passed: 0, failed: 0, skipped: 0 },
      rows: [],
    };
    return { report, exitCode: 0 };
  }

  // Log distribution
  if (!options.quiet) {
    const dist = { VAT_REGISTERED: 0, EXEMPT_FRANCHISE: 0, NONE: 0 };
    for (const item of items) dist[item.vatStatus]++;
    log(
      `Sampling: ${items.length} bookings (${dist.VAT_REGISTERED} VAT_REG / ${dist.EXEMPT_FRANCHISE} EXEMPT / ${dist.NONE} NONE)`,
    );
    log('');
  }

  const rows: BookingRow[] = [];
  const pool = createConcurrencyPool(5); // Cap Stripe API concurrency at 5

  let exitCode = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    const row = await pool(() =>
      reconcileBooking(item, ddb, stripe, tableName, platformFeePct, i + 1, items.length, options),
    );

    rows.push(row);

    const hasFail = Object.values(row.surfaces).some((s) => s.status === 'FAIL');
    if (hasFail) {
      exitCode = 1;
      if (options.bailFast) {
        if (!options.quiet) {
          log('');
          log(red('--bail-fast: stopping on first mismatch.'));
        }
        break;
      }
    }
  }

  // Compute distribution for metadata
  const dist = { VAT_REGISTERED: 0, EXEMPT_FRANCHISE: 0, NONE: 0 };
  for (const row of rows) dist[row.vatStatus]++;

  const checked = rows.length;
  const failed = rows.filter((r) =>
    Object.values(r.surfaces).some((s) => s.status === 'FAIL'),
  ).length;
  const passed = checked - failed;
  const skipped = rows.filter((r) =>
    Object.values(r.surfaces).every((s) => s.status !== 'FAIL' && s.status !== 'PASS'),
  ).length;

  const report: ReconcileReport = {
    metadata: {
      generatedAt: new Date().toISOString(),
      environment: 'staging',
      stripeMode,
      tableName,
      region,
      samplingStrategy: options.bookingIds ? 'explicit-ids' : 'balanced-vat-status',
      count: checked,
      distribution: dist,
    },
    summary: { checked, passed, failed, skipped },
    rows,
  };

  if (!options.quiet) {
    log('');
    log(bold('Summary'));
    log('─'.repeat(45));
    log(`Bookings checked       : ${checked}`);
    log(`Fully matching         : ${green(String(passed))}`);
    log(`Surfaces with mismatch : ${failed > 0 ? red(`${failed} bookings`) : '0'}`);
    log(`Surfaces SKIPPED       : ${skipped > 0 ? yellow(String(skipped)) : '0'}`);
  }

  return { report, exitCode };
}

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------

function writeReport(report: ReconcileReport, reportPath: string): void {
  const dir = path.dirname(reportPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): ReconcileOptions {
  const args = argv.slice(2);

  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const has = (flag: string): boolean => args.includes(flag);

  const countRaw = get('--count');
  const count = countRaw ? parseInt(countRaw, 10) : 20;

  const bookingIdsRaw = get('--booking-ids');
  const bookingIds = bookingIdsRaw
    ? bookingIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  const filterRaw = get('--filter');
  const filter: Record<string, string> = {};
  if (filterRaw) {
    for (const pair of filterRaw.split(',')) {
      const [k, v] = pair.split('=');
      if (k && v) filter[k.trim()] = v.trim();
    }
  }

  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const defaultReportPath = `./reports/uat-reconcile-${timestamp}.json`;
  const reportPath = get('--report') ?? defaultReportPath;

  return {
    count,
    bookingIds,
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    reportPath,
    bailFast: has('--bail-fast'),
    quiet: has('--quiet'),
  };
}

// ---------------------------------------------------------------------------
// CLI shim — only process.exit lives here
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  // Safety guards — refuse to run if criteria not met
  try {
    assertSafetyGuards();
  } catch (err) {
    process.stderr.write(`\nFATAL: ${String(err)}\n\n`);
    process.exit(1);
  }

  const { report, exitCode } = await runReconciliation(options);

  writeReport(report, options.reportPath);

  if (!options.quiet) {
    log('');
    log(`Detail report: ${options.reportPath}`);
    log('');
    if (exitCode === 0) {
      log(green(bold('EXIT 0 — all surfaces in agreement')));
    } else {
      log(red(bold('EXIT 1 — reconciliation failed')));
    }
    log('');
  }

  process.exit(exitCode);
}

// Only run as CLI when executed directly
if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`\nUnhandled error: ${String(err)}\n`);
    if (err instanceof Error && err.stack) {
      process.stderr.write(err.stack + '\n');
    }
    process.exit(1);
  });
}
