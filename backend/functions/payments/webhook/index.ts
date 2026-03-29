import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import Stripe from 'stripe';
import { ok, badRequest } from '../../../shared/utils/response';
import { bookingMetadataKey } from '../../../shared/db/keys';
import { getStripeSecretKey } from '../shared/stripe-helpers';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

let _webhookSecret: string | undefined;
const getWebhookSecret = async (): Promise<string> => {
  if (_webhookSecret) return _webhookSecret;
  if (process.env.STRIPE_WEBHOOK_SECRET) return process.env.STRIPE_WEBHOOK_SECRET;
  const sm = new SecretsManagerClient({});
  const res = await sm.send(new GetSecretValueCommand({ SecretId: 'spotzy/stripe/webhook-secret' }));
  _webhookSecret = res.SecretString!;
  return _webhookSecret;
};

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('payment-webhook', event.requestContext.requestId);

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!sig) { log.warn('missing stripe-signature'); return badRequest('Missing stripe-signature header'); }

  let stripeEvent: Stripe.Event;
  try {
    const [stripeKey, webhookSecret] = await Promise.all([getStripeSecretKey(), getWebhookSecret()]);
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
    stripeEvent = stripe.webhooks.constructEvent(event.body ?? '', sig, webhookSecret) as Stripe.Event;
  } catch {
    log.warn('invalid stripe signature');
    return badRequest('Invalid Stripe signature');
  }

  log.info('stripe event received', { type: stripeEvent.type, id: stripeEvent.id });
  const now = new Date().toISOString();

  switch (stripeEvent.type) {
    case 'payment_intent.succeeded': {
      const pi = stripeEvent.data.object as Stripe.PaymentIntent;
      const bookingId = pi.metadata?.bookingId;
      if (!bookingId) return ok({ received: true });

      const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(bookingId) }));
      const booking = result.Item;
      if (!booking || booking.status === 'CONFIRMED') return ok({ received: true }); // idempotent

      const chargeId = (pi as unknown as { charges?: { data?: Array<{ id: string }> } }).charges?.data?.[0]?.id ?? '';
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: bookingMetadataKey(bookingId),
        UpdateExpression: 'SET #status = :s, paidAt = :now, stripeChargeId = :cid, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':s': 'CONFIRMED', ':now': now, ':cid': chargeId },
      }));
      break;
    }

    case 'payment_intent.payment_failed': {
      const pi = stripeEvent.data.object as Stripe.PaymentIntent;
      const bookingId = pi.metadata?.bookingId;
      if (!bookingId) return ok({ received: true });

      const failureReason = (pi as unknown as { last_payment_error?: { message?: string } }).last_payment_error?.message ?? 'unknown';
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: bookingMetadataKey(bookingId),
        UpdateExpression: 'SET #status = :s, paymentFailureReason = :r, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':s': 'PAYMENT_FAILED', ':r': failureReason, ':now': now },
      }));
      break;
    }

    case 'refund.created': {
      const refund = stripeEvent.data.object as Stripe.Refund & { metadata?: { bookingId?: string } };
      const bookingId = refund.metadata?.bookingId;
      if (!bookingId) return ok({ received: true });

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: bookingMetadataKey(bookingId),
        UpdateExpression: 'SET refundStatus = :rs, refundedAt = :now, refundedAmount = :ra, updatedAt = :now',
        ExpressionAttributeValues: { ':rs': 'PROCESSED', ':now': now, ':ra': refund.amount },
      }));
      break;
    }

    default:
      // Unknown event type — return 200 to prevent Stripe retries
      break;
  }

  return ok({ received: true });
};
