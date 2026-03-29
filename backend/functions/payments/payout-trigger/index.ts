import { EventBridgeHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import Stripe from 'stripe';
import { bookingMetadataKey } from '../../../shared/db/keys';
import { getStripeSecretKey } from '../shared/stripe-helpers';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const _eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

type PayloadDetail = {
  bookingId?: string;
  refundAmount?: number;
};

export const handler: EventBridgeHandler<string, PayloadDetail, void> = async (event) => {
  const log = createLogger('payout-trigger', event.id);
  const { bookingId, refundAmount } = event.detail as { bookingId: string; refundAmount?: number };
  const detailType = event['detail-type'];

  log.info('event received', { detailType, bookingId });

  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(bookingId) }));
  if (!result.Item) { log.warn('booking not found', { bookingId }); return; }
  const booking = result.Item;

  const stripeKey = await getStripeSecretKey();
  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });
  const now = new Date().toISOString();

  if (detailType === 'booking.completed') {
    if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') return;

    try {
      await stripe.paymentIntents.capture(booking.stripePaymentIntentId);
      log.info('payout captured', { bookingId });
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: bookingMetadataKey(bookingId),
        UpdateExpression: 'SET #status = :s, completedAt = :now, payoutStatus = :ps, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':s': 'COMPLETED', ':now': now, ':ps': 'PROCESSING' },
      }));
    } catch (err) {
      log.error('payout capture failed', err, { bookingId });
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: bookingMetadataKey(bookingId),
        UpdateExpression: 'SET payoutStatus = :ps, updatedAt = :now',
        ExpressionAttributeValues: { ':ps': 'FAILED', ':now': now },
      }));
    }
    return;
  }

  if (detailType === 'booking.cancelled') {
    if (!booking.stripePaymentIntentId) return;
    if (!refundAmount || refundAmount === 0) return;

    if (booking.status === 'PENDING_PAYMENT') {
      await stripe.paymentIntents.cancel(booking.stripePaymentIntentId);
    } else {
      await stripe.refunds.create({
        payment_intent: booking.stripePaymentIntentId,
        amount: Math.round(refundAmount * 100),
        metadata: { bookingId },
      });
    }

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: bookingMetadataKey(bookingId),
      UpdateExpression: 'SET refundStatus = :rs, updatedAt = :now',
      ExpressionAttributeValues: { ':rs': 'PENDING', ':now': now },
    }));
  }
};
