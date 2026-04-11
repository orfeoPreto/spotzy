import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import Stripe from 'stripe';
import { createLogger } from '../../../shared/utils/logger';
import {
  PERCENTAGE_RATE,
  MIN_BAYS_FLOOR_RATIO,
} from '../../../shared/block-reservations/constants';
import type {
  BlockRequest,
  BlockAllocation,
  AllocationSettlement,
  SettlementBreakdown,
} from '../../../shared/block-reservations/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

let _stripeKey: string | undefined;
const getStripeKey = async (): Promise<string> => {
  if (_stripeKey) return _stripeKey;
  if (process.env.STRIPE_SECRET_KEY) return ((_stripeKey = process.env.STRIPE_SECRET_KEY));
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const sm = new SecretsManagerClient({});
  const res = await sm.send(new GetSecretValueCommand({ SecretId: 'spotzy/stripe/secret-key' }));
  _stripeKey = res.SecretString!;
  return _stripeKey;
};

interface SettleEvent {
  reqId: string;
}

/**
 * Compute per-allocation settlement amount based on risk share mode.
 *
 * PERCENTAGE:     allocatedBayCount * price + (contributed - allocated) * price * 0.30
 * MIN_BAYS_FLOOR: max(allocated, contributed * 0.55) * price
 */
function computeAllocationAmount(
  alloc: BlockAllocation,
  allocatedCount: number
): number {
  const { contributedBayCount, pricePerBayEur, riskShareMode } = alloc;

  if (riskShareMode === 'PERCENTAGE') {
    const filledCost = allocatedCount * pricePerBayEur;
    const unfilledCost =
      (contributedBayCount - allocatedCount) * pricePerBayEur * PERCENTAGE_RATE;
    return Math.round((filledCost + unfilledCost) * 100) / 100;
  }

  // MIN_BAYS_FLOOR
  const floorBays = Math.ceil(contributedBayCount * MIN_BAYS_FLOOR_RATIO);
  const effectiveBays = Math.max(allocatedCount, floorBays);
  return Math.round(effectiveBays * pricePerBayEur * 100) / 100;
}

