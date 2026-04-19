import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { getHandler, putHandler } from '../../functions/listings/availability/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const LISTING_ID = 'listing_01HX5678';
const HOST_ID = 'user_01HX1234';
const OTHER_USER_ID = 'user_other';

const makeListing = (overrides: Record<string, unknown> = {}) => ({
  listingId: LISTING_ID,
  hostId: HOST_ID,
  status: 'live',
  ...overrides,
});

const makeAlwaysRule = () => ({
  PK: `LISTING#${LISTING_ID}`, SK: 'AVAIL_RULE#r1',
  ruleId: 'r1', listingId: LISTING_ID, type: 'ALWAYS',
  daysOfWeek: [], startTime: '', endTime: '',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});

const makeWeeklyRule = (overrides: Record<string, unknown> = {}) => ({
  PK: `LISTING#${LISTING_ID}`, SK: 'AVAIL_RULE#r2',
  ruleId: 'r2', listingId: LISTING_ID, type: 'WEEKLY',
  daysOfWeek: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '18:00',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeGetEvent = (listingId: string, qs: Record<string, string> = {}): APIGatewayProxyEvent =>
  ({
    pathParameters: { id: listingId },
    queryStringParameters: qs,
    headers: {},
    body: null,
    requestContext: { requestId: 'test' },
  } as unknown as APIGatewayProxyEvent);

const makePutEvent = (listingId: string, userId: string, body: unknown): APIGatewayProxyEvent =>
  ({
    pathParameters: { id: listingId },
    body: JSON.stringify(body),
    headers: {},
    queryStringParameters: {},
    requestContext: {
      requestId: 'test',
      authorizer: { claims: { sub: userId, email: 'test@spotzy.be' } },
    },
  } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
});

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------
describe('GET /api/v1/listings/{id}/availability', () => {
  test('returns all AVAIL_RULE records for the listing', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });
    ddbMock.on(QueryCommand).resolves({ Items: [makeWeeklyRule()] });

    const res = await getHandler(makeGetEvent(LISTING_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.listingId).toBe(LISTING_ID);
    expect(body.rules).toHaveLength(1);
    expect(body.type).toBe('WEEKLY');
  });

  test('public access — no auth required', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });
    ddbMock.on(QueryCommand).resolves({ Items: [makeAlwaysRule()] });

    const event = makeGetEvent(LISTING_ID);
    // no authorizer in requestContext
    const res = await getHandler(event, {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  test('listing not found → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const res = await getHandler(makeGetEvent('nonexistent'), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  test('listing with no rules → returns empty rules array and type NONE', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await getHandler(makeGetEvent(LISTING_ID), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.rules).toHaveLength(0);
    expect(body.type).toBe('NONE');
  });

  test('listing with ALWAYS rule → type is ALWAYS', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });
    ddbMock.on(QueryCommand).resolves({ Items: [makeAlwaysRule()] });

    const res = await getHandler(makeGetEvent(LISTING_ID), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.type).toBe('ALWAYS');
  });
});

