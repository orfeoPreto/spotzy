import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/disputes/escalate/index';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

const DISPUTE_ID = 'dispute-escalate-test';
const openDispute = {
  PK: `DISPUTE#${DISPUTE_ID}`, SK: 'METADATA',
  disputeId: DISPUTE_ID, status: 'OPEN', requiresEscalation: true,
  hostId: 'host-1', spotterId: 'spotter-1', bookingId: 'booking-1',
};

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: openDispute });
  ddbMock.on(UpdateCommand).resolves({});
  ebMock.on(PutEventsCommand).resolves({});
});

// This handler is triggered by EventBridge or an HTTP POST — implement as a Lambda
// For the test we'll call it as a plain APIGatewayProxyHandler
import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockAuthContext } from '../setup';

const makeEvent = (disputeId = DISPUTE_ID): APIGatewayProxyEvent =>
  ({ requestContext: {}, body: null, pathParameters: { id: disputeId }, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: `/disputes/${disputeId}/escalate`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('dispute-escalate', () => {
  it('OPEN dispute with requiresEscalation=true → ESCALATED, escalatedAt set, EB emitted', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('ESCALATED');
    expect(Object.values(vals)).toContain(true); // assignedToAgentQueue
    expect(ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0].DetailType).toBe('dispute.escalated');
  });

  it('already ESCALATED → no-op, no EB event', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...openDispute, status: 'ESCALATED' } });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });
});
