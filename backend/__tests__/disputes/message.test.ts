import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/disputes/message/index';
import { mockAuthContext } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

const DISPUTE_ID = 'dispute-msg-test';
const SPOTTER_ID = 'spotter-msg-1';
const HOST_ID = 'host-msg-1';

const openDispute = {
  PK: `DISPUTE#${DISPUTE_ID}`, SK: 'METADATA',
  disputeId: DISPUTE_ID, spotterId: SPOTTER_ID, hostId: HOST_ID, status: 'OPEN',
};

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: openDispute });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
});

const makeEvent = (body: object, auth = mockAuthContext(SPOTTER_ID)): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify(body), pathParameters: { id: DISPUTE_ID }, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: `/disputes/${DISPUTE_ID}/message`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('dispute-message', () => {
  it('spotter sends message → 201', async () => {
    const res = await handler(makeEvent({ content: 'My car was blocked' }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
  });

  it('host sends message → 201', async () => {
    const res = await handler(makeEvent({ content: 'I am sorry' }, mockAuthContext(HOST_ID)), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
  });

  it('"speak to human" → requiresEscalation=true set on dispute', async () => {
    await handler(makeEvent({ content: 'I want to speak to a human please' }), {} as any, () => {});
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain(true);
  });

  it('"refund" + "damage" → requiresEscalation=true', async () => {
    await handler(makeEvent({ content: 'I want a refund for the damage to my car' }), {} as any, () => {});
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });

  it('unrelated user → 403', async () => {
    const res = await handler(makeEvent({ content: 'test' }, mockAuthContext('stranger')), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });
});
