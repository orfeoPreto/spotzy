import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ok, badRequest, notFound } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const EVENT_BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

const round2 = (n: number) => Math.round(n * 100) / 100;

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('agent-booking-cancel', event.requestContext.requestId);
  const userId = event.requestContext.authorizer?.userId
    ?? event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  const bookingId = event.pathParameters?.bookingId ?? event.pathParameters?.id;
  if (!bookingId) return badRequest('bookingId is required');

  const result = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
  }));

  const booking = result.Item;
  if (!booking) return notFound();
  if (booking.spotterId !== userId) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'FORBIDDEN' }) };
  }

  if (booking.status === 'ACTIVE') {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'BOOKING_ACTIVE_NO_CANCEL' }) };
  }

  if (['CANCELLED', 'COMPLETED'].includes(booking.status)) {
    return { statusCode: 409, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'BOOKING_ALREADY_ENDED' }) };
  }

  const totalEur = booking.totalEur ?? 0;
  const hoursUntilStart = (new Date(booking.startTime).getTime() - Date.now()) / 3_600_000;
  let policy: string, refundPercent: number;
  if (hoursUntilStart > 24) { policy = 'FULL_REFUND'; refundPercent = 100; }
  else if (hoursUntilStart > 12) { policy = 'PARTIAL_REFUND'; refundPercent = 50; }
  else { policy = 'NO_REFUND'; refundPercent = 0; }
  const refundEur = round2(totalEur * refundPercent / 100);

  // Update booking status
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
    UpdateExpression: 'SET #s = :cancelled, updatedAt = :now, cancelledAt = :now, refundEur = :refund, refundPolicy = :policy',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':cancelled': 'CANCELLED',
      ':now': new Date().toISOString(),
      ':refund': refundEur,
      ':policy': policy,
    },
  }));

  // Release availability block
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { PK: `LISTING#${booking.listingId}`, SK: `AVAIL_BLOCK#${bookingId}` },
    }));
  } catch { /* ignore */ }

  // Publish event
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: EVENT_BUS,
      Source: 'spotzy.agent',
      DetailType: 'booking.cancelled',
      Detail: JSON.stringify({ bookingId, listingId: booking.listingId, refundEur, policy }),
    }],
  }));

  log.info('agent booking cancelled', { bookingId, refundEur, policy });
  return ok({
    bookingId, status: 'CANCELLED', refundEur, refundPercent, policy,
    refundEstimatedArrival: '5-10 business days',
  });
};
