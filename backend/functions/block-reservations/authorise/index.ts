import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { SchedulerClient, CreateScheduleCommand } from '@aws-sdk/client-scheduler';
import Stripe from 'stripe';
import { getStripeSecretKey } from '../../payments/shared/stripe-helpers';
import { createLogger } from '../../../shared/utils/logger';
import { AUTH_FAILURE_GRACE_HOURS } from '../../../shared/block-reservations/constants';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const scheduler = new SchedulerClient({});

// Lazy Stripe client — fetched from Secrets Manager on first use
let stripeClient: Stripe | null = null;
const getStripe = async (): Promise<Stripe> => {
  if (stripeClient) return stripeClient;
  const key = await getStripeSecretKey();
  stripeClient = new Stripe(key, { apiVersion: '2023-10-16' as any });
  return stripeClient;
};
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN ?? '';
const AUTH_LAMBDA_ARN = process.env.AUTH_LAMBDA_ARN ?? '';

export const handler = async (event: any) => {
  const reqId = event.reqId ?? event.detail?.reqId;
  const log = createLogger('block-authorise', reqId ?? 'unknown');

  if (!reqId) {
    log.error('missing reqId in event');
    return;
  }

  // Load BLOCKREQ# and all BLOCKALLOC# children with one Query
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `BLOCKREQ#${reqId}` },
  }));

  const items = result.Items ?? [];
  const metadata = items.find((i) => i.SK === 'METADATA');
  if (!metadata) {
    log.warn('block request not found', { reqId });
    return;
  }

  // Defensive: skip if not CONFIRMED
  if (metadata.status !== 'CONFIRMED') {
    log.info('skipping — not in CONFIRMED state', { reqId, status: metadata.status });
    return;
  }

  // Compute worst-case amount from BLOCKALLOC# children
  const allocations = items.filter((i) => (i.SK as string).startsWith('BLOCKALLOC#'));
  const worstCaseEur = allocations.reduce(
    (sum, a) => sum + (a.contributedBayCount as number) * (a.pricePerBayEur as number),
    0
  );
  const worstCaseCents = Math.round(worstCaseEur * 100);

  // Load user profile for Stripe info
  const profileResult = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USER#${metadata.ownerUserId}`, SK: 'PROFILE' },
  }));
  const profile = profileResult.Item;
  const stripeCustomerId = profile?.stripeCustomerId;
  const paymentMethodId = profile?.defaultPaymentMethodId;

  // Create manual_capture PaymentIntent
  try {
    const stripe = await getStripe();
    // If the block spotter has a Stripe customer + payment method, do an off_session
    // auth. Otherwise (dev-local flow), create a manual-capture PI with no customer
    // so the authorisation succeeds without actually holding a real card.
    const pi = await stripe.paymentIntents.create(
      stripeCustomerId && paymentMethodId
        ? {
            amount: worstCaseCents,
            currency: 'eur',
            customer: stripeCustomerId,
            payment_method: paymentMethodId,
            capture_method: 'manual',
            off_session: true,
            confirm: true,
            metadata: { purpose: 'authorise', reqId },
          }
        : {
            amount: worstCaseCents,
            currency: 'eur',
            capture_method: 'manual',
            metadata: { purpose: 'authorise', reqId },
          },
      { idempotencyKey: `blockreq:${reqId}:authorise` },
    );

    const now = new Date().toISOString();

    // Transition to AUTHORISED
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #status = :s, authorisationId = :piId, updatedAt = :now, auditLog = list_append(if_not_exists(auditLog, :emptyList), :auditEntry)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':s': 'AUTHORISED',
        ':piId': pi.id,
        ':now': now,
        ':emptyList': [],
        ':auditEntry': [{
          timestamp: now,
          actorUserId: 'SYSTEM',
          action: 'AUTHORISED',
          before: { status: 'CONFIRMED' },
          after: { status: 'AUTHORISED', authorisationId: pi.id, worstCaseEur },
        }],
      },
    }));

    // Update reverse projection
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `USER#${metadata.ownerUserId}`, SK: `BLOCKREQ#${reqId}` },
      UpdateExpression: 'SET #status = :s, lastUpdatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':s': 'AUTHORISED', ':now': now },
    }));

    log.info('block authorised', { reqId, piId: pi.id, worstCaseEur });
  } catch (err: any) {
    log.error('authorisation failed', err);

    const now = new Date().toISOString();

    // Increment retry count, do NOT change status
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
      UpdateExpression: 'SET authorisationRetryCount = if_not_exists(authorisationRetryCount, :zero) + :one, updatedAt = :now, auditLog = list_append(if_not_exists(auditLog, :emptyList), :auditEntry)',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':now': now,
        ':emptyList': [],
        ':auditEntry': [{
          timestamp: now,
          actorUserId: 'SYSTEM',
          action: 'AUTH_FAILED',
          before: { status: 'CONFIRMED' },
          after: { status: 'CONFIRMED', error: err.message },
        }],
      },
    }));

    // Schedule grace period retry
    const graceTime = new Date(Date.now() + AUTH_FAILURE_GRACE_HOURS * 3600_000);
    try {
      await scheduler.send(new CreateScheduleCommand({
        Name: `block-auth-grace-${reqId}`,
        ScheduleExpression: `at(${graceTime.toISOString().replace(/\.\d{3}Z$/, '')})`,
        FlexibleTimeWindow: { Mode: 'OFF' },
        Target: {
          Arn: AUTH_LAMBDA_ARN,
          RoleArn: SCHEDULER_ROLE_ARN,
          Input: JSON.stringify({ reqId }),
        },
      }));
    } catch (schedErr: any) {
      log.error('failed to schedule grace retry', schedErr);
    }
  }
};
