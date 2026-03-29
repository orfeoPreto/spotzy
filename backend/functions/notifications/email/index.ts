import { EventBridgeHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { userProfileKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const FROM = 'noreply@spotzy.com';
const APP_URL = process.env.APP_URL ?? 'https://spotzy.com';

const sendEmail = async (toUserId: string, subject: string, html: string): Promise<void> => {
  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(toUserId) }));
  const user = result.Item;
  if (!user?.email) { console.warn(`User ${toUserId} has no email, skipping`); return; }
  await ses.send(new SendEmailCommand({
    Source: FROM,
    Destination: { ToAddresses: [user.email] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
  }));
};

type Detail = Record<string, unknown>;

export const handler: EventBridgeHandler<string, Detail, void> = async (event) => {
  const log = createLogger('notification-email', event.id);
  const dt = event['detail-type'];
  const d = event.detail;

  log.info('email notification event', { detailType: dt });

  try {
    if (dt === 'booking.created') {
      const html = `<h2>New Booking</h2><p>Address: ${d.listingAddress}</p><p>From: ${d.startTime} to ${d.endTime}</p><p>Total: €${d.totalPrice}</p>`;
      await sendEmail(d.hostId as string, `New booking at ${d.listingAddress}`, html);
    } else if (dt === 'booking.completed') {
      const html = `<h2>Booking Completed</h2><p>Please leave a review: <a href="${APP_URL}/review/${d.bookingId}">Rate your experience</a></p>`;
      await Promise.all([
        sendEmail(d.hostId as string, `Booking completed at ${d.listingAddress}`, html),
        sendEmail(d.spotterId as string, `Booking completed at ${d.listingAddress}`, html),
      ]);
    } else if (dt === 'booking.cancelled') {
      const html = `<h2>Booking Cancelled</h2><p>Address: ${d.listingAddress}</p><p>Refund: €${d.refundAmount ?? 0}</p>`;
      await sendEmail(d.hostId as string, `Booking cancelled at ${d.listingAddress}`, html);
    }
  } catch (err) {
    log.error('email notification error', err as Error, { detailType: dt });
  }
};
