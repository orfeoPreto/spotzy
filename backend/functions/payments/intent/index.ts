import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import Stripe from 'stripe';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, internalError, forbidden } from '../../../shared/utils/response';
import { bookingMetadataKey, userProfileKey } from '../../../shared/db/keys';
import { toStripeAmount, calculatePlatformFee, getStripeSecretKey } from '../shared/stripe-helpers';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';


export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('payment-intent', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const body = JSON.parse(event.body ?? '{}');
  const { bookingId } = body;
  if (!bookingId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'bookingId' });

  log.info('payment intent attempt', { bookingId });

  const bookingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(bookingId) }));
  if (!bookingResult.Item) return notFound();
  const booking = bookingResult.Item;

  if (claims.userId !== booking.spotterId) return forbidden();

  if (booking.status === 'CONFIRMED') return badRequest('PAYMENT_ALREADY_PROCESSED');
  if (booking.status !== 'PENDING_PAYMENT') return badRequest('INVALID_BOOKING_STATUS', { status: booking.status });

  const hostResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(booking.hostId) }));
  const host = hostResult.Item;

  const totalCents = toStripeAmount(booking.totalPrice);
  const feeCents = calculatePlatformFee(totalCents);

  try {
    const stripeKey = await getStripeSecretKey();
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    const hostConnectId = host?.stripeConnectAccountId;
    const baseParams: Stripe.PaymentIntentCreateParams = {
      amount: totalCents,
      currency: 'eur',
      capture_method: 'automatic',
      metadata: {
        bookingId: booking.bookingId,
        spotterId: booking.spotterId,
        listingId: booking.listingId,
      },
    };

    let paymentIntent: Stripe.PaymentIntent;
    if (hostConnectId) {
      try {
        paymentIntent = await stripe.paymentIntents.create({
          ...baseParams,
          application_fee_amount: feeCents,
          transfer_data: { destination: hostConnectId },
        });
      } catch (transferErr) {
        // Host account not ready for transfers — collect on platform, settle later
        log.warn('host transfer failed, collecting on platform', { hostConnectId, error: (transferErr as Error).message });
        paymentIntent = await stripe.paymentIntents.create(baseParams);
      }
    } else {
      paymentIntent = await stripe.paymentIntents.create(baseParams);
    }

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: bookingMetadataKey(bookingId),
      UpdateExpression: 'SET stripePaymentIntentId = :pid, updatedAt = :now',
      ExpressionAttributeValues: { ':pid': paymentIntent.id, ':now': new Date().toISOString() },
    }));

    log.info('payment intent created', { bookingId, paymentIntentId: paymentIntent.id, amount: totalCents });
    return ok({ clientSecret: paymentIntent.client_secret, amount: totalCents });
  } catch (err) {
    log.error('stripe error', err);
    return internalError();
  }
};
