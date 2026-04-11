import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SchedulerClient, CreateScheduleCommand } from '@aws-sdk/client-scheduler';
import Stripe from 'stripe';
import { createLogger } from '../../../shared/utils/logger';
import { AUTH_FAILURE_GRACE_HOURS } from '../../../shared/block-reservations/constants';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const scheduler = new SchedulerClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN ?? '';
const AUTH_LAMBDA_ARN = process.env.AUTH_LAMBDA_ARN ?? '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';

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

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('block-payment-webhook', event.requestContext?.requestId ?? 'unknown');

  // Verify Stripe signature
  const signature = event.headers['Stripe-Signature'] ?? event.headers['stripe-signature'] ?? '';
  const rawBody = event.body ?? '';

  const stripeKey = await getStripeKey();
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' as any });

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    log.warn('webhook signature verification failed', { error: err.message });
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid signature' }) };
  }

  log.info('webhook received', { type: stripeEvent.type, id: stripeEvent.id });
  const now = new Date().toISOString();

  // Handle payment_intent events
  if (stripeEvent.type === 'payment_intent.payment_failed') {
    const pi = stripeEvent.data.object as Stripe.PaymentIntent;
    const reqId = pi.metadata?.reqId;
    if (!reqId) {
      log.info('ignoring payment_failed — no reqId in metadata');
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ received: true }) };
    }

    log.warn('payment failed', { reqId, paymentIntentId: pi.id });

    // Load the block request
    const reqResult = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
    }));
    const blockReq = reqResult.Item;

    if (blockReq && blockReq.status === 'CONFIRMED') {
      // Schedule 24h grace period retry
      const retryCount = blockReq.authorisationRetryCount ?? 0;
      const retryTime = new Date(Date.now() + AUTH_FAILURE_GRACE_HOURS * 3600_000);

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
        UpdateExpression: 'SET authorisationRetryCount = :c, updatedAt = :now, auditLog = list_append(if_not_exists(auditLog, :empty), :entry)',
        ExpressionAttributeValues: {
          ':c': retryCount + 1,
          ':now': now,
          ':empty': [],
          ':entry': [{
            timestamp: now,
            actorUserId: 'SYSTEM',
            action: 'PAYMENT_FAILED_GRACE',
            before: { authorisationRetryCount: retryCount },
            after: { authorisationRetryCount: retryCount + 1 },
          }],
        },
      }));

      try {
        await scheduler.send(new CreateScheduleCommand({
          Name: `block-auth-retry-${reqId}-${retryCount + 1}`,
          ScheduleExpression: `at(${retryTime.toISOString().replace(/\.\d{3}Z$/, '')})`,
          FlexibleTimeWindow: { Mode: 'OFF' },
          Target: {
            Arn: AUTH_LAMBDA_ARN,
            RoleArn: SCHEDULER_ROLE_ARN,
            Input: JSON.stringify({ reqId }),
          },
        }));
        log.info('grace period retry scheduled', { reqId, retryAt: retryTime.toISOString() });
      } catch (err) {
        log.error('failed to schedule retry', err);
      }
    }
  }

  if (stripeEvent.type === 'payment_intent.succeeded') {
    const pi = stripeEvent.data.object as Stripe.PaymentIntent;
    const reqId = pi.metadata?.reqId;
    if (!reqId) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ received: true }) };
    }

    log.info('payment succeeded', { reqId, paymentIntentId: pi.id });

    // Verify the block request exists and update if needed
    const reqResult = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
    }));
    const blockReq = reqResult.Item;

    if (blockReq) {
      const auditEntry = {
        timestamp: now,
        actorUserId: 'SYSTEM',
        action: 'PAYMENT_SUCCEEDED',
        before: {},
        after: { paymentIntentId: pi.id, amountCents: pi.amount },
      };

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
        UpdateExpression: 'SET auditLog = list_append(if_not_exists(auditLog, :empty), :entry), updatedAt = :now',
        ExpressionAttributeValues: {
          ':entry': [auditEntry],
          ':empty': [],
          ':now': now,
        },
      }));
    }
  }

  // Handle charge.dispute.created
  if (stripeEvent.type === 'charge.dispute.created') {
    const dispute = stripeEvent.data.object as Stripe.Dispute;
    const chargeId = dispute.charge as string;
    log.warn('dispute created', { chargeId, disputeId: dispute.id, reason: dispute.reason });

    // Find the block request by searching for the charge
    // The charge metadata should contain the reqId
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      const reqId = charge.metadata?.reqId;

      if (reqId) {
        const auditEntry = {
          timestamp: now,
          actorUserId: 'SYSTEM',
          action: 'DISPUTE_CREATED',
          before: {},
          after: { disputeId: dispute.id, reason: dispute.reason, chargeId },
        };

        await ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
          UpdateExpression: 'SET disputeId = :did, auditLog = list_append(if_not_exists(auditLog, :empty), :entry), updatedAt = :now',
          ExpressionAttributeValues: {
            ':did': dispute.id,
            ':entry': [auditEntry],
            ':empty': [],
            ':now': now,
          },
        }));
      }
    } catch (err) {
      log.error('failed to process dispute', err);
    }
  }

  // Handle transfer events
  if (stripeEvent.type === 'transfer.created' || (stripeEvent.type as string) === 'transfer.failed') {
    const transfer = stripeEvent.data.object as Stripe.Transfer;
    const reqId = transfer.metadata?.reqId;
    const allocId = transfer.metadata?.allocId;

    if (reqId && allocId) {
      const transferStatus = stripeEvent.type === 'transfer.created' ? 'CREATED' : 'FAILED';
      log.info('transfer event', { reqId, allocId, transferId: transfer.id, status: transferStatus });

      // Update the BLOCKALLOC# settlement
      try {
        const allocResult = await ddb.send(new GetCommand({
          TableName: TABLE,
          Key: { PK: `BLOCKREQ#${reqId}`, SK: `BLOCKALLOC#${allocId}` },
        }));

        if (allocResult.Item?.settlement) {
          const settlement = allocResult.Item.settlement;
          settlement.transferStatus = transferStatus;
          settlement.transferId = transfer.id;

          await ddb.send(new UpdateCommand({
            TableName: TABLE,
            Key: { PK: `BLOCKREQ#${reqId}`, SK: `BLOCKALLOC#${allocId}` },
            UpdateExpression: 'SET settlement = :s, updatedAt = :now',
            ExpressionAttributeValues: { ':s': settlement, ':now': now },
          }));
        }
      } catch (err) {
        log.error('failed to update transfer status', err);
      }
    }
  }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ received: true }) };
};
