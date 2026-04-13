import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/bookings/create/index';
import { mockAuthContext, TEST_USER_ID } from '../setup';
import { buildListing } from '../factories/listing.factory';
import { buildBooking } from '../factories/booking.factory';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

const LISTING_ID = 'listing-test-123';
const listing = buildListing({ listingId: LISTING_ID, hostId: 'host-1', status: 'live' });

const tomorrow = new Date(Date.now() + 86400000);
const tomorrowPlus2h = new Date(Date.now() + 86400000 + 7200000);

const validBody = {
  listingId: LISTING_ID,
  startTime: tomorrow.toISOString(),
  endTime: tomorrowPlus2h.toISOString(),
  idempotencyKey: 'idem-key-1',
};

const makeEvent = (body: object, auth = mockAuthContext()): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify(body), pathParameters: null, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: '/bookings', multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

const alwaysRule = {
  PK: `LISTING#${LISTING_ID}`, SK: 'AVAIL_RULE#r1',
  ruleId: 'r1', listingId: LISTING_ID, type: 'ALWAYS',
  daysOfWeek: [], startTime: '', endTime: '',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  // listing fetch
  ddbMock.on(GetCommand).resolves({ Item: { ...listing, PK: `LISTING#${LISTING_ID}`, SK: 'METADATA' } });
  // queries: idempotency (empty), availability rules (ALWAYS), blocks (empty), legacy bookings (empty)
  ddbMock.on(QueryCommand)
    .resolvesOnce({ Items: [] })           // idempotency check
    .resolvesOnce({ Items: [alwaysRule] }) // availability rules
    .resolvesOnce({ Items: [] })           // blocks
    .resolvesOnce({ Items: [] });          // legacy bookings
  ddbMock.on(PutCommand).resolves({});
  ebMock.on(PutEventsCommand).resolves({});
});

