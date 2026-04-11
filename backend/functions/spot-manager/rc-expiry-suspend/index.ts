import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SchedulerClient, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const scheduler = new SchedulerClient({});
const ses = new SESClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const FROM = process.env.SES_FROM_EMAIL ?? 'noreply@spotzy.com';
const APP_URL = process.env.APP_URL ?? 'https://spotzy.com';

interface RcExpiryEvent {
  submissionId: string;
  userId: string;
}

export const handler = async (event: RcExpiryEvent): Promise<void> => {
  const { submissionId, userId } = event;
  const log = createLogger('rc-expiry-suspend', submissionId, userId);
  const now = new Date().toISOString();

  log.info('processing RC expiry suspension', { submissionId, userId });

  // Load submission
  const submissionResult = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USER#${userId}`, SK: `RCSUBMISSION#${submissionId}` },
  }));
  const submission = submissionResult.Item;

  if (!submission) {
    log.warn('submission not found', { submissionId });
    return;
  }

  // If submission is not APPROVED (already renewed / superseded), clean up and return
  if (submission.status !== 'APPROVED') {
    log.info('submission not APPROVED, already renewed', { status: submission.status });

    try {
      await scheduler.send(new DeleteScheduleCommand({
        Name: `rc-expiry-suspend-${submissionId}`,
      }));
      log.info('deleted scheduler rule');
    } catch (err) {
      log.warn('failed to delete scheduler rule', { error: String(err) });
    }

    return;
  }

  // Load profile
  const profileResult = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
  }));
  const profile = profileResult.Item;

  if (!profile) {
    log.warn('profile not found', { userId });
    return;
  }

  // Query user's pool listings with isPool=true AND blockReservationsOptedIn=true
  // These are listings under HOST#{userId} in GSI1
  const listingsResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :hostPk AND begins_with(GSI1SK, :listingPrefix)',
    FilterExpression: 'isPool = :isPool AND blockReservationsOptedIn = :opted',
    ExpressionAttributeValues: {
      ':hostPk': `HOST#${userId}`,
      ':listingPrefix': 'LISTING#',
      ':isPool': true,
      ':opted': true,
    },
  }));

  const affectedListingIds = (listingsResult.Items ?? []).map(
    (item) => item.listingId as string,
  );

  log.info('affected listings', { count: affectedListingIds.length, affectedListingIds });

  // TransactWriteItems: update profile + write suspend log
  // Do NOT touch any BLOCKALLOC# records (existing contracts preserved)
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: TABLE,
          Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
          UpdateExpression: 'SET blockReservationCapable = :false, rcInsuranceStatus = :expired, updatedAt = :now',
          ExpressionAttributeValues: {
            ':false': false,
            ':expired': 'EXPIRED',
            ':now': now,
          },
        },
      },
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: `USER#${userId}`,
            SK: `RCSUSPEND#${submissionId}`,
            submissionId,
            suspendedAt: now,
            reason: 'EXPIRED',
            affectedListingIds,
            createdAt: now,
          },
        },
      },
    ],
  }));

  log.info('profile updated and suspend log written');

  // Send suspension email
  if (profile.email) {
    const html = `<h2>RC Insurance Expired — Block Reservations Suspended</h2>
<p>Your RC insurance has expired as of today. As a result, your block reservation capability has been suspended.</p>
<p><strong>What this means:</strong></p>
<ul>
  <li>You can no longer accept new block reservations</li>
  <li>Existing block reservation contracts remain active and will be honoured</li>
  <li>${affectedListingIds.length > 0 ? `${affectedListingIds.length} listing(s) are affected` : 'No listings are currently affected'}</li>
</ul>
<p>To restore your block reservation capability, please upload a valid RC insurance document.</p>
<p><a href="${APP_URL}/profile?tab=spot-manager">Upload new RC insurance</a></p>`;

    await ses.send(new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [profile.email] },
      Message: {
        Subject: { Data: 'RC Insurance Expired — Block Reservations Suspended', Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    }));
    log.info('suspension email sent');
  }

  // Clean up the scheduler rule
  try {
    await scheduler.send(new DeleteScheduleCommand({
      Name: `rc-expiry-suspend-${submissionId}`,
    }));
    log.info('deleted scheduler rule');
  } catch (err) {
    log.warn('failed to delete scheduler rule', { error: String(err) });
  }

  log.info('RC expiry suspension complete');
};
