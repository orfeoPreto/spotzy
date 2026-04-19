import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/chat/send/index';
import { mockAuthContext } from '../setup';
import { buildBooking } from '../factories/booking.factory';

const ddbMock = mockClient(DynamoDBDocumentClient);
const apigwMock = mockClient(ApiGatewayManagementApiClient);

const BOOKING_ID = 'booking-chat-test';
const SPOTTER_ID = 'spotter-chat-1';
const HOST_ID = 'host-chat-1';

const confirmedBooking = {
  ...buildBooking({ bookingId: BOOKING_ID, spotterId: SPOTTER_ID, hostId: HOST_ID, status: 'CONFIRMED' }),
  PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA',
};

const hostConnection = { PK: `USER#${HOST_ID}`, SK: 'CONNECTION#conn-host-1', connectionId: 'conn-host-1' };
const spotterConnection = { PK: `USER#${SPOTTER_ID}`, SK: 'CONNECTION#conn-spot-1', connectionId: 'conn-spot-1' };

beforeEach(() => {
  ddbMock.reset();
  apigwMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: confirmedBooking });
  ddbMock.on(QueryCommand).resolves({ Items: [hostConnection] }); // recipient connections
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});
  apigwMock.on(PostToConnectionCommand).resolves({});
});

const makeEvent = (body: object, auth = mockAuthContext(SPOTTER_ID)): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify({ bookingId: BOOKING_ID, ...body }), pathParameters: { bookingId: BOOKING_ID }, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: `/chat/${BOOKING_ID}`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('chat-send', () => {
  it('valid TEXT message from spotter → 201, stored, pushed to host connection', async () => {
    const res = await handler(makeEvent({ type: 'TEXT', content: 'Hello!' }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    expect(apigwMock.commandCalls(PostToConnectionCommand)).toHaveLength(1);
  });

  it('valid message from host to spotter → stored, pushed to spotter', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [spotterConnection] });
    const res = await handler(makeEvent({ type: 'TEXT', content: 'Hi!' }, mockAuthContext(HOST_ID)), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
    expect(apigwMock.commandCalls(PostToConnectionCommand)).toHaveLength(1);
  });

  it('IMAGE message with imageUrl → stored with imageUrl', async () => {
    const res = await handler(makeEvent({ type: 'IMAGE', imageUrl: 'https://cdn.spotzy.be/img.jpg' }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.imageUrl).toBe('https://cdn.spotzy.be/img.jpg');
  });

  it('TEXT > 2000 chars → 400 MESSAGE_TOO_LONG', async () => {
    const res = await handler(makeEvent({ type: 'TEXT', content: 'x'.repeat(2001) }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('MESSAGE_TOO_LONG');
  });

  it('IMAGE without imageUrl → 400', async () => {
    const res = await handler(makeEvent({ type: 'IMAGE' }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('emoji in TEXT → stripped before storage', async () => {
    await handler(makeEvent({ type: 'TEXT', content: 'Hello 😊 world' }), {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.content).not.toContain('😊');
    expect(item.content).toContain('Hello');
  });

  it('multiple connections for recipient → pushed to all', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [hostConnection, { ...hostConnection, connectionId: 'conn-host-2', SK: 'CONNECTION#conn-host-2' }] });
    await handler(makeEvent({ type: 'TEXT', content: 'Hi' }), {} as any, () => {});
    expect(apigwMock.commandCalls(PostToConnectionCommand)).toHaveLength(2);
  });

  it('stale connection (GoneException) → connection deleted, no error', async () => {
    const goneError = Object.assign(new Error('Gone'), { name: 'GoneException' });
    apigwMock.on(PostToConnectionCommand).rejects(goneError);
    const res = await handler(makeEvent({ type: 'TEXT', content: 'Hi' }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1);
  });

  it('no active connection for recipient → 201, message stored', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(makeEvent({ type: 'TEXT', content: 'Hi' }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
  });

  it('no confirmed booking → 403 FORBIDDEN', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...confirmedBooking, status: 'CANCELLED' } });
    const res = await handler(makeEvent({ type: 'TEXT', content: 'Hi' }), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
    expect(JSON.parse(res!.body).error).toBe('FORBIDDEN');
  });

  it('missing auth → 401', async () => {
    const res = await handler(makeEvent({ type: 'TEXT', content: 'Hi' }, { requestContext: {} } as any), {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  it('DynamoDB write: PK=CHAT#{bookingId}, SK starts with MSG#', async () => {
    await handler(makeEvent({ type: 'TEXT', content: 'Hi' }), {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.PK).toBe(`CHAT#${BOOKING_ID}`);
    expect(item.SK).toMatch(/^MSG#/);
  });

  it('TTL = ~90 days from now (Unix seconds)', async () => {
    await handler(makeEvent({ type: 'TEXT', content: 'Hi' }), {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    const expectedTtl = Math.floor(Date.now() / 1000) + 90 * 86400;
    expect(item.ttl).toBeGreaterThanOrEqual(expectedTtl - 5);
    expect(item.ttl).toBeLessThanOrEqual(expectedTtl + 5);
  });

  it('read=false on write', async () => {
    await handler(makeEvent({ type: 'TEXT', content: 'Hi' }), {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.read).toBe(false);
  });

  it('increments unread count for recipient on successful send', async () => {
    await handler(makeEvent({ type: 'TEXT', content: 'Hello!' }), {} as any, () => {});
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    const input = updateCalls[0].args[0].input;
    expect(input.Key).toEqual({ PK: `USER#${HOST_ID}`, SK: `UNREAD#${BOOKING_ID}` });
    expect(input.UpdateExpression).toContain('ADD');
  });
});
