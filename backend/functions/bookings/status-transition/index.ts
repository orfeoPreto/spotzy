import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { bookingMetadataKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const EVENT_BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

interface StatusTransitionEvent {
  bookingId: string;
  targetStatus: 'ACTIVE' | 'COMPLETED';
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  CONFIRMED: ['ACTIVE'],
  ACTIVE: ['COMPLETED'],
};

export const handler: Handler<StatusTransitionEvent> = async (event) => {
  const { bookingId, targetStatus } = event;
  const log = createLogger('booking-status-transition', 'scheduler');

  log.info('status transition attempt', { bookingId, targetStatus });

  const result = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: bookingMetadataKey(bookingId),
  }));

  const booking = result.Item;
  if (!booking) { log.warn('booking not found', { bookingId }); return { statusCode: 404 }; }

  const currentStatus = booking.status as string;

  // Idempotent — already at target
  if (currentStatus === targetStatus) {
    log.info('already at target status', { bookingId, currentStatus });
    return { statusCode: 200 };
  }

  // Validate transition
  const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(targetStatus)) {
    log.warn('invalid transition', { bookingId, currentStatus, targetStatus });
    return { statusCode: 409 };
  }

  const now = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: bookingMetadataKey(bookingId),
    UpdateExpression: 'SET #status = :s, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':s': targetStatus, ':now': now },
  }));

  log.info('status updated', { bookingId, from: currentStatus, to: targetStatus });

  // Emit event on completion
  if (targetStatus === 'COMPLETED') {
    await eb.send(new PutEventsCommand({
      Entries: [{
        Source: 'spotzy',
        DetailType: 'booking.completed',
        EventBusName: EVENT_BUS,
        Detail: JSON.stringify({
          bookingId,
          listingId: booking.listingId,
          listingAddress: booking.listingAddress,
          spotterId: booking.spotterId,
          hostId: booking.hostId,
          totalPrice: booking.totalPrice,
        }),
      }],
    }));
    log.info('booking.completed event emitted', { bookingId });
  }

  return { statusCode: 200 };
};
