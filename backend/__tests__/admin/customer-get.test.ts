import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/admin/customer-get/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const mockAdminEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: 'admin-1', email: 'admin@spotzy.be', 'cognito:groups': 'admin' } },
      requestId: 'req-1',
    },
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/api/v1/admin/customers/u1',
    pathParameters: { userId: 'u1' },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent);

const userProfile = {
  PK: 'USER#u1', SK: 'PROFILE',
  userId: 'u1', displayName: 'MarcDurand', pseudo: 'MarcDurand',
  firstName: 'Marc', lastName: 'Durand',
  email: 'marc@test.com', phone: '+33612345678',
  showFullNamePublicly: false,
  stripeConnectAccountId: 'acct_1',
  rating: 4.5, createdAt: '2026-01-01T00:00:00.000Z',
};

const activeListing = {
  PK: 'LISTING#l1', SK: 'METADATA',
  listingId: 'l1', status: 'live', address: '10 Rue de Rivoli',
};

const draftListing = {
  PK: 'LISTING#l2', SK: 'METADATA',
  listingId: 'l2', status: 'draft', address: '5 Rue du Bac',
};

const archivedListing = {
  PK: 'LISTING#l3', SK: 'METADATA',
  listingId: 'l3', status: 'archived', address: '3 Place Vendome',
};

const activeBooking = {
  PK: 'BOOKING#b1', SK: 'METADATA',
  bookingId: 'b1', status: 'CONFIRMED', listingAddress: '10 Rue de Rivoli',
};

const completedBooking = {
  PK: 'BOOKING#b2', SK: 'METADATA',
  bookingId: 'b2', status: 'COMPLETED', listingAddress: '5 Rue du Bac',
};

const disputeItem = {
  PK: 'DISPUTE#d1', SK: 'METADATA',
  disputeId: 'd1', status: 'ESCALATED', bookingId: 'b1',
};

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: userProfile });
  // Listings query (HOST#u1)
  ddbMock.on(QueryCommand, {
    IndexName: 'GSI1',
    ExpressionAttributeValues: { ':pk': 'HOST#u1' },
  }).resolves({ Items: [activeListing, draftListing, archivedListing] });
  // Bookings query (SPOTTER#u1)
  ddbMock.on(QueryCommand, {
    IndexName: 'GSI1',
    ExpressionAttributeValues: { ':pk': 'SPOTTER#u1' },
  }).resolves({ Items: [activeBooking, completedBooking] });
  // Disputes query — scan disputes with host or spotter matching
  ddbMock.on(QueryCommand, {
    IndexName: 'GSI1',
    ExpressionAttributeValues: expect.objectContaining({ ':pk': expect.stringContaining('BOOKING') }),
  }).resolves({ Items: [] });
  // Fallback for other queries (disputes scan)
  ddbMock.on(QueryCommand).callsFake((input) => {
    if (input.IndexName === 'GSI1' && (input.ExpressionAttributeValues as any)?.[':pk'] === 'HOST#u1') {
      return { Items: [activeListing, draftListing, archivedListing] };
    }
    if (input.IndexName === 'GSI1' && (input.ExpressionAttributeValues as any)?.[':pk'] === 'SPOTTER#u1') {
      return { Items: [activeBooking, completedBooking] };
    }
    return { Items: [disputeItem] };
  });
});

describe('admin-customer-get', () => {
  it('returns full identity including email, phone, full name', async () => {
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.email).toBe('marc@test.com');
    expect(body.phone).toBe('+33612345678');
    expect(body.firstName).toBe('Marc');
    expect(body.lastName).toBe('Durand');
  });

  it('returns active listings by default (no history)', async () => {
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const body = JSON.parse(result!.body);
    expect(body.listings.active).toBeDefined();
    expect(body.listings.active.every((l: any) => ['live', 'draft'].includes(l.status))).toBe(true);
    expect(body.listings.history).toBeUndefined();
  });

  it('returns active bookings by default', async () => {
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const body = JSON.parse(result!.body);
    expect(body.bookings.active).toBeDefined();
    expect(body.bookings.active.every((b: any) => ['PENDING', 'CONFIRMED', 'ACTIVE'].includes(b.status))).toBe(true);
  });

  it('?includeHistory=true returns completed/cancelled items', async () => {
    const result = await handler(mockAdminEvent({
      queryStringParameters: { includeHistory: 'true' },
    }), {} as any, () => {});
    const body = JSON.parse(result!.body);
    expect(body.listings.history).toBeDefined();
    expect(body.bookings.history).toBeDefined();
  });

  it('returns all disputes for user', async () => {
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const body = JSON.parse(result!.body);
    expect(body.disputes).toBeDefined();
  });

  it('non-admin returns 403', async () => {
    const event = mockAdminEvent({
      requestContext: {
        authorizer: { claims: { sub: 'u1', email: 'u@s.com', 'cognito:groups': 'users' } },
        requestId: 'r',
      } as any,
    });
    const result = await handler(event, {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });
});
