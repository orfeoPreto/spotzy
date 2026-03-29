import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import Stripe from 'stripe';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, internalError } from '../../../shared/utils/response';
import { bookingMetadataKey, userProfileKey } from '../../../shared/db/keys';
import { toStripeAmount, calculatePlatformFee, getStripeSecretKey } from '../shared/stripe-helpers';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const forbidden = () => ({ statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) });

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('payment-intent', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const body = JSON.parse(event.body ?? '{}');
  const { bookingId } = body;
  if (!bookingId) return badRequest('bookingId is required');

  log.info('payment intent attempt', { bookingId });

  const bookingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(bookingId) }));
  if (!bookingResult.Item) return notFound();
  const booking = bookingResult.Item;

  if (claims.userId !== booking.spotterId) return forbidden();

  if (booking.status === 'CONFIRMED') return badRequest(JSON.stringify({ code: 'PAYMENT_ALREADY_PROCESSED', message: 'Payment has already been processed' }));
  if (booking.status !== 'PENDING_PAYMENT') return badRequest(JSON.stringify({ code: 'INVALID_BOOKING_STATUS', message: `Cannot create payment for booking in status: ${booking.status}` }));

  const hostResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(booking.hostId) }));
  const host = hostResult.Item;

  const totalCents = toStripeAmount(booking.totalPrice);
  const feeCents = calculatePlatformFee(totalCents);

  try {
    const stripeKey = await getStripeSecretKey();
    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' });

    const hostConnectId = host?.stripeConnectAccountId;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'eur',
      capture_method: 'automatic',
      ...(hostConnectId ? {
        application_fee_amount: feeCents,
        transfer_data: { destination: hostConnectId },
      } : {}),
      metadata: {
        bookingId: booking.bookingId,
        spotterId: booking.spotterId,
        listingId: booking.listingId,
      },
    });

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
