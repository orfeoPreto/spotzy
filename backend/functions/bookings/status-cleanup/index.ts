import { ScheduledHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

function toUtcMs(s: string): number {
  if (!s) return 0;
  return /[Zz]|[+-]\d{2}:\d{2}$/.test(s)
    ? new Date(s).getTime()
    : new Date(s + 'Z').getTime();
}

export const handler: ScheduledHandler = async () => {
  const log = createLogger('booking-status-cleanup', 'scheduled');
  const now = Date.now();
  const nowIso = new Date().toISOString();

  const result = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: '(#s = :confirmed OR #s = :active) AND begins_with(PK, :bp) AND SK = :md',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':confirmed': 'CONFIRMED', ':active': 'ACTIVE', ':bp': 'BOOKING#', ':md': 'METADATA' },
  }));

  const items = result.Items ?? [];
  let transitioned = 0;

  for (const item of items) {
    const endMs = toUtcMs(item.endTime as string);
    const startMs = toUtcMs(item.startTime as string);
    const status = item.status as string;
    let newStatus: string | null = null;

    if (endMs > 0 && endMs < now) {
      newStatus = 'COMPLETED';
    } else if (startMs > 0 && startMs < now && status === 'CONFIRMED') {
      newStatus = 'ACTIVE';
    }

    if (newStatus) {
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: item.PK, SK: item.SK },
        UpdateExpression: 'SET #s = :ns, updatedAt = :now' + (newStatus === 'COMPLETED' ? ', completedAt = :now' : ''),
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':ns': newStatus, ':now': nowIso },
      }));

      // Emit event for downstream processing (notifications, etc.)
      await eb.send(new PutEventsCommand({
        Entries: [{
          EventBusName: BUS,
          Source: 'spotzy',
          DetailType: newStatus === 'COMPLETED' ? 'booking.completed' : 'booking.started',
          Detail: JSON.stringify({
            bookingId: item.bookingId,
            listingId: item.listingId,
            hostId: item.hostId,
            spotterId: item.spotterId,
            listingAddress: item.listingAddress,
            startTime: item.startTime,
            endTime: item.endTime,
          }),
        }],
      }));

      log.info('status transitioned', { bookingId: item.bookingId, from: status, to: newStatus });
      transitioned++;
    }
  }

  log.info('cleanup complete', { scanned: items.length, transitioned });
};
