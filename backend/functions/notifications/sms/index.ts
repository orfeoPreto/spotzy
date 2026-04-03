import { EventBridgeHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { userProfileKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sns = new SNSClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const truncate = (msg: string, max = 160): string => msg.length <= max ? msg : msg.slice(0, max - 1) + '…';

const sendSms = async (userId: string, message: string): Promise<void> => {
  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(userId) }));
  const user = result.Item;
  if (!user?.phone) { console.warn(`User ${userId} has no phone, skipping SMS`); return; }
  await sns.send(new PublishCommand({ PhoneNumber: user.phone, Message: truncate(message) }));
};

type Detail = Record<string, unknown>;

export const handler: EventBridgeHandler<string, Detail, void> = async (event) => {
  const log = createLogger('notification-sms', event.id);
  const dt = event['detail-type'];
  const d = event.detail;

  log.info('sms notification event', { detailType: dt });

  try {
    if (dt === 'booking.confirmed') {
      await Promise.all([
        sendSms(d.hostId as string, `New booking at ${d.listingAddress}: ${new Date(d.startTime as string).toLocaleDateString()} - €${d.totalPrice}`),
        sendSms(d.spotterId as string, `Your booking at ${d.listingAddress} is confirmed: ${new Date(d.startTime as string).toLocaleDateString()} - €${d.totalPrice}`),
      ]);

    } else if (dt === 'booking.modified') {
      const msg = `Booking at ${d.listingAddress} modified. New time: ${new Date(d.newStartTime as string).toLocaleDateString()}`;
      await Promise.all([
        sendSms(d.hostId as string, msg),
        sendSms(d.spotterId as string, msg),
      ]);

    } else if (dt === 'booking.cancelled') {
      const msg = `Booking at ${d.listingAddress} cancelled. Refund: €${d.refundAmount ?? 0}`;
      await Promise.all([sendSms(d.hostId as string, msg), sendSms(d.spotterId as string, msg)]);

    } else if (dt === 'booking.completed') {
      const msg = `Booking at ${d.listingAddress} completed. Leave a review on Spotzy!`;
      await Promise.all([sendSms(d.hostId as string, msg), sendSms(d.spotterId as string, msg)]);

    } else if (dt === 'listing.published') {
      await sendSms(d.hostId as string, `Your listing at ${d.listingAddress} is now live on Spotzy!`);

    } else if (dt === 'review.created') {
      await sendSms(d.reviewedUserId as string, `New review (${d.avgScore}/5) for your booking at ${d.listingAddress}`);

    } else if (dt === 'dispute.created') {
      await sendSms(d.hostId as string, `Dispute opened for ${d.listingAddress}. Please respond within 24h.`);

    } else if (dt === 'dispute.escalated') {
      const msg = `Dispute for ${d.listingAddress} has been escalated for review.`;
      await Promise.all([sendSms(d.hostId as string, msg), sendSms(d.spotterId as string, msg)]);
    }
  } catch (err) {
    log.error('sms notification error', err as Error, { detailType: dt });
  }
};
