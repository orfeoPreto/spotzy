import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/chat/get/index';
import { mockAuthContext } from '../setup';
import { buildBooking } from '../factories/booking.factory';

const ddbMock = mockClient(DynamoDBDocumentClient);

const BOOKING_ID = 'booking-chat-get';
const SPOTTER_ID = 'spotter-get-1';
const HOST_ID = 'host-get-1';

const confirmedBooking = {
  ...buildBooking({ bookingId: BOOKING_ID, spotterId: SPOTTER_ID, hostId: HOST_ID, status: 'CONFIRMED' }),
  PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA',
};

const messages = [
  { PK: `CHAT#${BOOKING_ID}`, SK: 'MSG#2025-01-01T10:00:00.000Z#m1', content: 'First', senderId: SPOTTER_ID },
  { PK: `CHAT#${BOOKING_ID}`, SK: 'MSG#2025-01-01T11:00:00.000Z#m2', content: 'Second', senderId: HOST_ID },
];

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: confirmedBooking });
  ddbMock.on(QueryCommand).resolves({ Items: messages });
  ddbMock.on(DeleteCommand).resolves({});
});

const makeEvent = (auth = mockAuthContext(SPOTTER_ID)): APIGatewayProxyEvent =>
  ({ ...auth, body: null, pathParameters: { bookingId: BOOKING_ID }, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false, path: `/chat/${BOOKING_ID}`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('chat-get', () => {
  it('spotter requests → 200 with messages sorted ascending by SK', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].SK < body.messages[1].SK).toBe(true);
  });

  it('host requests → 200', async () => {
    const res = await handler(makeEvent(mockAuthContext(HOST_ID)), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('unrelated user → 403', async () => {
    const res = await handler(makeEvent(mockAuthContext('stranger')), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });

  it('no messages → { messages: [], bookingId }', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(JSON.parse(res!.body)).toEqual({ messages: [], bookingId: BOOKING_ID });
  });

  it('clears unread count for requesting user on chat open', async () => {
    await handler(makeEvent(), {} as any, () => {});
    const deleteCalls = ddbMock.commandCalls(DeleteCommand);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].args[0].input.Key).toEqual({
      PK: `USER#${SPOTTER_ID}`,
      SK: `UNREAD#${BOOKING_ID}`,
    });
  });
});
