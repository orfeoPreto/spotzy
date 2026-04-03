import { EventBridgeHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { userProfileKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const FROM = process.env.SES_FROM_EMAIL ?? 'noreply@spotzy.com';
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
    if (dt === 'booking.confirmed') {
      const hostHtml = `<h2>New Booking</h2><p>Address: ${d.listingAddress}</p><p>From: ${d.startTime} to ${d.endTime}</p><p>Total: €${d.totalPrice}</p>`;
      const spotterHtml = `<h2>Booking Confirmed</h2><p>Your booking at ${d.listingAddress} has been confirmed.</p><p>From: ${d.startTime} to ${d.endTime}</p><p>Total: €${d.totalPrice}</p>`;
      await Promise.all([
        sendEmail(d.hostId as string, `New booking at ${d.listingAddress}`, hostHtml),
        sendEmail(d.spotterId as string, `Your booking at ${d.listingAddress} is confirmed`, spotterHtml),
      ]);

    } else if (dt === 'booking.modified') {
      const html = `<h2>Booking Modified</h2><p>Address: ${d.listingAddress}</p><p>New time: ${d.newStartTime} to ${d.newEndTime}</p><p>Price difference: €${d.priceDifference}</p>`;
      await Promise.all([
        sendEmail(d.hostId as string, `Booking modified at ${d.listingAddress}`, html),
        sendEmail(d.spotterId as string, `Booking modified at ${d.listingAddress}`, html),
      ]);

    } else if (dt === 'booking.cancelled') {
      const html = `<h2>Booking Cancelled</h2><p>Address: ${d.listingAddress}</p><p>Refund: €${d.refundAmount ?? 0}</p>`;
      await Promise.all([
        sendEmail(d.hostId as string, `Booking cancelled at ${d.listingAddress}`, html),
        sendEmail(d.spotterId as string, `Booking cancelled at ${d.listingAddress}`, html),
      ]);

    } else if (dt === 'booking.completed') {
      const html = `<h2>Booking Completed</h2><p>Your booking at ${d.listingAddress} is complete.</p><p>Please leave a review: <a href="${APP_URL}/review/${d.bookingId}">Rate your experience</a></p>`;
      await Promise.all([
        sendEmail(d.hostId as string, `Booking completed at ${d.listingAddress}`, html),
        sendEmail(d.spotterId as string, `Booking completed at ${d.listingAddress}`, html),
      ]);

    } else if (dt === 'listing.published') {
      const html = `<h2>Listing Published</h2><p>Your listing at ${d.listingAddress} is now live and visible to spotters.</p><p><a href="${APP_URL}/listings/${d.listingId}">View your listing</a></p>`;
      await sendEmail(d.hostId as string, `Your listing at ${d.listingAddress} is live`, html);

    } else if (dt === 'review.created') {
      const html = `<h2>New Review</h2><p>You received a new review (${d.avgScore}/5) for your booking at ${d.listingAddress}.</p><p><a href="${APP_URL}/bookings/${d.bookingId}">View details</a></p>`;
      await sendEmail(d.reviewedUserId as string, `New review for ${d.listingAddress}`, html);

    } else if (dt === 'dispute.created') {
      const html = `<h2>Dispute Opened</h2><p>A dispute has been opened for your booking at ${d.listingAddress}.</p><p>Please respond within 24 hours.</p><p><a href="${APP_URL}/disputes/${d.disputeId}">View dispute</a></p>`;
      await sendEmail(d.hostId as string, `Dispute opened for ${d.listingAddress}`, html);

    } else if (dt === 'dispute.escalated') {
      const html = `<h2>Dispute Escalated</h2><p>The dispute for your booking at ${d.listingAddress} has been escalated for admin review.</p>`;
      await Promise.all([
        sendEmail(d.hostId as string, `Dispute escalated for ${d.listingAddress}`, html),
        sendEmail(d.spotterId as string, `Dispute escalated for ${d.listingAddress}`, html),
      ]);
    }
  } catch (err) {
    log.error('email notification error', err as Error, { detailType: dt });
  }
};
