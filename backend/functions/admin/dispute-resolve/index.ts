import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import Stripe from 'stripe';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { forbidden } from '../../../shared/utils/admin-response';
import { ok, badRequest, notFound } from '../../../shared/utils/response';
import { disputeMetadataKey, bookingMetadataKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder');

export const handler: APIGatewayProxyHandler = async (event) => {
  const admin = extractAdminClaims(event);
  const log = createLogger('admin-dispute-resolve', event.requestContext.requestId, admin?.userId);
  if (!admin) return forbidden();

  const disputeId = event.pathParameters?.id;
  if (!disputeId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'disputeId' });

  const body = JSON.parse(event.body ?? '{}');
  const { outcome, refundAmount, adminNote } = body;
  if (!outcome) return badRequest('MISSING_REQUIRED_FIELD', { field: 'outcome' });

  // Fetch dispute
  const disputeResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: disputeMetadataKey(disputeId) }));
  if (!disputeResult.Item) return notFound();
  const dispute = disputeResult.Item;

  // Fetch booking for payment intent
  const bookingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(dispute.bookingId as string) }));
  const booking = bookingResult.Item;

  // Stripe refund if needed
  if (refundAmount > 0 && booking?.paymentIntentId) {
    await stripe.refunds.create({
      payment_intent: booking.paymentIntentId as string,
      amount: refundAmount,
    });
  }

  // Update dispute status
  const now = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: disputeMetadataKey(disputeId),
    UpdateExpression: 'SET #status = :status, outcome = :outcome, refundAmount = :refund, adminNote = :note, resolvedAt = :now, resolvedBy = :admin, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'RESOLVED',
      ':outcome': outcome,
      ':refund': refundAmount ?? 0,
      ':note': adminNote ?? null,
      ':now': now,
      ':admin': admin.userId,
    },
  }));

  // Emit event for notifications
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS, Source: 'spotzy', DetailType: 'dispute.resolved',
      Detail: JSON.stringify({
        disputeId,
        bookingId: dispute.bookingId,
        hostId: dispute.hostId,
        spotterId: dispute.spotterId,
        outcome,
        refundAmount: refundAmount ?? 0,
      }),
    }],
  }));

  log.info('dispute resolved', { disputeId, outcome, refundAmount });
  return ok({ disputeId, status: 'RESOLVED', outcome, resolvedAt: now });
};