// ---------------------------------------------------------------------------
// PUT handler
// ---------------------------------------------------------------------------
describe('PUT /api/v1/listings/{id}/availability', () => {
  test('ALWAYS type — creates single ALWAYS rule, replaces previous rules', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });
    // First query returns existing rules, second returns the new ones after save
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [makeWeeklyRule()] })
      .resolvesOnce({ Items: [makeAlwaysRule()] });
    ddbMock.on(BatchWriteCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    const res = await putHandler(
      makePutEvent(LISTING_ID, HOST_ID, { type: 'ALWAYS' }),
      {} as any,
      () => {},
    );
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.type).toBe('ALWAYS');
  });

  test('WEEKLY type — saves multiple rules correctly', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [] })           // booking conflict check (live listing)
      .resolvesOnce({ Items: [] })           // fetchRules in replaceRules (existing rules to delete)
      .resolvesOnce({ Items: [makeWeeklyRule()] }); // fetchRules at end (return new rules)
    ddbMock.on(BatchWriteCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    const res = await putHandler(
      makePutEvent(LISTING_ID, HOST_ID, {
        type: 'WEEKLY',
        rules: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '18:00' }],
      }),
      {} as any,
      () => {},
    );
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.type).toBe('WEEKLY');
  });

  test('overlapping rules on same day → 400 OVERLAPPING_RULES', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });

    const res = await putHandler(
      makePutEvent(LISTING_ID, HOST_ID, {
        type: 'WEEKLY',
        rules: [
          { daysOfWeek: [1], startTime: '08:00', endTime: '12:00' },
          { daysOfWeek: [1], startTime: '10:00', endTime: '14:00' }, // overlaps
        ],
      }),
      {} as any,
      () => {},
    );
    expect(res!.statusCode).toBe(400);
    const body = JSON.parse(res!.body);
    expect(body.error).toBe('OVERLAPPING_RULES');
  });

  test('endTime before startTime → 400 INVALID_TIME_RANGE', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });

    const res = await putHandler(
      makePutEvent(LISTING_ID, HOST_ID, {
        type: 'WEEKLY',
        rules: [{ daysOfWeek: [1], startTime: '14:00', endTime: '08:00' }],
      }),
      {} as any,
      () => {},
    );
    expect(res!.statusCode).toBe(400);
    const body = JSON.parse(res!.body);
    expect(body.error).toBe('INVALID_TIME_RANGE');
  });

  test('no rules provided with WEEKLY type → 400 NO_RULES_PROVIDED', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });

    const res = await putHandler(
      makePutEvent(LISTING_ID, HOST_ID, { type: 'WEEKLY', rules: [] }),
      {} as any,
      () => {},
    );
    expect(res!.statusCode).toBe(400);
    const body = JSON.parse(res!.body);
    expect(body.error).toBe('NO_RULES_PROVIDED');
  });

  test('more than 14 rules → 400 TOO_MANY_RULES', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });
    const rules = Array.from({ length: 15 }, (_, i) => ({
      daysOfWeek: [i % 7], startTime: '08:00', endTime: '09:00',
    }));

    const res = await putHandler(
      makePutEvent(LISTING_ID, HOST_ID, { type: 'WEEKLY', rules }),
      {} as any,
      () => {},
    );
    expect(res!.statusCode).toBe(400);
    const body = JSON.parse(res!.body);
    expect(body.error).toBe('TOO_MANY_RULES');
  });

  test('not the listing owner → 403', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });

    const res = await putHandler(
      makePutEvent(LISTING_ID, OTHER_USER_ID, { type: 'ALWAYS' }),
      {} as any,
      () => {},
    );
    expect(res!.statusCode).toBe(403);
  });

  test('unauthenticated → 401', async () => {
    const event = makeGetEvent(LISTING_ID);
    // no authorizer
    const res = await putHandler(event as any, {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  test('LIVE listing with WEEKLY rule, switching to ALWAYS (expansion) → 200 allowed', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing({ status: 'live' }) });
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [makeWeeklyRule()] })
      .resolvesOnce({ Items: [makeAlwaysRule()] });
    ddbMock.on(BatchWriteCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    const res = await putHandler(
      makePutEvent(LISTING_ID, HOST_ID, { type: 'ALWAYS' }),
      {} as any,
      () => {},
    );
    expect(res!.statusCode).toBe(200);
  });

  test('LIVE listing reducing availability with confirmed booking → 409 BOOKING_CONFLICT', async () => {
    const futureBooking = {
      bookingId: 'b1',
      startTime: '2026-04-19T09:00:00Z', // Saturday — outside Mon-Fri
      endTime: '2026-04-19T11:00:00Z',
      status: 'CONFIRMED',
    };

    ddbMock.on(GetCommand).resolves({ Item: makeListing({ status: 'live' }) });
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [futureBooking] }); // booking conflict check (active bookings)

    const res = await putHandler(
      makePutEvent(LISTING_ID, HOST_ID, {
        type: 'WEEKLY',
        rules: [{ daysOfWeek: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '18:00' }],
      }),
      {} as any,
      () => {},
    );
    expect(res!.statusCode).toBe(409);
    const body = JSON.parse(res!.body);
    expect(body.code).toBe('BOOKING_CONFLICT');
  });
});
