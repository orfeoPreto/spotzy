import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { SchedulerClient, CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/spot-manager/admin-rc-review-decide/index';

const ddbMock = mockClient(DynamoDBDocumentClient);
const schedulerMock = mockClient(SchedulerClient);
const ebMock = mockClient(EventBridgeClient);

const mockAdminEvent = (adminId: string, overrides: any = {}) => {
  const { body, pathParameters, ...rest } = overrides;
  return {
    requestContext: { authorizer: { claims: { sub: adminId, email: `${adminId}@spotzy.com`, 'cognito:groups': 'admin' } }, requestId: 'test-req' },
    body: body ? JSON.stringify(body) : null,
    pathParameters: pathParameters ?? null,
    ...rest,
  } as any;
};

const futureIso = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min in future

const lockItem = {
  PK: 'RC_SOFT_LOCK#sub-1',
  SK: 'METADATA',
  submissionId: 'sub-1',
  lockedBy: 'admin-1',
  lockedAt: new Date().toISOString(),
  expiresAt: futureIso,
};

const queueItem = {
  PK: 'RC_REVIEW_QUEUE',
  SK: 'PENDING#2025-01-10T10:00:00.000Z#sub-1',
  submissionId: 'sub-1',
  userId: 'user-1',
  hostName: 'Alice',
  createdAt: '2025-01-10T10:00:00.000Z',
  status: 'PENDING_REVIEW',
};

const submission = {
  PK: 'USER#user-1',
  SK: 'RCSUBMISSION#sub-1',
  submissionId: 'sub-1',
  userId: 'user-1',
  hostName: 'Alice',
  status: 'PENDING_REVIEW',
  createdAt: '2025-01-10T10:00:00.000Z',
};

function setupMocks() {
  // Lock check
  ddbMock.on(GetCommand, { Key: { PK: 'RC_SOFT_LOCK#sub-1', SK: 'METADATA' } }).resolves({ Item: lockItem });
  // Submission get
  ddbMock.on(GetCommand, { Key: { PK: 'USER#user-1', SK: 'RCSUBMISSION#sub-1' } }).resolves({ Item: submission });
  // Query: queue item lookup returns queueItem, previous-approved lookup returns empty
  let queryCallCount = 0;
  ddbMock.on(QueryCommand).callsFake(() => {
    queryCallCount++;
    if (queryCallCount === 1) return { Items: [queueItem] };
    return { Items: [] }; // previous approved — none
  });
  // TransactWrite
  ddbMock.on(TransactWriteCommand).resolves({});
  // Scheduler
  schedulerMock.on(CreateScheduleCommand).resolves({});
  schedulerMock.on(DeleteScheduleCommand).resolves({});
  // EventBridge
  ebMock.on(PutEventsCommand).resolves({});
}

beforeEach(() => {
  ddbMock.reset();
  schedulerMock.reset();
  ebMock.reset();
});

describe('admin-rc-review-decide', () => {
  // ---------------------------------------------------------------
  // Auth & validation
  // ---------------------------------------------------------------
  it('returns 403 for non-admin', async () => {
    const event = {
      requestContext: { authorizer: { claims: { sub: 'u1', email: 'u@s.com', 'cognito:groups': 'users' } }, requestId: 'r1' },
      body: JSON.stringify({ decision: 'APPROVE' }),
      pathParameters: { submissionId: 'sub-1' },
    } as any;
    const result = await handler(event, {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });

  it('returns 400 when submissionId missing', async () => {
    const result = await handler(
      mockAdminEvent('admin-1', { body: { decision: 'APPROVE' } }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(400);
  });

  it('returns 400 for invalid decision', async () => {
    const result = await handler(
      mockAdminEvent('admin-1', {
        pathParameters: { submissionId: 'sub-1' },
        body: { decision: 'INVALID' },
      }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toContain('decision must be');
  });

  it('returns 409 LOCK_NOT_HELD when lock missing', async () => {
    ddbMock.on(GetCommand, { Key: { PK: 'RC_SOFT_LOCK#sub-1', SK: 'METADATA' } }).resolves({ Item: undefined });

    const result = await handler(
      mockAdminEvent('admin-1', {
        pathParameters: { submissionId: 'sub-1' },
        body: { decision: 'APPROVE' },
      }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(409);
    expect(JSON.parse(result!.body).error).toBe('LOCK_NOT_HELD');
  });

  it('returns 409 LOCK_NOT_HELD when lock held by different admin', async () => {
    ddbMock.on(GetCommand, { Key: { PK: 'RC_SOFT_LOCK#sub-1', SK: 'METADATA' } }).resolves({
      Item: { ...lockItem, lockedBy: 'admin-2' },
    });

    const result = await handler(
      mockAdminEvent('admin-1', {
        pathParameters: { submissionId: 'sub-1' },
        body: { decision: 'APPROVE' },
      }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(409);
  });

  it('returns 404 when queue item not found', async () => {
    ddbMock.on(GetCommand, { Key: { PK: 'RC_SOFT_LOCK#sub-1', SK: 'METADATA' } }).resolves({ Item: lockItem });
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const result = await handler(
      mockAdminEvent('admin-1', {
        pathParameters: { submissionId: 'sub-1' },
        body: { decision: 'APPROVE' },
      }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(404);
  });

  it('returns 400 when submission status is not reviewable', async () => {
    ddbMock.on(GetCommand, { Key: { PK: 'RC_SOFT_LOCK#sub-1', SK: 'METADATA' } }).resolves({ Item: lockItem });
    ddbMock.on(QueryCommand).resolves({ Items: [queueItem] });
    ddbMock.on(GetCommand, { Key: { PK: 'USER#user-1', SK: 'RCSUBMISSION#sub-1' } }).resolves({
      Item: { ...submission, status: 'APPROVED' },
    });

    const result = await handler(
      mockAdminEvent('admin-1', {
        pathParameters: { submissionId: 'sub-1' },
        body: { decision: 'APPROVE' },
      }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toContain('not reviewable');
  });

  // ---------------------------------------------------------------
  // APPROVE path
  // ---------------------------------------------------------------
  it('APPROVE: updates submission, profile, deletes queue+lock, creates schedules', async () => {
    setupMocks();

    const result = await handler(
      mockAdminEvent('admin-1', {
        pathParameters: { submissionId: 'sub-1' },
        body: { decision: 'APPROVE', reviewerNote: 'Looks good' },
      }),
      {} as any,
      () => {},
    );

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.status).toBe('APPROVED');
    expect(body.rcInsuranceExpiryDate).toBeDefined();

    // TransactWrite called (at least once for the main transaction)
    const txCalls = ddbMock.commandCalls(TransactWriteCommand);
    expect(txCalls.length).toBeGreaterThanOrEqual(1);

    // Main transaction has 4 items: update submission, update profile, delete queue, delete lock
    const mainTx = txCalls[0].args[0].input.TransactItems!;
    expect(mainTx).toHaveLength(4);

    // 3 scheduler rules created
    const schedulerCalls = schedulerMock.commandCalls(CreateScheduleCommand);
    expect(schedulerCalls).toHaveLength(3);

    // Rule names are correct
    const ruleNames = schedulerCalls.map((c) => c.args[0].input.Name);
    expect(ruleNames).toContain('rc-expiry-reminder-30d-sub-1');
    expect(ruleNames).toContain('rc-expiry-reminder-7d-sub-1');
    expect(ruleNames).toContain('rc-expiry-suspend-sub-1');

    // Approval event emitted
    const ebCalls = ebMock.commandCalls(PutEventsCommand);
    expect(ebCalls).toHaveLength(1);
    expect(ebCalls[0].args[0].input.Entries![0].DetailType).toBe('rc.submission.approved');
  });

  it('APPROVE: marks previous submissions as SUPERSEDED and deletes their schedules', async () => {
    const prevSubmission = {
      PK: 'USER#user-1',
      SK: 'RCSUBMISSION#sub-old',
      submissionId: 'sub-old',
      status: 'APPROVED',
    };

    // First QueryCommand call: queue items
    // Second QueryCommand call: previous approved
    let queryCallCount = 0;
    ddbMock.on(QueryCommand).callsFake(() => {
      queryCallCount++;
      if (queryCallCount === 1) return { Items: [queueItem] };
      return { Items: [prevSubmission] };
    });
    ddbMock.on(GetCommand, { Key: { PK: 'RC_SOFT_LOCK#sub-1', SK: 'METADATA' } }).resolves({ Item: lockItem });
    ddbMock.on(GetCommand, { Key: { PK: 'USER#user-1', SK: 'RCSUBMISSION#sub-1' } }).resolves({ Item: submission });
    ddbMock.on(TransactWriteCommand).resolves({});
    schedulerMock.on(CreateScheduleCommand).resolves({});
    schedulerMock.on(DeleteScheduleCommand).resolves({});
    ebMock.on(PutEventsCommand).resolves({});

    const result = await handler(
      mockAdminEvent('admin-1', {
        pathParameters: { submissionId: 'sub-1' },
        body: { decision: 'APPROVE' },
      }),
      {} as any,
      () => {},
    );

    expect(result!.statusCode).toBe(200);

    // Main transaction + SUPERSEDED transaction
    const txCalls = ddbMock.commandCalls(TransactWriteCommand);
    expect(txCalls.length).toBe(2);

    // SUPERSEDED update for old submission
    const supersededTx = txCalls[1].args[0].input.TransactItems!;
    expect(supersededTx[0].Update!.ExpressionAttributeValues![':status']).toBe('SUPERSEDED');

    // 3 delete scheduler calls for old submission + 3 create for new
    const deleteCalls = schedulerMock.commandCalls(DeleteScheduleCommand);
    expect(deleteCalls).toHaveLength(3);
    const deleteNames = deleteCalls.map((c) => c.args[0].input.Name);
    expect(deleteNames).toContain('rc-expiry-reminder-30d-sub-old');
  });

  // ---------------------------------------------------------------
  // REJECT path
  // ---------------------------------------------------------------
  it('REJECT: updates submission+profile, deletes queue+lock, emits event', async () => {
    setupMocks();

    const result = await handler(
      mockAdminEvent('admin-1', {
        pathParameters: { submissionId: 'sub-1' },
        body: { decision: 'REJECT', rejectionReason: 'Document expired' },
      }),
      {} as any,
      () => {},
    );

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.status).toBe('REJECTED');

    const txCalls = ddbMock.commandCalls(TransactWriteCommand);
    expect(txCalls).toHaveLength(1);
    const items = txCalls[0].args[0].input.TransactItems!;
    expect(items).toHaveLength(4);

    // Verify submission update has REJECTED status
    const updateVals = items[0].Update!.ExpressionAttributeValues!;
    expect(updateVals[':status']).toBe('REJECTED');
    expect(updateVals[':reason']).toBe('Document expired');

    // Profile update sets rcInsuranceStatus to REJECTED (not spotManagerStatus)
    const profileUpdate = items[1].Update!;
    expect(profileUpdate.UpdateExpression).toContain('rcInsuranceStatus');
    expect(profileUpdate.UpdateExpression).not.toContain('spotManagerStatus');

    // No scheduler calls
    expect(schedulerMock.commandCalls(CreateScheduleCommand)).toHaveLength(0);

    // Rejection event emitted
    const ebCalls = ebMock.commandCalls(PutEventsCommand);
    expect(ebCalls).toHaveLength(1);
    expect(ebCalls[0].args[0].input.Entries![0].DetailType).toBe('rc.submission.rejected');
  });

  // ---------------------------------------------------------------
  // CLARIFY path
  // ---------------------------------------------------------------
  it('CLARIFY: updates submission, re-queues with CLARIFICATION# prefix, emits event', async () => {
    setupMocks();

    const result = await handler(
      mockAdminEvent('admin-1', {
        pathParameters: { submissionId: 'sub-1' },
        body: { decision: 'CLARIFY', reviewerNote: 'Please re-upload clearer photo' },
      }),
      {} as any,
      () => {},
    );

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.status).toBe('CLARIFICATION_REQUESTED');

    const txCalls = ddbMock.commandCalls(TransactWriteCommand);
    expect(txCalls).toHaveLength(1);
    const items = txCalls[0].args[0].input.TransactItems!;
    expect(items).toHaveLength(4);

    // First item: submission update to CLARIFICATION_REQUESTED
    expect(items[0].Update!.ExpressionAttributeValues![':status']).toBe('CLARIFICATION_REQUESTED');

    // Second item: delete old queue projection
    expect(items[1].Delete!.Key).toEqual({ PK: 'RC_REVIEW_QUEUE', SK: 'PENDING#2025-01-10T10:00:00.000Z#sub-1' });

    // Third item: put new queue item with CLARIFICATION# prefix
    expect(items[2].Put!.Item!.PK).toBe('RC_REVIEW_QUEUE');
    expect((items[2].Put!.Item!.SK as string)).toMatch(/^CLARIFICATION#/);
    expect(items[2].Put!.Item!.status).toBe('CLARIFICATION_REQUESTED');

    // Fourth item: delete lock
    expect(items[3].Delete!.Key).toEqual({ PK: 'RC_SOFT_LOCK#sub-1', SK: 'METADATA' });

    // No scheduler calls for clarify
    expect(schedulerMock.commandCalls(CreateScheduleCommand)).toHaveLength(0);

    // Clarification event emitted
    const ebCalls = ebMock.commandCalls(PutEventsCommand);
    expect(ebCalls[0].args[0].input.Entries![0].DetailType).toBe('rc.submission.clarification');
  });

  it('CLARIFY: works on CLARIFICATION_REQUESTED status too', async () => {
    ddbMock.on(GetCommand, { Key: { PK: 'RC_SOFT_LOCK#sub-1', SK: 'METADATA' } }).resolves({ Item: lockItem });
    ddbMock.on(QueryCommand).resolves({ Items: [{ ...queueItem, status: 'CLARIFICATION_REQUESTED' }] });
    ddbMock.on(GetCommand, { Key: { PK: 'USER#user-1', SK: 'RCSUBMISSION#sub-1' } }).resolves({
      Item: { ...submission, status: 'CLARIFICATION_REQUESTED' },
    });
    ddbMock.on(TransactWriteCommand).resolves({});
    ebMock.on(PutEventsCommand).resolves({});

    const result = await handler(
      mockAdminEvent('admin-1', {
        pathParameters: { submissionId: 'sub-1' },
        body: { decision: 'CLARIFY', reviewerNote: 'Need more info' },
      }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(200);
  });
});