describe('booking-create', () => {
  it('valid booking → 201, status=PENDING_PAYMENT, bookingId generated', async () => {
    const res = await handler(makeEvent(validBody), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
    const body = JSON.parse(res!.body);
    expect(body.bookingId).toBeDefined();
    expect(body.status).toBe('PENDING_PAYMENT');
  });

  it('totalPrice uses spotterGrossTotalEur from breakdown (2h at €3.50/hr + fees + VAT)', async () => {
    const res = await handler(makeEvent(validBody), {} as any, () => {});
    const body = JSON.parse(res!.body);
    // EXEMPT_FRANCHISE host: 2h × €3.50 = €7.00 net, + 15% platform fee gross-up + 21% VAT on fee
    expect(body.totalPrice).toBe(8.50);
    expect(body.priceBreakdown).toBeDefined();
    expect(body.priceBreakdown.hostNetTotalEur).toBe(7.00);
    expect(body.priceBreakdown.spotterGrossTotalEur).toBe(8.50);
  });

  it('hostPayout = totalPrice × 0.85', async () => {
    const res = await handler(makeEvent(validBody), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.hostPayout).toBeCloseTo(5.95, 2);
  });

  it('cancellation policy stored on booking', async () => {
    const res = await handler(makeEvent(validBody), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.cancellationPolicy).toBeDefined();
  });

  it('EventBridge booking.created emitted with correct payload', async () => {
    await handler(makeEvent(validBody), {} as any, () => {});
    const calls = ebMock.commandCalls(PutEventsCommand);
    expect(calls).toHaveLength(1);
    const entry = calls[0].args[0].input.Entries![0];
    expect(entry.DetailType).toBe('booking.created');
    const detail = JSON.parse(entry.Detail!);
    expect(detail.listingId).toBe(LISTING_ID);
  });

  it('DynamoDB writes BOOKING#{id} METADATA + LISTING#{listingId} BOOKING#{id}', async () => {
    await handler(makeEvent(validBody), {} as any, () => {});
    const puts = ddbMock.commandCalls(PutCommand);
    expect(puts).toHaveLength(2);
    const pks = puts.map(p => (p.args[0].input.Item as any).PK as string);
    expect(pks.some(pk => pk.startsWith('BOOKING#'))).toBe(true);
    expect(pks.some(pk => pk.startsWith('LISTING#'))).toBe(true);
  });

  it('same idempotencyKey twice → second returns 200 with existing booking', async () => {
    const existingBooking = buildBooking({ idempotencyKey: validBody.idempotencyKey, spotterId: TEST_USER_ID });
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [{ ...existingBooking, PK: `BOOKING#${existingBooking.bookingId}`, SK: 'METADATA', idempotencyKey: validBody.idempotencyKey }] }); // idempotency check matches
    const res = await handler(makeEvent(validBody), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('CONFIRMED booking overlapping → 409 SPOT_UNAVAILABLE', async () => {
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [] })           // idempotency
      .resolvesOnce({ Items: [alwaysRule] }) // rules
      .resolvesOnce({ Items: [] })           // blocks
      .resolvesOnce({ Items: [buildBooking({ status: 'CONFIRMED', startTime: validBody.startTime, endTime: validBody.endTime })] }); // legacy bookings
    const res = await handler(makeEvent(validBody), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    expect(res!.body).toContain('SPOT_UNAVAILABLE');
  });

  it('ACTIVE booking overlapping → 409', async () => {
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [] })           // idempotency
      .resolvesOnce({ Items: [alwaysRule] }) // rules
      .resolvesOnce({ Items: [] })           // blocks
      .resolvesOnce({ Items: [buildBooking({ status: 'ACTIVE', startTime: validBody.startTime, endTime: validBody.endTime })] }); // legacy bookings
    const res = await handler(makeEvent(validBody), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
  });

  it('CANCELLED booking overlapping → allowed (201)', async () => {
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [] })           // idempotency check
      .resolvesOnce({ Items: [alwaysRule] }) // rules
      .resolvesOnce({ Items: [] })           // blocks
      .resolvesOnce({ Items: [buildBooking({ status: 'CANCELLED' })] }); // legacy bookings (CANCELLED is not blocking)
    const res = await handler(makeEvent(validBody), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
  });

  it('PENDING_PAYMENT booking overlapping → 409', async () => {
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [] })           // idempotency
      .resolvesOnce({ Items: [alwaysRule] }) // rules
      .resolvesOnce({ Items: [] })           // blocks
      .resolvesOnce({ Items: [buildBooking({ status: 'PENDING_PAYMENT', startTime: validBody.startTime, endTime: validBody.endTime })] }); // legacy bookings
    const res = await handler(makeEvent(validBody), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
  });

  it('startTime in past → 400 START_TIME_IN_PAST', async () => {
    const res = await handler(makeEvent({ ...validBody, startTime: new Date(Date.now() - 3600000).toISOString() }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('START_TIME_IN_PAST');
  });

  it('endTime before startTime → 400 INVALID_TIME_RANGE', async () => {
    const res = await handler(makeEvent({ ...validBody, endTime: new Date(Date.now() + 3600000).toISOString() }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('INVALID_TIME_RANGE');
  });

  it('duration < minDurationHours → 400 BELOW_MINIMUM_DURATION', async () => {
    const listingWith2hMin = buildListing({ listingId: LISTING_ID, minDurationHours: 3, status: 'live' });
    ddbMock.on(GetCommand).resolves({ Item: { ...listingWith2hMin, PK: `LISTING#${LISTING_ID}`, SK: 'METADATA' } });
    const res = await handler(makeEvent(validBody), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('BELOW_MINIMUM_DURATION');
  });

  it('duration > maxDurationHours → 400 EXCEEDS_MAXIMUM_DURATION', async () => {
    const listingWith1hMax = buildListing({ listingId: LISTING_ID, maxDurationHours: 1, status: 'live' });
    ddbMock.on(GetCommand).resolves({ Item: { ...listingWith1hMax, PK: `LISTING#${LISTING_ID}`, SK: 'METADATA' } });
    const res = await handler(makeEvent(validBody), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('EXCEEDS_MAXIMUM_DURATION');
  });

  it('missing auth → 401', async () => {
    const res = await handler(makeEvent(validBody, { requestContext: {} } as any), {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });
});
