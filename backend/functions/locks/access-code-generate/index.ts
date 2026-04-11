import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getLockProvider } from '../../../shared/lock/LockProvider';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

interface EventDetail {
  bookingId: string;
  listingId?: string;
}

export const handler = async (event: { detail: EventDetail }) => {
  const { bookingId } = event.detail;

  // Get booking
  const booking = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
  }));
  if (!booking.Item) return;

  const listingId = booking.Item.listingId;

  // Check if listing has a lock
  const lock = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `LISTING#${listingId}`, SK: 'LOCK' },
  }));
  if (!lock.Item || lock.Item.status !== 'CONNECTED') return; // No lock — nothing to do

  try {
    const provider = getLockProvider(lock.Item.provider);
    const { code, codeId } = await provider.generateCode({
      lockId: lock.Item.lockId,
      validFrom: new Date(booking.Item.startTime),
      validUntil: new Date(booking.Item.endTime),
      bookingId,
    });

    // Store access code
    const now = new Date().toISOString();
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `BOOKING#${bookingId}`, SK: 'ACCESS_CODE',
        code, codeId, lockId: lock.Item.lockId, provider: lock.Item.provider,
        validFrom: booking.Item.startTime, validUntil: booking.Item.endTime,
        deliveredAt: now, revokedAt: null,
      },
    }));

    // Deliver via chat message
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `CHAT#${bookingId}`,
        SK: `MSG#${now}#ACCESS_CODE`,
        messageId: `access-code-${bookingId}`,
        bookingId, senderId: 'SYSTEM', senderRole: 'SYSTEM',
        type: 'ACCESS_CODE', code,
        validFrom: booking.Item.startTime, validUntil: booking.Item.endTime,
        text: `Your access code for this booking is: ${code}. Valid from ${booking.Item.startTime} to ${booking.Item.endTime}.`,
        sentAt: now, isRead: false,
      },
    }));

    console.log(`Access code generated for booking ${bookingId}: ${code}`);
  } catch (err) {
    console.error(`Failed to generate access code for booking ${bookingId}:`, err);
    // Will be retried by EventBridge
  }
};
