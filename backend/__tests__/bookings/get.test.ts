import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/bookings/get/index';
import { mockAuthContext } from '../setup';
import { buildBooking } from '../factories/booking.factory';

const ddbMock = mockClient(DynamoDBDocumentClient);

const BOOKING_ID = 'booking-test-123';
const SPOTTER_ID = 'spotter-test-1';
const HOST_ID = 'host-test-1';
const booking = buildBooking({ bookingId: BOOKING_ID, spotterId: SPOTTER_ID, hostId: HOST_ID });

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: { ...booking, PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA' } });
});

const makeEvent = (id: string, auth: any): APIGatewayProxyEvent =>
  ({ ...auth, body: null, pathParameters: { id }, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false, path: `/bookings/${id}`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('booking-get', () => {
  it('spotter of booking → 200', async () => {
    const res = await handler(makeEvent(BOOKING_ID, mockAuthContext(SPOTTER_ID)), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(JSON.parse(res!.body).bookingId).toBe(BOOKING_ID);
  });

  it('host of listing → 200', async () => {
    const res = await handler(makeEvent(BOOKING_ID, mockAuthContext(HOST_ID)), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('unrelated user → 403', async () => {
    const res = await handler(makeEvent(BOOKING_ID, mockAuthContext('unrelated-user')), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });

  it('missing auth → 401', async () => {
    const res = await handler(makeEvent(BOOKING_ID, { requestContext: {} } as any), {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  it('non-existent booking → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(makeEvent('nonexistent', mockAuthContext(SPOTTER_ID)), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });
});
