import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { forbidden } from '../../../shared/utils/admin-response';
import { ok, badRequest, notFound, conflict } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const scheduler = new SchedulerClient({});
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';
// CDK sets these in spot-manager-stack.ts. Fall back to legacy names for back-compat.
const SCHEDULER_ROLE_ARN = process.env.RC_SCHEDULER_ROLE_ARN ?? process.env.SCHEDULER_ROLE_ARN ?? '';
const RC_EXPIRY_30D_LAMBDA_ARN = process.env.RC_EXPIRY_30D_LAMBDA_ARN ?? process.env.EXPIRY_LAMBDA_ARN ?? '';
const RC_EXPIRY_7D_LAMBDA_ARN = process.env.RC_EXPIRY_7D_LAMBDA_ARN ?? process.env.EXPIRY_LAMBDA_ARN ?? '';
const RC_EXPIRY_SUSPEND_LAMBDA_ARN = process.env.RC_EXPIRY_SUSPEND_LAMBDA_ARN ?? process.env.EXPIRY_LAMBDA_ARN ?? '';
const SCHEDULER_GROUP = process.env.SCHEDULER_GROUP ?? 'default';

type Decision = 'APPROVE' | 'REJECT' | 'CLARIFY';
const VALID_DECISIONS: Decision[] = ['APPROVE', 'REJECT', 'CLARIFY'];
const REVIEWABLE_STATUSES = ['PENDING_REVIEW', 'CLARIFICATION_REQUESTED'];

/** Verify the soft-lock is held by the calling admin */
async function verifyLock(submissionId: string, adminId: string): Promise<boolean> {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `RC_SOFT_LOCK#${submissionId}`, SK: 'METADATA' },
  }));
  const lock = result.Item;
  if (!lock) return false;
  if (lock.lockedBy !== adminId) return false;
  if ((lock.expiresAt as string) < new Date().toISOString()) return false;
  return true;
}

/** Load submission by userId + submissionId */
async function loadSubmission(userId: string, submissionId: string) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USER#${userId}`, SK: `RCSUBMISSION#${submissionId}` },
  }));
  return result.Item ?? null;
}

/** Find the queue projection item for a given submissionId */
async function findQueueItem(submissionId: string) {
  // Queue items have PK=RC_REVIEW_QUEUE and SK containing the submissionId
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    FilterExpression: 'submissionId = :sid',
    ExpressionAttributeValues: {
      ':pk': 'RC_REVIEW_QUEUE',
      ':sid': submissionId,
    },
  }));
  return result.Items?.[0] ?? null;
}

/** Find previously APPROVED submissions for a user (to mark SUPERSEDED) */
async function findPreviousApproved(userId: string, excludeSubmissionId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    FilterExpression: '#status = :approved AND submissionId <> :exclude',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':pk': `USER#${userId}`,
      ':prefix': 'RCSUBMISSION#',
      ':approved': 'APPROVED',
      ':exclude': excludeSubmissionId,
    },
  }));
  return result.Items ?? [];
}

/** Create EventBridge Scheduler rules for RC expiry reminders */
async function createExpirySchedules(submissionId: string, expiryDate: string) {
  const expiry = new Date(expiryDate);

  // 30-day reminder before expiry
  const reminder30d = new Date(expiry.getTime() - 30 * 24 * 60 * 60 * 1000);
  // 7-day reminder before expiry
  const reminder7d = new Date(expiry.getTime() - 7 * 24 * 60 * 60 * 1000);

  const schedules = [
    {
      Name: `rc-expiry-reminder-30d-${submissionId}`,
      ScheduleExpression: `at(${reminder30d.toISOString().replace(/\.\d{3}Z$/, '')})`,
      Input: JSON.stringify({ type: 'RC_EXPIRY_REMINDER_30D', submissionId }),
      TargetArn: RC_EXPIRY_30D_LAMBDA_ARN,
    },
    {
      Name: `rc-expiry-reminder-7d-${submissionId}`,
      ScheduleExpression: `at(${reminder7d.toISOString().replace(/\.\d{3}Z$/, '')})`,
      Input: JSON.stringify({ type: 'RC_EXPIRY_REMINDER_7D', submissionId }),
      TargetArn: RC_EXPIRY_7D_LAMBDA_ARN,
    },
    {
      Name: `rc-expiry-suspend-${submissionId}`,
      ScheduleExpression: `at(${expiry.toISOString().replace(/\.\d{3}Z$/, '')})`,
      Input: JSON.stringify({ type: 'RC_EXPIRY_SUSPEND', submissionId }),
      TargetArn: RC_EXPIRY_SUSPEND_LAMBDA_ARN,
    },
  ];

  for (const sched of schedules) {
    await scheduler.send(new CreateScheduleCommand({
      Name: sched.Name,
      GroupName: SCHEDULER_GROUP,
      ScheduleExpression: sched.ScheduleExpression,
      ScheduleExpressionTimezone: 'UTC',
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: sched.TargetArn,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: sched.Input,
      },
      ActionAfterCompletion: 'DELETE',
    }));
  }
}

