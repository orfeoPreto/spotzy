import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SchedulerClient, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const scheduler = new SchedulerClient({});
const ses = new SESClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const FROM = process.env.SES_FROM_EMAIL ?? 'noreply@spotzy.be';
const APP_URL = process.env.APP_URL ?? 'https://spotzy.be';

interface RcExpiryEvent {
  submissionId: string;
  userId: string;
}

export const handler = async (event: RcExpiryEvent): Promise<void> => {
  const { submissionId, userId } = event;
  const log = createLogger('rc-expiry-reminder-7d', submissionId, userId);
  const now = new Date().toISOString();

  log.info('processing 7-day RC expiry reminder', { submissionId, userId });

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
        SK: `RCREMINDER#${submissionId}#7_DAY_REMINDER`,
        submissionId,
        type: '7_DAY_REMINDER',
        sentAt: null,
        channel: 'BOTH',
        skipReason: submission.status,
        createdAt: now,
      },
    }));

    try {
      await scheduler.send(new DeleteScheduleCommand({
        Name: `rc-expiry-reminder-7d-${submissionId}`,
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
    Key: { PK: `USER#${userId}`, SK: `RCREMINDER#${submissionId}#7_DAY_REMINDER` },
  }));

  if (existingReminder.Item) {
    log.info('reminder already sent, idempotent no-op', { submissionId });
    return;
  }

  // Send email via SES (more urgent tone)
  const expiryDate = submission.expiryDate ?? 'unknown';
  const html = `<h2>Urgent: RC Insurance Expiring Soon</h2>
<p>Your RC insurance document expires on <strong>${expiryDate}</strong> — that's only <strong>7 days away</strong>.</p>
<p>If your RC insurance expires, your block reservation capability will be suspended and you will no longer be able to accept new block reservations.</p>
<p>Please upload a renewed document as soon as possible to avoid any interruption.</p>
<p><a href="${APP_URL}/profile?tab=spot-manager">Renew your RC insurance now</a></p>`;

  if (profile.email) {
    await ses.send(new SendEmailCommand({
      Source: FROM,
      Destination: { ToAddresses: [profile.email] },
      Message: {
        Subject: { Data: 'Urgent: Your RC insurance expires in 7 days', Charset: 'UTF-8' },
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
      SK: `RCREMINDER#${submissionId}#7_DAY_REMINDER`,
      submissionId,
      type: '7_DAY_REMINDER',
      sentAt: now,
      channel: 'BOTH',
      skipReason: null,
      createdAt: now,
    },
  }));

  log.info('7-day reminder complete');
};
