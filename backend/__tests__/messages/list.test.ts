import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/messages/list/index';
import { mockAuthContext } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

const USER_ID = 'user-123';
const HOST_ID = 'host-456';
const LISTING_ID = 'listing-789';

const makeEvent = (userId = USER_ID, qs: Record<string, string> | null = null): APIGatewayProxyEvent =>
  ({
    ...mockAuthContext(userId),
    body: null,
    pathParameters: null,
    queryStringParameters: qs,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/messages',
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

// -- Mock data setup helpers --
const confirmedBooking = (bookingId: string, spotterId: string, hostId: string, status = 'CONFIRMED') => ({
  PK: `BOOKING#${bookingId}`,
  SK: 'METADATA',
  bookingId,
  listingId: LISTING_ID,
  spotterId,
  hostId,
  status,
  createdAt: '2025-01-01T00:00:00.000Z',
});

const userProfile = (userId: string, name: string, photoUrl?: string) => ({
  PK: `USER#${userId}`,
  SK: 'PROFILE',
  userId,
  name,
  photoUrl: photoUrl ?? null,
  createdAt: '2025-01-01T00:00:00.000Z',
});

const listingItem = (listingId: string, address: string) => ({
  PK: `LISTING#${listingId}`,
  SK: 'METADATA',
  listingId,
  address,
});

const chatMessage = (bookingId: string, ts: string, msgId: string, senderId: string, content: string) => ({
  PK: `CHAT#${bookingId}`,
  SK: `MSG#${ts}#${msgId}`,
  messageId: msgId,
  bookingId,
  senderId,
  content,
  createdAt: ts,
});

beforeEach(() => {
  ddbMock.reset();
});

/**
 * Helper to set up the mock DynamoDB responses for a standard scenario.
 * The messages-list handler queries:
 * 1. GSI1 SPOTTER# bookings
 * 2. GSI1 HOST# listings → LISTING# BOOKING# relations → BatchGet booking metadata
 * 3. For each booking: last message (QueryCommand on CHAT#), user profile (GetCommand), listing (GetCommand), unread count (QueryCommand on UNREAD#)
 */
function setupMocks(options: {
  spotterBookings?: Record<string, unknown>[];
  hostListings?: Record<string, unknown>[];
  listingBookingRelations?: Record<string, Record<string, unknown>[]>;
  hostBookingsBatch?: Record<string, unknown>[];
  lastMessages?: Record<string, Record<string, unknown>[]>;
  userProfiles?: Record<string, Record<string, unknown>>;
  listings?: Record<string, Record<string, unknown>>;
  unreadCounts?: Record<string, Record<string, unknown>[]>;
}) {
  // We need to handle multiple QueryCommand calls with different key conditions.
  // Use callsFake to route based on input.
  ddbMock.on(QueryCommand).callsFake((input) => {
    const kce = input.KeyConditionExpression ?? '';
    const eav = input.ExpressionAttributeValues ?? {};

    // GSI1 SPOTTER# query
    if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('SPOTTER#')) {
      return { Items: options.spotterBookings ?? [] };
    }
    // GSI1 HOST# query (listings)
    if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('HOST#')) {
      return { Items: options.hostListings ?? [] };
    }
    // LISTING# BOOKING# relations
    if ((eav[':pk'] as string)?.startsWith('LISTING#') && (eav[':prefix'] as string)?.startsWith('BOOKING#')) {
      const listingId = (eav[':pk'] as string).replace('LISTING#', '');
      return { Items: options.listingBookingRelations?.[listingId] ?? [] };
    }
    // CHAT# last message query
    if ((eav[':pk'] as string)?.startsWith('CHAT#')) {
      const bookingId = (eav[':pk'] as string).replace('CHAT#', '');
      return { Items: options.lastMessages?.[bookingId] ?? [] };
    }
    // USER# UNREAD# query
    if ((eav[':pk'] as string)?.startsWith('USER#') && (eav[':prefix'] as string) === 'UNREAD#') {
      return { Items: [] };
    }
    return { Items: [] };
  });

  ddbMock.on(GetCommand).callsFake((input) => {
    const pk = input.Key?.PK as string;
    const sk = input.Key?.SK as string;
    if (pk?.startsWith('USER#') && sk === 'PROFILE') {
      const userId = pk.replace('USER#', '');
      return { Item: options.userProfiles?.[userId] ?? null };
    }
    if (pk?.startsWith('LISTING#') && sk === 'METADATA') {
      const listingId = pk.replace('LISTING#', '');
      return { Item: options.listings?.[listingId] ?? null };
    }
    if (pk?.startsWith('BOOKING#') && sk === 'METADATA') {
      // Direct booking lookup
      const bookingId = pk.replace('BOOKING#', '');
      const found = [...(options.spotterBookings ?? []), ...(options.hostBookingsBatch ?? [])].find(
        (b) => (b as Record<string, unknown>).bookingId === bookingId
      );
      return { Item: found ?? null };
    }
    return { Item: null };
  });

  ddbMock.on(BatchGetCommand).callsFake(() => ({
    Responses: {
      'spotzy-main': options.hostBookingsBatch ?? [],
    },
  }));
}

