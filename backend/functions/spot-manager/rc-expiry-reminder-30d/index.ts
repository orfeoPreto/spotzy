import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
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
  const log = createLogger('rc-expiry-reminder-30d', submissionId, userId);
  const now = new Date().toISOString();

  log.info('processing 30-day RC expiry reminder', { submissionId, userId });

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

  // If submission is not APPROVED (e.g. SUPERSEDED), skip and clean up
  if (submission.status !== 'APPROVED') {
    log.info('submission not APPROVED, skipping', { status: submission.status });

    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `USER#${userId}`,
        SK: `RCREMINDER#${submissionId}#30_DAY_REMINDER`,
        submissionId,
        type: '30_DAY_REMINDER',
        sentAt: null,
        channel: 'BOTH',
        skipReason: submission.status,
        createdAt: now,
      },
    }));

    try {
      await scheduler.send(new DeleteScheduleCommand({
        Name: `rc-expiry-reminder-30d-${submissionId}`,
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

  if (!profile || profile.spotManagerStatus !== 'ACTIVE') {
    log.info('profile not found or spotManagerStatus not ACTIVE, skipping', {
      exists: !!profile,
      spotManagerStatus: profile?.spotManagerStatus,
    });
    return;
  }

  // Idempotency check: if reminder already sent, no-op
  const existingReminder = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USER#${userId}`, SK: `RCREMINDER#${submissionId}#30_DAY_REMINDER` },
  }));

  if (existingReminder.Item) {
    log.info('reminder already sent, idempotent no-op', { submissionId });
    return;
  }

  // Send email via SES
  const expiryDate = submission.expiryDate ?? 'unknown';
  const html = `<h2>RC Insurance Expiry Reminder</h2>
<p>Your RC insurance document is expiring on <strong>${expiryDate}</strong> (in approximately 30 days).</p>
<p>To keep your Spot Manager status active and continue receiving block reservations, please upload a renewed RC insurance document before the expiry date.</p>
<p><a href="${APP_URL}/profile?tab=spot-manager">Renew your RC insurance</a></p>`;

  if (profile.email) {
    await ses.send(new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [profile.email] },
      Message: {
        Subject: { Data: 'Your RC insurance expires in 30 days', Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    }));
    log.info('reminder email sent', { email: profile.email });
  }

  // Write reminder log
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `USER#${userId}`,
      SK: `RCREMINDER#${submissionId}#30_DAY_REMINDER`,
      submissionId,
      type: '30_DAY_REMINDER',
      sentAt: now,
      channel: 'BOTH',
      skipReason: null,
      createdAt: now,
    },
  }));

  log.info('30-day reminder complete');
};