/** Delete EventBridge Scheduler rules for a given submissionId */
async function deleteExpirySchedules(submissionId: string) {
  const names = [
    `rc-expiry-reminder-30d-${submissionId}`,
    `rc-expiry-reminder-7d-${submissionId}`,
    `rc-expiry-suspend-${submissionId}`,
  ];
  for (const name of names) {
    try {
      await scheduler.send(new DeleteScheduleCommand({
        Name: name,
        GroupName: SCHEDULER_GROUP,
      }));
    } catch (err: unknown) {
      // Schedule may not exist; ignore ResourceNotFoundException
      if ((err as { name?: string }).name !== 'ResourceNotFoundException') throw err;
    }
  }
}

/** Emit event via EventBridge for email notifications */
async function emitEvent(detailType: string, detail: Record<string, unknown>) {
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS,
      Source: 'spotzy',
      DetailType: detailType,
      Detail: JSON.stringify(detail),
    }],
  }));
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const admin = extractAdminClaims(event);
  const log = createLogger('admin-rc-review-decide', event.requestContext.requestId, admin?.userId);
  if (!admin) return forbidden();

  const submissionId = event.pathParameters?.submissionId;
  if (!submissionId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'submissionId' });

  const body = JSON.parse(event.body ?? '{}');
  const { decision, reviewerNote, rejectionReason } = body;

  if (!decision || !VALID_DECISIONS.includes(decision as Decision)) {
    return badRequest('INVALID_FIELD', { field: 'decision' });
  }

  // 1. Verify soft-lock
  const hasLock = await verifyLock(submissionId, admin.userId);
  if (!hasLock) return conflict('LOCK_NOT_HELD');

  // 2. Find queue item to get userId
  const queueItem = await findQueueItem(submissionId);
  if (!queueItem) return notFound();

  const userId = queueItem.userId as string;

  // 3. Load submission
  const submission = await loadSubmission(userId, submissionId);
  if (!submission) return notFound();

  const currentStatus = submission.status as string;
  if (!REVIEWABLE_STATUSES.includes(currentStatus)) {
    return badRequest('SUBMISSION_NOT_REVIEWABLE', { status: currentStatus });
  }

  const now = new Date().toISOString();
  const queueSK = queueItem.SK as string;

  // Route to decision handler
  if (decision === 'APPROVE') {
    return handleApprove(submissionId, userId, submission, queueSK, now, admin, reviewerNote, log);
  } else if (decision === 'REJECT') {
    return handleReject(submissionId, userId, queueSK, now, admin, reviewerNote, rejectionReason, log);
  } else {
    return handleClarify(submissionId, userId, submission, queueSK, now, admin, reviewerNote, log);
  }
};

async function handleApprove(
  submissionId: string,
  userId: string,
  submission: Record<string, unknown>,
  queueSK: string,
  now: string,
  admin: { userId: string; email: string },
  reviewerNote: string | undefined,
  log: ReturnType<typeof createLogger>,
) {
  // RC insurance expiry: 1 year from now
  const expiryDate = new Date(new Date(now).getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const transactItems: any[] = [
    // Update submission status
    {
      Update: {
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `RCSUBMISSION#${submissionId}` },
        UpdateExpression: 'SET #status = :status, reviewedBy = :reviewedBy, reviewedAt = :now, reviewerNote = :note, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'APPROVED',
          ':reviewedBy': admin.userId,
          ':now': now,
          ':note': reviewerNote ?? null,
        },
      },
    },
    // Update user profile
    {
      Update: {
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET blockReservationCapable = :brc, rcInsuranceStatus = :rcStatus, rcInsuranceExpiryDate = :expiry, rcInsuranceApprovedAt = :now, spotManagerStatus = :smStatus, updatedAt = :now',
        ExpressionAttributeValues: {
          ':brc': true,
          ':rcStatus': 'APPROVED',
          ':expiry': expiryDate,
          ':now': now,
          ':smStatus': 'ACTIVE',
        },
      },
    },
    // Delete queue projection
    {
      Delete: {
        TableName: TABLE,
        Key: { PK: 'RC_REVIEW_QUEUE', SK: queueSK },
      },
    },
    // Delete soft lock
    {
      Delete: {
        TableName: TABLE,
        Key: { PK: `RC_SOFT_LOCK#${submissionId}`, SK: 'METADATA' },
      },
    },
  ];

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  // Handle previous APPROVED submissions: mark SUPERSEDED + delete their schedules
  const previousApproved = await findPreviousApproved(userId, submissionId);
  for (const prev of previousApproved) {
    const prevId = prev.submissionId as string;
    await ddb.send(new TransactWriteCommand({
      TransactItems: [{
        Update: {
          TableName: TABLE,
          Key: { PK: `USER#${userId}`, SK: `RCSUBMISSION#${prevId}` },
          UpdateExpression: 'SET #status = :status, updatedAt = :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': 'SUPERSEDED', ':now': now },
        },
      }],
    }));
    try {
      await deleteExpirySchedules(prevId);
    } catch (err) {
      log.warn('failed to delete previous expiry schedules', { prevId, error: String(err) });
    }
  }

  // Create 3 EventBridge Scheduler rules for expiry — best-effort.
  // Per spec: scheduler failures must NOT roll back the approval. Log and continue.
  try {
    await createExpirySchedules(submissionId, expiryDate);
  } catch (err) {
    log.warn('failed to create expiry schedules — submission still approved', { submissionId, error: String(err) });
  }

  // Emit approval event for email notification
  await emitEvent('rc.submission.approved', {
    submissionId,
    userId,
    reviewedBy: admin.userId,
    expiryDate,
  });

  log.info('submission approved', { submissionId, userId, expiryDate });
  return ok({
    submissionId,
    status: 'APPROVED',
    reviewedAt: now,
    rcInsuranceExpiryDate: expiryDate,
  });
}

