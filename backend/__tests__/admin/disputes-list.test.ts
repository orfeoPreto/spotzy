import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, GetCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/admin/disputes-list/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const mockAdminEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: 'admin-1', email: 'admin@spotzy.com', 'cognito:groups': 'admin' } },
      requestId: 'req-1',
    },
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/api/v1/admin/disputes',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent);

const mockNonAdminEvent = (): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: 'user-1', email: 'user@spotzy.com', 'cognito:groups': 'users' } },
      requestId: 'req-2',
    },
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/api/v1/admin/disputes',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

const dispute1 = {
  PK: 'DISPUTE#d1', SK: 'METADATA',
  disputeId: 'd1', bookingId: 'b1', status: 'ESCALATED',
  escalatedAt: '2026-04-01T10:00:00.000Z',
  escalationSummary: 'Guest reports spot was inaccessible.',
  hostId: 'host-1', spotterId: 'guest-1',
  lastAdminVisit: '2026-04-01T08:00:00.000Z',
};

const dispute2 = {
  PK: 'DISPUTE#d2', SK: 'METADATA',
  disputeId: 'd2', bookingId: 'b2', status: 'ESCALATED',
  escalatedAt: '2026-04-02T10:00:00.000Z',
  escalationSummary: 'Host disputes damage claim.',
  hostId: 'host-2', spotterId: 'guest-2',
  lastAdminVisit: null,
};

const booking1 = {
  PK: 'BOOKING#b1', SK: 'METADATA',
  bookingId: 'b1', listingAddress: '10 Rue de Rivoli, Paris',
  referenceNumber: 'BK001234',
};

const booking2 = {
  PK: 'BOOKING#b2', SK: 'METADATA',
  bookingId: 'b2', listingAddress: '5 Avenue Foch, Paris',
  referenceNumber: 'BK005678',
};

const hostProfile1 = { PK: 'USER#host-1', SK: 'PROFILE', displayName: 'HostAlice', pseudo: 'HostAlice' };
const guestProfile1 = { PK: 'USER#guest-1', SK: 'PROFILE', displayName: 'GuestBob', pseudo: 'GuestBob' };
const hostProfile2 = { PK: 'USER#host-2', SK: 'PROFILE', displayName: 'HostCharlie', pseudo: 'HostCharlie' };
const guestProfile2 = { PK: 'USER#guest-2', SK: 'PROFILE', displayName: 'GuestDiana', pseudo: 'GuestDiana' };

// Message after lastAdminVisit for d1
const recentMessage = {
  PK: 'DISPUTE#d1', SK: 'MSG#2026-04-01T09:00:00.000Z',
  createdAt: '2026-04-01T09:00:00.000Z',
  content: 'new message',
};

beforeEach(() => {
  ddbMock.reset();
  // Scan for ESCALATED disputes
  ddbMock.on(ScanCommand).resolves({ Items: [dispute1, dispute2] });
  // BatchGet for bookings and user profiles
  ddbMock.on(BatchGetCommand).resolves({
    Responses: {
      'spotzy-main': [booking1, booking2, hostProfile1, guestProfile1, hostProfile2, guestProfile2],
    },
  });
  // Query for messages (unread check)
  ddbMock.on(QueryCommand).resolves({ Items: [recentMessage] });
});

describe('admin-disputes-list', () => {
  it('returns only ESCALATED disputes sorted by escalation time ascending', async () => {
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    // Default view includes escalated + resolved (last 10)
    expect(body.disputes.length).toBeGreaterThan(0);
    // Newest first
    for (let i = 1; i < body.disputes.length; i++) {
      const prev = body.disputes[i - 1].escalatedAt ?? body.disputes[i - 1].resolvedAt ?? body.disputes[i - 1].createdAt;
      const curr = body.disputes[i].escalatedAt ?? body.disputes[i].resolvedAt ?? body.disputes[i].createdAt;
      expect(new Date(prev) >= new Date(curr)).toBe(true);
    }
  });

  it('each dispute includes escalationSummary, unreadForAdmin, booking metadata', async () => {
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const dispute = JSON.parse(result!.body).disputes[0];
    expect(dispute).toHaveProperty('escalationSummary');
    expect(dispute).toHaveProperty('unreadForAdmin');
    expect(dispute).toHaveProperty('bookingRef');
    expect(dispute).toHaveProperty('listingAddress');
    expect(dispute).toHaveProperty('hostDisplayName');
    expect(dispute).toHaveProperty('guestDisplayName');
  });

  it('unreadForAdmin=true when messages exist after lastAdminVisit', async () => {
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const body = JSON.parse(result!.body);
    expect(body.disputes[0].unreadForAdmin).toBe(true);
  });

  it('non-admin returns 403', async () => {
    const result = await handler(mockNonAdminEvent(), {} as any, () => {});
    expect(result!.statusCode).toBe(403);
    expect(JSON.parse(result!.body).error).toBe('ADMIN_ACCESS_REQUIRED');
  });
});
