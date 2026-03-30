import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/disputes/create/index';
import { mockAuthContext } from '../setup';
import { buildBooking } from '../factories/booking.factory';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

const BOOKING_ID = 'booking-dispute-test';
const SPOTTER_ID = 'spotter-dispute-1';
const HOST_ID = 'host-dispute-1';

const activeBooking = {
  ...buildBooking({ bookingId: BOOKING_ID, spotterId: SPOTTER_ID, hostId: HOST_ID, status: 'ACTIVE' }),
  PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA',
};

const recentlyCompleted = {
  ...activeBooking,
  status: 'COMPLETED',
  completedAt: new Date(Date.now() - 24 * 3600000).toISOString(), // 24h ago
};

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: activeBooking });
  ddbMock.on(QueryCommand).resolves({ Items: [] }); // no existing dispute
  ddbMock.on(PutCommand).resolves({});
  ebMock.on(PutEventsCommand).resolves({});
});

const makeEvent = (body: object, auth = mockAuthContext(SPOTTER_ID)): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify({ bookingId: BOOKING_ID, ...body }), pathParameters: null, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: '/disputes', multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('dispute-create', () => {
  it('ACTIVE booking → 201, status=OPEN, referenceNumber returned', async () => {
    const res = await handler(makeEvent({ reason: 'spot was blocked' }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
    const body = JSON.parse(res!.body);
    expect(body.status).toBe('OPEN');
    expect(body.referenceNumber).toBeDefined();
    expect(body.referenceNumber).toHaveLength(8);
  });

  it('EventBridge dispute.created emitted', async () => {
    await handler(makeEvent({ reason: 'spot was blocked' }), {} as any, () => {});
    expect(ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0].DetailType).toBe('dispute.created');
  });

  it('initial description stored as first dispute message record', async () => {
    await handler(makeEvent({ reason: 'spot was blocked' }), {} as any, () => {});
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(2); // dispute + message
  });

  it('COMPLETED within 48h → 201', async () => {
    ddbMock.on(GetCommand).resolves({ Item: recentlyCompleted });
    const res = await handler(makeEvent({ reason: 'car scratched' }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
  });

  it('COMPLETED > 7 days ago → 400 DISPUTE_WINDOW_EXPIRED', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...recentlyCompleted, completedAt: new Date(Date.now() - 8 * 24 * 3600000).toISOString() } });
    const res = await handler(makeEvent({ reason: 'car scratched' }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('DISPUTE_WINDOW_EXPIRED');
  });

  it('open dispute already exists → 409 DISPUTE_ALREADY_OPEN', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ disputeId: 'existing', status: 'OPEN' }] });
    const res = await handler(makeEvent({ reason: 'test' }), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    expect(res!.body).toContain('DISPUTE_ALREADY_OPEN');
  });

  it('unrelated user → 403', async () => {
    const res = await handler(makeEvent({ reason: 'test' }, mockAuthContext('stranger')), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });
});
