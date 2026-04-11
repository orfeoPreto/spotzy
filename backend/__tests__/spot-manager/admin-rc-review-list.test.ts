import { DynamoDBDocumentClient, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler, businessHoursBetween } from '../../functions/spot-manager/admin-rc-review-list/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const mockAdminEvent = (adminId: string, overrides: any = {}) => ({
  requestContext: { authorizer: { claims: { sub: adminId, email: `${adminId}@spotzy.com`, 'cognito:groups': 'admin' } }, requestId: 'test-req' },
  body: overrides.body ? JSON.stringify(overrides.body) : null,
  pathParameters: overrides.pathParameters ?? null,
  ...overrides,
} as any);

const queueItems = [
  {
    PK: 'RC_REVIEW_QUEUE',
    SK: 'PENDING#2025-01-10T10:00:00.000Z#sub-1',
    submissionId: 'sub-1',
    userId: 'user-1',
    hostName: 'Alice',
    createdAt: '2025-01-10T10:00:00.000Z',
    status: 'PENDING_REVIEW',
  },
  {
    PK: 'RC_REVIEW_QUEUE',
    SK: 'PENDING#2025-01-11T08:00:00.000Z#sub-2',
    submissionId: 'sub-2',
    userId: 'user-2',
    hostName: 'Bob',
    createdAt: '2025-01-11T08:00:00.000Z',
    status: 'PENDING_REVIEW',
  },
];

const lockItem = {
  PK: 'RC_SOFT_LOCK#sub-1',
  SK: 'METADATA',
  submissionId: 'sub-1',
  lockedBy: 'admin-2',
  lockedAt: '2025-01-12T14:00:00.000Z',
  expiresAt: '2025-01-12T14:15:00.000Z',
};

beforeEach(() => {
  ddbMock.reset();
});

describe('admin-rc-review-list', () => {
  it('returns 403 for non-admin', async () => {
    const event = {
      requestContext: { authorizer: { claims: { sub: 'user-1', email: 'u@s.com', 'cognito:groups': 'users' } }, requestId: 'r1' },
      body: null,
      pathParameters: null,
    } as any;
    const result = await handler(event, {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });

  it('returns empty array when queue is empty', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const result = await handler(mockAdminEvent('admin-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.submissions).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('returns submissions with SLA info and lock indicators', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: queueItems });
    ddbMock.on(BatchGetCommand).resolves({
      Responses: { 'spotzy-main': [lockItem] },
    });

    const result = await handler(mockAdminEvent('admin-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.total).toBe(2);
    expect(body.submissions).toHaveLength(2);

    // First submission has a lock
    expect(body.submissions[0].submissionId).toBe('sub-1');
    expect(body.submissions[0].lock).not.toBeNull();
    expect(body.submissions[0].lock.lockedBy).toBe('admin-2');

    // Second submission has no lock
    expect(body.submissions[1].submissionId).toBe('sub-2');
    expect(body.submissions[1].lock).toBeNull();

    // SLA fields present
    expect(typeof body.submissions[0].slaHoursElapsed).toBe('number');
    expect(typeof body.submissions[0].slaWarning).toBe('boolean');
  });

  it('returns submissions without locks when BatchGet returns empty', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [queueItems[0]] });
    ddbMock.on(BatchGetCommand).resolves({ Responses: { 'spotzy-main': [] } });

    const result = await handler(mockAdminEvent('admin-1'), {} as any, () => {});
    const body = JSON.parse(result!.body);
    expect(body.submissions[0].lock).toBeNull();
  });
});

describe('businessHoursBetween', () => {
  it('returns 0 when end <= start', () => {
    expect(businessHoursBetween('2025-01-10T10:00:00Z', '2025-01-10T09:00:00Z')).toBe(0);
    expect(businessHoursBetween('2025-01-10T10:00:00Z', '2025-01-10T10:00:00Z')).toBe(0);
  });

  it('counts hours within a single business day', () => {
    // Wednesday 10:00 UTC = 11:00 CET to 15:00 UTC = 16:00 CET => 5 business hours
    const hours = businessHoursBetween('2025-01-08T10:00:00Z', '2025-01-08T15:00:00Z');
    expect(hours).toBe(5);
  });

  it('excludes weekend hours', () => {
    // Friday 16:00 UTC (17:00 CET) to Monday 09:00 UTC (10:00 CET)
    // Friday: 17:00 CET has 1h left (17-18)
    // Saturday + Sunday: 0h
    // Monday 09:00-10:00 CET (08:00-09:00 UTC): 1h
    // Total: 2h
    const hours = businessHoursBetween('2025-01-10T16:00:00Z', '2025-01-13T09:00:00Z');
    expect(hours).toBe(2);
  });
});