describe('messages-list', () => {
  it('returns only PENDING, CONFIRMED, ACTIVE booking conversations by default', async () => {
    setupMocks({
      spotterBookings: [
        confirmedBooking('b1', USER_ID, HOST_ID, 'CONFIRMED'),
        confirmedBooking('b2', USER_ID, HOST_ID, 'CONFIRMED'),
        confirmedBooking('b3', USER_ID, HOST_ID, 'COMPLETED'),
        confirmedBooking('b4', USER_ID, HOST_ID, 'CANCELLED'),
      ],
      userProfiles: {
        [HOST_ID]: userProfile(HOST_ID, 'Marc Dupont'),
      },
      listings: {
        [LISTING_ID]: listingItem(LISTING_ID, '12 Rue de Rivoli, Paris'),
      },
      lastMessages: {
        b1: [chatMessage('b1', '2025-01-15T10:00:00.000Z', 'm1', HOST_ID, 'Hello')],
        b2: [chatMessage('b2', '2025-01-16T10:00:00.000Z', 'm2', HOST_ID, 'Hi there')],
      },
    });

    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.conversations).toHaveLength(2);
  });

  it('?archived=true returns COMPLETED and CANCELLED booking conversations', async () => {
    setupMocks({
      spotterBookings: [
        confirmedBooking('b1', USER_ID, HOST_ID, 'CONFIRMED'),
        confirmedBooking('b3', USER_ID, HOST_ID, 'COMPLETED'),
        confirmedBooking('b4', USER_ID, HOST_ID, 'CANCELLED'),
      ],
      userProfiles: {
        [HOST_ID]: userProfile(HOST_ID, 'Marc Dupont'),
      },
      listings: {
        [LISTING_ID]: listingItem(LISTING_ID, '12 Rue de Rivoli, Paris'),
      },
      lastMessages: {},
    });

    const res = await handler(makeEvent(USER_ID, { archived: 'true' }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.conversations).toHaveLength(2);
    expect(body.conversations.every((c: any) => ['COMPLETED', 'CANCELLED'].includes(c.bookingStatus))).toBe(true);
  });

  it('conversations sorted by lastMessageAt descending', async () => {
    setupMocks({
      spotterBookings: [
        confirmedBooking('b1', USER_ID, HOST_ID, 'CONFIRMED'),
        confirmedBooking('b2', USER_ID, HOST_ID, 'ACTIVE'),
      ],
      userProfiles: {
        [HOST_ID]: userProfile(HOST_ID, 'Marc Dupont'),
      },
      listings: {
        [LISTING_ID]: listingItem(LISTING_ID, '12 Rue de Rivoli, Paris'),
      },
      lastMessages: {
        b1: [chatMessage('b1', '2025-01-10T10:00:00.000Z', 'm1', HOST_ID, 'Older')],
        b2: [chatMessage('b2', '2025-01-20T10:00:00.000Z', 'm2', HOST_ID, 'Newer')],
      },
    });

    const res = await handler(makeEvent(), {} as any, () => {});
    const { conversations } = JSON.parse(res!.body);
    for (let i = 1; i < conversations.length; i++) {
      expect(new Date(conversations[i - 1].lastMessageAt).getTime()).toBeGreaterThanOrEqual(
        new Date(conversations[i].lastMessageAt).getTime()
      );
    }
  });

  it('each conversation item contains required fields', async () => {
    setupMocks({
      spotterBookings: [confirmedBooking('b1', USER_ID, HOST_ID, 'CONFIRMED')],
      userProfiles: {
        [HOST_ID]: userProfile(HOST_ID, 'Marc Dupont', 'https://cdn.spotzy.be/avatar.jpg'),
      },
      listings: {
        [LISTING_ID]: listingItem(LISTING_ID, '12 Rue de Rivoli, Paris'),
      },
      lastMessages: {
        b1: [chatMessage('b1', '2025-01-15T10:00:00.000Z', 'm1', HOST_ID, 'Hello from host')],
      },
    });

    const res = await handler(makeEvent(), {} as any, () => {});
    const { conversations } = JSON.parse(res!.body);
    const item = conversations[0];
    expect(item).toHaveProperty('bookingId');
    expect(item).toHaveProperty('listingAddress');
    expect(item).toHaveProperty('otherPartyName');
    expect(item).toHaveProperty('otherPartyPhotoUrl');
    expect(item).toHaveProperty('lastMessagePreview');
    expect(item).toHaveProperty('lastMessageAt');
    expect(item).toHaveProperty('unreadCount');
  });

  it('otherPartyName formatted as first name + last initial only', async () => {
    setupMocks({
      spotterBookings: [confirmedBooking('b1', USER_ID, HOST_ID, 'CONFIRMED')],
      userProfiles: {
        [HOST_ID]: userProfile(HOST_ID, 'Marc Dupont'),
      },
      listings: {
        [LISTING_ID]: listingItem(LISTING_ID, '12 Rue de Rivoli, Paris'),
      },
      lastMessages: {
        b1: [chatMessage('b1', '2025-01-15T10:00:00.000Z', 'm1', HOST_ID, 'Hello')],
      },
    });

    const res = await handler(makeEvent(), {} as any, () => {});
    const { conversations } = JSON.parse(res!.body);
    expect(conversations[0].otherPartyName).toMatch(/^[A-Z][a-z]+ [A-Z]\.$/);
  });

  it('lastMessagePreview truncated to 80 chars', async () => {
    const longMessage = 'A'.repeat(200);
    setupMocks({
      spotterBookings: [confirmedBooking('b1', USER_ID, HOST_ID, 'CONFIRMED')],
      userProfiles: {
        [HOST_ID]: userProfile(HOST_ID, 'Marc Dupont'),
      },
      listings: {
        [LISTING_ID]: listingItem(LISTING_ID, '12 Rue de Rivoli, Paris'),
      },
      lastMessages: {
        b1: [chatMessage('b1', '2025-01-15T10:00:00.000Z', 'm1', HOST_ID, longMessage)],
      },
    });

    const res = await handler(makeEvent(), {} as any, () => {});
    const { conversations } = JSON.parse(res!.body);
    expect(conversations[0].lastMessagePreview.length).toBeLessThanOrEqual(80);
  });

  it('unauthenticated → 401', async () => {
    const event = {
      ...makeEvent(),
      requestContext: { authorizer: {} },
    } as unknown as APIGatewayProxyEvent;
    const res = await handler(event, {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });
});
