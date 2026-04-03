import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SchedulerClient, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound } from '../../../shared/utils/response';
import { bookingMetadataKey } from '../../../shared/db/keys';
import { calculateRefund } from '../shared/refund-calculator';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const scheduler = new SchedulerClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

const forbidden = () => ({ statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) });

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('booking-cancel', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const bookingId = event.pathParameters?.id;
  if (!bookingId) return notFound();

  log.info('cancel attempt', { bookingId });

  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(bookingId) }));
  if (!result.Item) return notFound();

  const booking = result.Item;

  if (booking.status === 'ACTIVE') return { statusCode: 409, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'BOOKING_ALREADY_ACTIVE', message: 'Cannot cancel an active booking' }) };
  if (booking.status === 'COMPLETED') return badRequest(JSON.stringify({ code: 'CANNOT_CANCEL_COMPLETED', message: 'Cannot cancel a completed booking' }));
  if (booking.status === 'CANCELLED') return badRequest(JSON.stringify({ code: 'ALREADY_CANCELLED', message: 'Booking is already cancelled' }));

  const isSpotter = claims.userId === booking.spotterId;
  const isHost = claims.userId === booking.hostId;
  if (!isSpotter && !isHost) return forbidden();

  const cancelledBy = isHost ? 'host' : 'spotter';
  const { refundPercent, refundAmount } = calculateRefund(
    booking.totalPrice,
    booking.startTime,
    booking.cancellationPolicy,
    cancelledBy,
  );

  const now = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: bookingMetadataKey(bookingId),
    UpdateExpression: 'SET #status = :s, cancelledBy = :cb, refundAmount = :ra, refundPercent = :rp, cancelledAt = :now, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':s': 'CANCELLED',
      ':cb': cancelledBy,
      ':ra': refundAmount,
      ':rp': refundPercent,
      ':now': now,
    },
  }));

  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS,
      Source: 'spotzy',
      DetailType: 'booking.cancelled',
      Detail: JSON.stringify({ bookingId, listingId: booking.listingId, spotterId: booking.spotterId, hostId: booking.hostId, cancelledBy, refundAmount, refundPercent, listingAddress: booking.listingAddress, startTime: booking.startTime, endTime: booking.endTime }),
    }],
  }));

  // Delete Scheduler schedules (best-effort)
  try {
    await Promise.all([
      scheduler.send(new DeleteScheduleCommand({ Name: `booking-active-${bookingId}` })),
      scheduler.send(new DeleteScheduleCommand({ Name: `booking-completed-${bookingId}` })),
    ]);
  } catch {
    // Schedules may not exist or already deleted
  }

  log.info('booking cancelled', { bookingId, cancelledBy, refundAmount, refundPercent });
  return ok({ bookingId, status: 'CANCELLED', cancelledBy, refundAmount, refundPercent });
};
