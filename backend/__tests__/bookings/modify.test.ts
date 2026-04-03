import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/bookings/modify/index';
import { mockAuthContext } from '../setup';
import { buildBooking } from '../factories/booking.factory';
import { buildListing } from '../factories/listing.factory';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

const BOOKING_ID = 'booking-modify-test';
const SPOTTER_ID = 'spotter-mod-1';
const HOST_ID = 'host-mod-1';
const LISTING_ID = 'listing-mod-1';

const tomorrow = new Date(Date.now() + 86400000);
const tomorrowPlus2h = new Date(tomorrow.getTime() + 7200000);
const tomorrowPlus3h = new Date(tomorrow.getTime() + 10800000);

const booking = buildBooking({
  bookingId: BOOKING_ID,
  spotterId: SPOTTER_ID,
  hostId: HOST_ID,
  listingId: LISTING_ID,
  startTime: tomorrow.toISOString(),
  endTime: tomorrowPlus2h.toISOString(),
  totalPrice: 7.00,
  status: 'CONFIRMED',
  version: 1,
});

const listing = buildListing({ listingId: LISTING_ID, hostId: HOST_ID, pricePerHour: 3.50 });

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  ddbMock.on(GetCommand)
    .resolvesOnce({ Item: { ...booking, PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } })
    .resolvesOnce({ Item: { ...listing, PK: `LISTING#${LISTING_ID}`, SK: 'METADATA' } });
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(UpdateCommand).resolves({ Attributes: { ...booking, version: 2 } });
  ebMock.on(PutEventsCommand).resolves({});
});

const makeEvent = (body: object, auth = mockAuthContext(SPOTTER_ID)): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify(body), pathParameters: { id: BOOKING_ID }, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'PUT', isBase64Encoded: false, path: `/bookings/${BOOKING_ID}/modify`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('booking-modify', () => {
  const newStart = new Date(Date.now() + 86400000 + 3600000).toISOString(); // tomorrow + 1h offset
  const newEnd2h = new Date(Date.now() + 86400000 + 3600000 + 7200000).toISOString();
  const newEnd3h = new Date(Date.now() + 86400000 + 3600000 + 10800000).toISOString();

  it('new start time, no conflict → 200, EventBridge booking.modified emitted', async () => {
    const res = await handler(makeEvent({ newStartTime: newStart, newEndTime: newEnd2h }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const calls = ebMock.commandCalls(PutEventsCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Entries![0].DetailType).toBe('booking.modified');
  });

  it('longer duration → requiresAdditionalPayment: true + priceDifference', async () => {
    const res = await handler(makeEvent({ newStartTime: newStart, newEndTime: newEnd3h }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.requiresAdditionalPayment).toBe(true);
    expect(body.priceDifference).toBeGreaterThan(0);
  });

  it('shorter duration → pendingRefundAmount in response', async () => {
    // Shorten from 2h to 1h
    const newEnd1h = new Date(new Date(newStart).getTime() + 3600000).toISOString();
    const res = await handler(makeEvent({ newStartTime: newStart, newEndTime: newEnd1h }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.pendingRefundAmount).toBeGreaterThan(0);
  });

  it('booking status ACTIVE + start time changed → 400 CANNOT_CHANGE_START_ACTIVE', async () => {
    ddbMock.on(GetCommand)
      .resolvesOnce({ Item: { ...booking, status: 'ACTIVE', PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } })
      .resolvesOnce({ Item: { ...listing, PK: `LISTING#${LISTING_ID}`, SK: 'METADATA' } });
    const res = await handler(makeEvent({ newStartTime: newStart, newEndTime: newEnd2h }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('CANNOT_CHANGE_START_ACTIVE');
  });

  it('booking status ACTIVE + only end time changed → 200 allowed', async () => {
    const activeBooking = { ...booking, status: 'ACTIVE', PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' };
    ddbMock.on(GetCommand)
      .resolvesOnce({ Item: activeBooking })
      .resolvesOnce({ Item: { ...listing, PK: `LISTING#${LISTING_ID}`, SK: 'METADATA' } });
    const res = await handler(makeEvent({ newStartTime: booking.startTime, newEndTime: newEnd3h }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('new start < 2h from now → 400 TOO_CLOSE_TO_START', async () => {
    const tooSoon = new Date(Date.now() + 3600000).toISOString(); // 1h from now
    const tooSoonEnd = new Date(Date.now() + 3600000 + 7200000).toISOString();
    const res = await handler(makeEvent({ newStartTime: tooSoon, newEndTime: tooSoonEnd }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('TOO_CLOSE_TO_START');
  });

  it('new start in past → 400', async () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    const pastEnd = new Date(Date.now() + 3600000).toISOString();
    ddbMock.on(GetCommand)
      .resolvesOnce({ Item: { ...booking, PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } })
      .resolvesOnce({ Item: { ...listing, PK: `LISTING#${LISTING_ID}`, SK: 'METADATA' } });
    const res = await handler(makeEvent({ newStartTime: past, newEndTime: pastEnd }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('new time creates conflict → 409 SLOT_UNAVAILABLE', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [buildBooking({ status: 'CONFIRMED', startTime: newStart, endTime: newEnd2h })] });
    const res = await handler(makeEvent({ newStartTime: newStart, newEndTime: newEnd2h }), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    expect(res!.body).toContain('SLOT_UNAVAILABLE');
  });
});