async function handleReject(
  submissionId: string,
  userId: string,
  queueSK: string,
  now: string,
  admin: { userId: string; email: string },
  reviewerNote: string | undefined,
  rejectionReason: string | undefined,
  log: ReturnType<typeof createLogger>,
) {
  const transactItems: any[] = [
    // Update submission status
    {
      Update: {
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `RCSUBMISSION#${submissionId}` },
        UpdateExpression: 'SET #status = :status, reviewedBy = :reviewedBy, reviewedAt = :now, reviewerNote = :note, rejectionReason = :reason, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'REJECTED',
          ':reviewedBy': admin.userId,
          ':now': now,
          ':note': reviewerNote ?? null,
          ':reason': rejectionReason ?? null,
        },
      },
    },
    // Update user profile — keep spotManagerStatus as STAGED
    {
      Update: {
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET rcInsuranceStatus = :rcStatus, updatedAt = :now',
        ExpressionAttributeValues: {
          ':rcStatus': 'REJECTED',
          ':now': now,
        },
      },
    },
    // Delete queue projection
    {
      Delete: {
        TableName: TABLE,
        Key: { PK: 'RC_REVIEW_QUEUE', SK: queueSK },
      },
    },
    // Delete soft lock
    {
      Delete: {
        TableName: TABLE,
        Key: { PK: `RC_SOFT_LOCK#${submissionId}`, SK: 'METADATA' },
      },
    },
  ];

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  // Emit rejection event for email notification
  await emitEvent('rc.submission.rejected', {
    submissionId,
    userId,
    reviewedBy: admin.userId,
    rejectionReason: rejectionReason ?? null,
  });

  log.info('submission rejected', { submissionId, userId, rejectionReason });
  return ok({ submissionId, status: 'REJECTED', reviewedAt: now });
}

async function handleClarify(
  submissionId: string,
  userId: string,
  submission: Record<string, unknown>,
  queueSK: string,
  now: string,
  admin: { userId: string; email: string },
  reviewerNote: string | undefined,
  log: ReturnType<typeof createLogger>,
) {
  const transactItems: any[] = [
    // Update submission status
    {
      Update: {
        TableName: TABLE,
        Key: { PK: `USER#${userId}`, SK: `RCSUBMISSION#${submissionId}` },
        UpdateExpression: 'SET #status = :status, reviewerNote = :note, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': 'CLARIFICATION_REQUESTED',
          ':note': reviewerNote ?? null,
          ':now': now,
        },
      },
    },
    // Delete old queue projection (PENDING# prefix)
    {
      Delete: {
        TableName: TABLE,
        Key: { PK: 'RC_REVIEW_QUEUE', SK: queueSK },
      },
    },
    // Write new queue projection with CLARIFICATION# prefix
    {
      Put: {
        TableName: TABLE,
        Item: {
          PK: 'RC_REVIEW_QUEUE',
          SK: `CLARIFICATION#${now}#${submissionId}`,
          submissionId,
          userId,
          hostName: submission.hostName ?? null,
          createdAt: submission.createdAt as string,
          status: 'CLARIFICATION_REQUESTED',
          updatedAt: now,
        },
      },
    },
    // Delete soft lock
    {
      Delete: {
        TableName: TABLE,
        Key: { PK: `RC_SOFT_LOCK#${submissionId}`, SK: 'METADATA' },
      },
    },
  ];

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  // Emit clarification event for email notification
  await emitEvent('rc.submission.clarification', {
    submissionId,
    userId,
    reviewedBy: admin.userId,
    reviewerNote: reviewerNote ?? null,
  });

  log.info('clarification requested', { submissionId, userId });
  return ok({ submissionId, status: 'CLARIFICATION_REQUESTED', reviewedAt: now });
}
