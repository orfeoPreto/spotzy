import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { SchedulerClient, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import Stripe from 'stripe';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, conflict, forbidden } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import {
  FREE_CANCEL_THRESHOLD_DAYS,
  NO_CANCEL_THRESHOLD_HOURS,
  PARTIAL_CANCEL_PERCENTAGE,
} from '../../../shared/block-reservations/constants';
import type { BlockRequest, BlockAllocation } from '../../../shared/block-reservations/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const scheduler = new SchedulerClient({});
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

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('block-request-cancel', event.requestContext.requestId, claims?.userId);

  if (!claims) return unauthorized();

  const reqId = event.pathParameters?.reqId;
  if (!reqId) return notFound();

  // Load the BLOCKREQ# partition
  const queryResult = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `BLOCKREQ#${reqId}` },
    })
  );

  const items = queryResult.Items ?? [];
  const metadata = items.find((i) => i.SK === 'METADATA') as unknown as BlockRequest | undefined;
  if (!metadata) return notFound();

  // Owner check
  if (metadata.ownerUserId !== claims.userId) return forbidden();

  // Already cancelled or settled
  if (metadata.status === 'CANCELLED') return conflict('ALREADY_CANCELLED');
  if (metadata.status === 'SETTLED') return conflict('REQUEST_TERMINAL');

  // Only allow cancel on PENDING_MATCH, PLANS_PROPOSED, CONFIRMED, AUTHORISED
  const cancellableStatuses = ['PENDING_MATCH', 'PLANS_PROPOSED', 'CONFIRMED', 'AUTHORISED'];
  if (!cancellableStatuses.includes(metadata.status)) {
    return conflict('REQUEST_NOT_CANCELLABLE');
  }

  const now = new Date();
  const startsAt = new Date(metadata.startsAt);
  const hoursToWindowStart = (startsAt.getTime() - now.getTime()) / (3600 * 1000);
  const nowIso = now.toISOString();

  // Auth-failure grace: free cancel if authorisationRetryCount > 0 and status is CONFIRMED
  const authFailureGrace =
    metadata.authorisationRetryCount > 0 && metadata.status === 'CONFIRMED';

  const allocations = items.filter(
    (i) => typeof i.SK === 'string' && i.SK.startsWith('BLOCKALLOC#')
  ) as unknown as BlockAllocation[];

  const worstCaseEur = allocations.reduce(
    (sum, a) => sum + a.contributedBayCount * a.pricePerBayEur,
    0
  );

  // Determine cancellation tier
  if (authFailureGrace || hoursToWindowStart > FREE_CANCEL_THRESHOLD_DAYS * 24) {
    // FREE TIER
    const reason = authFailureGrace ? 'AUTH_FAILED' : 'USER_CANCELLED_FREE';
    log.info('free cancellation', { reqId, reason, hoursToWindowStart });

    // If there's a held auth, void it
    if (metadata.authorisationId) {
      try {
        const stripeKey = await getStripeKey();
        const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
        await stripe.paymentIntents.cancel(metadata.authorisationId);
      } catch (err) {
        log.warn('failed to void authorisation', { err });
      }
    }

    // Transition to CANCELLED
    const auditEntry = {
      timestamp: nowIso,
      actorUserId: claims.userId,
      action: 'CANCELLED',
      before: { status: metadata.status },
      after: { status: 'CANCELLED', cancellationReason: reason },
    };

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
        UpdateExpression:
          'SET #status = :s, cancellationReason = :r, auditLog = list_append(if_not_exists(auditLog, :empty), :entry), updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':s': 'CANCELLED',
          ':r': reason,
          ':entry': [auditEntry],
          ':empty': [],
          ':now': nowIso,
        },
      })
    );

    // Anonymise BOOKING# PII immediately
    const bookings = items.filter(
      (i) => typeof i.SK === 'string' && i.SK.startsWith('BOOKING#')
    );
    for (const b of bookings) {
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `BLOCKREQ#${reqId}`, SK: b.SK },
          UpdateExpression:
            'SET guestName = :null, guestEmail = :null, guestPhone = :null, allocationStatus = :cancelled, updatedAt = :now',
          ExpressionAttributeValues: {
            ':null': null,
            ':cancelled': 'CANCELLED',
            ':now': nowIso,
          },
        })
      );
    }

    // Delete EventBridge schedules
    const scheduleNames = [
      `block-auth-${reqId}`,
      `block-settle-${reqId}`,
      `guest-anonymise-${reqId}`,
    ];
    for (const name of scheduleNames) {
      try {
        await scheduler.send(new DeleteScheduleCommand({ Name: name }));
      } catch {
        // Schedule may not exist
      }
    }

    // Notify Spot Managers
    for (const alloc of allocations) {
      try {
        const smProfile = await ddb.send(
          new GetCommand({
            TableName: TABLE,
            Key: { PK: `USER#${alloc.spotManagerUserId}`, SK: 'PROFILE' },
          })
        );
        const email = smProfile.Item?.email;
        if (email) {
          await ses.send(
            new SendEmailCommand({
              Source: process.env.SES_FROM_EMAIL ?? 'noreply@spotzy.be',
              Destination: { ToAddresses: [email] },
              Message: {
                Subject: { Data: 'Block reservation cancelled' },
                Body: {
                  Html: {
                    Data: `<p>Block reservation ${reqId} has been cancelled. Your bays have been released.</p>`,
                  },
                },
              },
            })
          );
        }
      } catch {
        // Best effort
      }
    }

    return ok({ reqId, status: 'CANCELLED', cancellationReason: reason });
  }

  if (hoursToWindowStart < NO_CANCEL_THRESHOLD_HOURS) {
    // NO-CANCEL TIER (<24h)
    log.info('cancel blocked — within 24h window', { reqId, hoursToWindowStart });
    return conflict('NO_SELF_SERVICE_CANCEL');
  }

  // 50% TIER (7d to 24h)
  log.info('50% cancellation', { reqId, hoursToWindowStart });

  const halfAmount = Math.round(worstCaseEur * PARTIAL_CANCEL_PERCENTAGE * 100) / 100;
  const halfCents = Math.round(halfAmount * 100);

  const stripeKey = await getStripeKey();
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

  // Read platform fee
  let blockReservationPct = 0.15;
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
  } catch {
    // Use default
  }

  let chargeId = '';

  if (metadata.authorisationId && metadata.status === 'AUTHORISED') {
    // Capture half of the held auth
    try {
      const captureResult = await stripe.paymentIntents.capture(
        metadata.authorisationId,
        { amount_to_capture: halfCents },
        { idempotencyKey: `blockreq:${reqId}:cancel-capture` }
      );
      chargeId =
        (captureResult as unknown as { latest_charge?: string }).latest_charge ??
        (captureResult as unknown as { charges?: { data?: Array<{ id: string }> } }).charges
          ?.data?.[0]?.id ??
        '';
    } catch (err) {
      log.error('cancel capture failed', err, { reqId });
      return { statusCode: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'PAYMENT_CAPTURE_FAILED' }) };
    }
  } else {
    // No auth yet — create a fresh PI for halfAmount and capture immediately
    try {
      // Look up owner's payment method
      const ownerProfile = await ddb.send(
        new GetCommand({
          TableName: TABLE,
          Key: { PK: `USER#${metadata.ownerUserId}`, SK: 'PROFILE' },
        })
      );
      const stripeCustomerId = ownerProfile.Item?.stripeCustomerId;
      const paymentMethodId = ownerProfile.Item?.defaultPaymentMethodId;

      const pi = await stripe.paymentIntents.create(
        {
          amount: halfCents,
          currency: 'eur',
          customer: stripeCustomerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          metadata: { purpose: 'cancel-50pct', reqId },
        },
        { idempotencyKey: `blockreq:${reqId}:cancel-fresh` }
      );
      chargeId =
        (pi as unknown as { latest_charge?: string }).latest_charge ??
        (pi as unknown as { charges?: { data?: Array<{ id: string }> } }).charges
          ?.data?.[0]?.id ??
        '';
    } catch (err) {
      log.error('fresh cancel charge failed', err, { reqId });
      return { statusCode: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'PAYMENT_CHARGE_FAILED' }) };
    }
  }

  // Distribute pro-rata to Spot Managers via Connect Transfers
  for (const alloc of allocations) {
    const proRata = (alloc.contributedBayCount * alloc.pricePerBayEur) / worstCaseEur;
    const allocShareEur = Math.round(halfAmount * proRata * 100) / 100;
    const platformFeeEur = Math.round(allocShareEur * blockReservationPct * 100) / 100;
    const netEur = Math.round((allocShareEur - platformFeeEur) * 100) / 100;
    const netCents = Math.round(netEur * 100);

    if (netCents <= 0) continue;

    try {
      const smProfile = await ddb.send(
        new GetCommand({
          TableName: TABLE,
          Key: { PK: `USER#${alloc.spotManagerUserId}`, SK: 'PROFILE' },
        })
      );
      const connectId = smProfile.Item?.stripeConnectAccountId;
      if (connectId) {
        await stripe.transfers.create(
          {
            amount: netCents,
            currency: 'eur',
            destination: connectId,
            source_transaction: chargeId,
            metadata: { reqId, allocId: alloc.allocId, purpose: 'cancel-50pct' },
          },
          { idempotencyKey: `blockreq:${reqId}:cancel-transfer:${alloc.allocId}` }
        );
      }
    } catch (err) {
      log.error('cancel transfer failed', err, { allocId: alloc.allocId });
    }
  }

  // Transition to CANCELLED
  const auditEntry = {
    timestamp: nowIso,
    actorUserId: claims.userId,
    action: 'CANCELLED',
    before: { status: metadata.status },
    after: { status: 'CANCELLED', cancellationReason: 'USER_CANCELLED_50PCT', capturedEur: halfAmount },
  };

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
      UpdateExpression:
        'SET #status = :s, cancellationReason = :r, auditLog = list_append(if_not_exists(auditLog, :empty), :entry), updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':s': 'CANCELLED',
        ':r': 'USER_CANCELLED_50PCT',
        ':entry': [auditEntry],
        ':empty': [],
        ':now': nowIso,
      },
    })
  );

  // Delete EventBridge schedules
  for (const name of [`block-auth-${reqId}`, `block-settle-${reqId}`, `guest-anonymise-${reqId}`]) {
    try {
      await scheduler.send(new DeleteScheduleCommand({ Name: name }));
    } catch {
      // May not exist
    }
  }

  return ok({
    reqId,
    status: 'CANCELLED',
    cancellationReason: 'USER_CANCELLED_50PCT',
    capturedEur: halfAmount,
  });
};