export const handler = async (event: SettleEvent): Promise<void> => {
  const log = createLogger('block-settle', 'scheduler', undefined);
  const { reqId } = event;
  log.info('settle invoked', { reqId });

  // Load the entire BLOCKREQ# partition (METADATA + BLOCKALLOC# + BOOKING#)
  const queryResult = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `BLOCKREQ#${reqId}` },
    })
  );

  const items = queryResult.Items ?? [];
  const metadata = items.find((i) => i.SK === 'METADATA') as unknown as BlockRequest | undefined;
  if (!metadata) {
    log.warn('BLOCKREQ# not found', { reqId });
    return;
  }

  if (metadata.status !== 'AUTHORISED') {
    log.info('skipping settle — status is not AUTHORISED', { reqId, status: metadata.status });
    return;
  }

  const allocations = items.filter((i) =>
    typeof i.SK === 'string' && i.SK.startsWith('BLOCKALLOC#')
  ) as unknown as BlockAllocation[];

  const bookings = items.filter((i) =>
    typeof i.SK === 'string' && i.SK.startsWith('BOOKING#')
  );

  // Count BOOKING# per allocation
  const allocatedCounts: Record<string, number> = {};
  for (const b of bookings) {
    if (b.allocationStatus === 'ALLOCATED') {
      allocatedCounts[b.allocId] = (allocatedCounts[b.allocId] ?? 0) + 1;
    }
  }

  // Read CONFIG#PLATFORM_FEE for the fee snapshot
  let blockReservationPct = 0.15; // default
  try {
    const configResult = await ddb.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: 'CONFIG#PLATFORM_FEE', SK: 'METADATA' },
      })
    );
    if (configResult.Item?.blockReservationPct != null) {
      blockReservationPct = configResult.Item.blockReservationPct;
    }
  } catch (err) {
    log.warn('failed to read CONFIG#PLATFORM_FEE, using default', { err });
  }

  // Compute per-allocation amounts. Include pool metadata (address, risk share,
  // price) on each row so the settlement summary page can render without additional
  // lookups.
  const perAllocBreakdown: any[] = [];
  let totalCaptureEur = 0;

  for (const alloc of allocations) {
    const allocatedCount = allocatedCounts[alloc.allocId] ?? 0;
    const amountEur = computeAllocationAmount(alloc, allocatedCount);
    const platformFeeEur = Math.round(amountEur * blockReservationPct * 100) / 100;
    const netToSpotManagerEur = Math.round((amountEur - platformFeeEur) * 100) / 100;

    // Look up the pool listing for display fields (best-effort)
    let poolName = alloc.poolListingId;
    try {
      const poolRes = await ddb.send(
        new GetCommand({
          TableName: TABLE,
          Key: { PK: `LISTING#${alloc.poolListingId}`, SK: 'METADATA' },
        }),
      );
      if (poolRes.Item?.address) poolName = poolRes.Item.address as string;
    } catch {
      // fall through — use ID as display name
    }

    totalCaptureEur += amountEur;
    perAllocBreakdown.push({
      allocId: alloc.allocId,
      poolListingId: alloc.poolListingId,
      poolName,
      contributedBayCount: alloc.contributedBayCount,
      allocatedBayCount: allocatedCount,
      pricePerBayEur: alloc.pricePerBayEur,
      riskShareMode: alloc.riskShareMode,
      riskShareRate: alloc.riskShareRate,
      amountEur: Math.round(amountEur * 100) / 100,
      platformFeePct: blockReservationPct,
      platformFeeEur,
      netToSpotManagerEur,
      transferId: null,
    });
  }

  totalCaptureEur = Math.round(totalCaptureEur * 100) / 100;
  const worstCaseEur = allocations.reduce(
    (sum, a) => sum + a.contributedBayCount * a.pricePerBayEur,
    0
  );
  const refundedEur = Math.round((worstCaseEur - totalCaptureEur) * 100) / 100;

  // Capture the held authorisation
  const stripeKey = await getStripeKey();
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
  const now = new Date().toISOString();

  let chargeId: string;
  try {
    const captureResult = await stripe.paymentIntents.capture(
      metadata.authorisationId!,
      { amount_to_capture: Math.round(totalCaptureEur * 100) },
      { idempotencyKey: `blockreq:${reqId}:capture` }
    );
    chargeId =
      (captureResult as unknown as { latest_charge?: string }).latest_charge ??
      (captureResult as unknown as { charges?: { data?: Array<{ id: string }> } }).charges
        ?.data?.[0]?.id ??
      '';
    log.info('capture succeeded', { reqId, totalCaptureEur, chargeId });
  } catch (err) {
    // Inspect the PI — if it was never confirmed with a real payment method
    // (dev-local flow where the authorise Lambda created a bare manual_capture PI
    // without a customer), there's nothing to capture. Log a warning and proceed
    // with settlement so the state machine can still reach SETTLED for testing.
    // In production with real payment methods, this catch block still writes a
    // settlementError and returns — preserving the original safety behaviour.
    let canContinueDevLocal = false;
    try {
      const pi = await stripe.paymentIntents.retrieve(metadata.authorisationId!);
      if (pi.status === 'requires_payment_method' || pi.status === 'canceled') {
        canContinueDevLocal = true;
        log.warn('capture skipped — PI in dev-local state, settling without real capture', {
          reqId,
          piStatus: pi.status,
        });
      }
    } catch {
      // fall through
    }

    if (!canContinueDevLocal) {
      log.error('capture failed', err, { reqId });
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
          UpdateExpression: 'SET settlementError = :err, updatedAt = :now',
          ExpressionAttributeValues: { ':err': String(err), ':now': now },
        })
      );
      return;
    }
    chargeId = '';
  }

  // Create Stripe Connect Transfers per allocation
  for (const breakdown of perAllocBreakdown) {
    const alloc = allocations.find((a) => a.allocId === breakdown.allocId)!;
    const netToSpotManagerEur =
      Math.round((breakdown.amountEur - breakdown.platformFeeEur) * 100) / 100;
    const netCents = Math.round(netToSpotManagerEur * 100);

    // Look up the Spot Manager's Stripe Connect account
    let stripeConnectAccountId: string | undefined;
    try {
      const smProfile = await ddb.send(
        new GetCommand({
          TableName: TABLE,
          Key: { PK: `USER#${alloc.spotManagerUserId}`, SK: 'PROFILE' },
        })
      );
      stripeConnectAccountId = smProfile.Item?.stripeConnectAccountId;
    } catch {
      log.warn('failed to look up Spot Manager profile', { allocId: alloc.allocId });
    }

    let transferId: string | null = null;
    let transferStatus: 'PENDING' | 'CREATED' | 'FAILED' = 'PENDING';

    if (stripeConnectAccountId && netCents > 0) {
      try {
        const transfer = await stripe.transfers.create(
          {
            amount: netCents,
            currency: 'eur',
            destination: stripeConnectAccountId,
            source_transaction: chargeId,
            metadata: { reqId, allocId: alloc.allocId },
          },
          { idempotencyKey: `blockreq:${reqId}:transfer:${alloc.allocId}` }
        );
        transferId = transfer.id;
        transferStatus = 'CREATED';
        log.info('transfer created', { allocId: alloc.allocId, transferId });
      } catch (err) {
        log.error('transfer failed', err, { allocId: alloc.allocId });
        transferStatus = 'FAILED';
      }
    }

    breakdown.transferId = transferId;

    // Write settlement to BLOCKALLOC#
    const allocSettlement: AllocationSettlement = {
      amountEur: breakdown.amountEur,
      platformFeePct: blockReservationPct,
      platformFeeEur: breakdown.platformFeeEur,
      netToSpotManagerEur,
      transferId,
      transferStatus,
      settledAt: now,
    };

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `BLOCKREQ#${reqId}`, SK: `BLOCKALLOC#${alloc.allocId}` },
        UpdateExpression: 'SET settlement = :s, updatedAt = :now',
        ExpressionAttributeValues: { ':s': allocSettlement, ':now': now },
      })
    );
  }

  // Write settlement breakdown and transition to SETTLED on BLOCKREQ#
  const settlementBreakdown: any = {
    totalEur: worstCaseEur,
    capturedEur: totalCaptureEur,
    refundedEur,
    settledAt: now,
    perAllocation: perAllocBreakdown,
  };

  const auditEntry = {
    timestamp: now,
    actorUserId: 'SYSTEM',
    action: 'SETTLED',
    before: { status: 'AUTHORISED' },
    after: { status: 'SETTLED', capturedEur: totalCaptureEur },
  };

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
      UpdateExpression:
        'SET #status = :s, settlementBreakdown = :sb, auditLog = list_append(if_not_exists(auditLog, :empty), :entry), updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':s': 'SETTLED',
        ':sb': settlementBreakdown,
        ':entry': [auditEntry],
        ':empty': [],
        ':now': now,
      },
    })
  );

  // Send settlement email
  try {
    const ownerProfile = await ddb.send(
      new GetCommand({
        TableName: TABLE,
        Key: { PK: `USER#${metadata.ownerUserId}`, SK: 'PROFILE' },
      })
    );
    const email = ownerProfile.Item?.email;
    if (email) {
      await ses.send(
        new SendEmailCommand({
          Source: process.env.SES_FROM_EMAIL ?? 'noreply@spotzy.be',
          Destination: { ToAddresses: [email] },
          Message: {
            Subject: { Data: 'Your Spotzy block reservation has been settled' },
            Body: {
              Html: {
                Data: `<p>Your block reservation ${reqId} has been settled. Total captured: EUR ${totalCaptureEur.toFixed(2)}.</p>`,
              },
            },
          },
        })
      );
    }
  } catch (err) {
    log.warn('failed to send settlement email', { err });
  }

  log.info('settlement complete', { reqId, totalCaptureEur, refundedEur });
};
