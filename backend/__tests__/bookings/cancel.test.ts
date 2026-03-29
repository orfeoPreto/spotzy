import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/bookings/cancel/index';
import { calculateRefund } from '../../functions/bookings/shared/refund-calculator';
import { mockAuthContext } from '../setup';
import { buildBooking } from '../factories/booking.factory';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

const BOOKING_ID = 'booking-cancel-test';
const SPOTTER_ID = 'spotter-cancel-1';
const HOST_ID = 'host-cancel-1';

const futureBooking = buildBooking({
  bookingId: BOOKING_ID,
  spotterId: SPOTTER_ID,
  hostId: HOST_ID,
  startTime: new Date(Date.now() + 86400000 * 3).toISOString(), // 3 days from now
  totalPrice: 10.00,
  status: 'CONFIRMED',
  cancellationPolicy: { gt48h: 100, between24and48h: 50, lt24h: 0 },
});

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: { ...futureBooking, PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } });
  ddbMock.on(UpdateCommand).resolves({});
  ebMock.on(PutEventsCommand).resolves({});
});

const makeEvent = (auth = mockAuthContext(SPOTTER_ID)): APIGatewayProxyEvent =>
  ({ ...auth, body: null, pathParameters: { id: BOOKING_ID }, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: `/bookings/${BOOKING_ID}/cancel`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('calculateRefund helper', () => {
  const policy = { gt48h: 100, between24and48h: 50, lt24h: 0 };

  it('>48h before start → refundPercent=100', () => {
    const start = new Date(Date.now() + 86400000 * 3).toISOString();
    const result = calculateRefund(10.00, start, policy, 'spotter');
    expect(result.refundPercent).toBe(100);
    expect(result.refundAmount).toBe(10.00);
  });

  it('36h before start → refundPercent=50', () => {
    const start = new Date(Date.now() + 36 * 3600000).toISOString();
    const result = calculateRefund(10.00, start, policy, 'spotter');
    expect(result.refundPercent).toBe(50);
    expect(result.refundAmount).toBe(5.00);
  });

  it('12h before start → refundPercent=0', () => {
    const start = new Date(Date.now() + 12 * 3600000).toISOString();
    const result = calculateRefund(10.00, start, policy, 'spotter');
    expect(result.refundPercent).toBe(0);
    expect(result.refundAmount).toBe(0);
  });

  it('after booking has started → refundPercent=0', () => {
    const start = new Date(Date.now() - 3600000).toISOString();
    const result = calculateRefund(10.00, start, policy, 'spotter');
    expect(result.refundPercent).toBe(0);
  });

  it('host cancels → refundPercent=100 always', () => {
    const start = new Date(Date.now() + 3600000).toISOString();
    const result = calculateRefund(10.00, start, policy, 'host');
    expect(result.refundPercent).toBe(100);
  });
});

describe('booking-cancel handler', () => {
  it('valid cancellation → 200, status CANCELLED, EventBridge emitted', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.status).toBe('CANCELLED');
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(1);
    expect(ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0].DetailType).toBe('booking.cancelled');
  });

  it('EventBridge payload includes refundAmount', async () => {
    await handler(makeEvent(), {} as any, () => {});
    const detail = JSON.parse(ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0].Detail!);
    expect(detail.refundAmount).toBeDefined();
  });

  it('COMPLETED booking → 400 CANNOT_CANCEL_COMPLETED', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...futureBooking, status: 'COMPLETED', PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('CANNOT_CANCEL_COMPLETED');
  });

  it('already CANCELLED → 400 ALREADY_CANCELLED', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...futureBooking, status: 'CANCELLED', PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('ALREADY_CANCELLED');
  });

  it('unrelated user → 403', async () => {
    const res = await handler(makeEvent(mockAuthContext('stranger')), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });
});
