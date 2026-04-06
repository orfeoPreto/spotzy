import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';

const mockGenerateSummary = jest.fn();
jest.mock('../../functions/disputes/shared/ai-summarize', () => ({
  generateEscalationSummary: (...args: unknown[]) => mockGenerateSummary(...args),
}));

import { handler } from '../../functions/disputes/escalate/index';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

const DISPUTE_ID = 'dispute-escalate-test';
const openDispute = {
  PK: `DISPUTE#${DISPUTE_ID}`, SK: 'METADATA',
  disputeId: DISPUTE_ID, status: 'OPEN', requiresEscalation: true,
  hostId: 'host-1', spotterId: 'spotter-1', bookingId: 'booking-1',
};

const booking = {
  PK: 'BOOKING#booking-1', SK: 'METADATA',
  bookingId: 'booking-1', listingAddress: '10 Rue de Rivoli',
  startTime: '2026-04-01T10:00:00Z', endTime: '2026-04-01T12:00:00Z',
};

const hostProfile = { PK: 'USER#host-1', SK: 'PROFILE', displayName: 'HostAlice' };
const guestProfile = { PK: 'USER#spotter-1', SK: 'PROFILE', displayName: 'GuestBob' };

const chatMessages = [
  { PK: `DISPUTE#${DISPUTE_ID}`, SK: 'MSG#2026-04-01T10:01:00Z', authorId: 'spotter-1', content: 'The spot was blocked by a truck' },
  { PK: `DISPUTE#${DISPUTE_ID}`, SK: 'MSG#2026-04-01T10:02:00Z', authorId: 'SYSTEM', content: 'We understand your concern.' },
];

const makeEvent = (disputeId = DISPUTE_ID): APIGatewayProxyEvent =>
  ({
    requestContext: { requestId: 'req-1' },
    body: null,
    pathParameters: { id: disputeId },
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: `/disputes/${disputeId}/escalate`,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  mockGenerateSummary.mockReset();

  ddbMock.on(GetCommand, { Key: { PK: `DISPUTE#${DISPUTE_ID}`, SK: 'METADATA' } }).resolves({ Item: openDispute });
  ddbMock.on(GetCommand, { Key: { PK: 'BOOKING#booking-1', SK: 'METADATA' } }).resolves({ Item: booking });
  ddbMock.on(GetCommand, { Key: { PK: 'USER#host-1', SK: 'PROFILE' } }).resolves({ Item: hostProfile });
  ddbMock.on(GetCommand, { Key: { PK: 'USER#spotter-1', SK: 'PROFILE' } }).resolves({ Item: guestProfile });
  ddbMock.on(QueryCommand).resolves({ Items: chatMessages });
  ddbMock.on(UpdateCommand).resolves({});
  ebMock.on(PutEventsCommand).resolves({});

  mockGenerateSummary.mockResolvedValue('Guest reports spot was inaccessible. Bot attempted resolution but guest rejected.');
});

describe('dispute-escalate', () => {
  it('OPEN dispute → ESCALATED with AI summary, escalatedAt set, EB emitted', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.status).toBe('ESCALATED');
    expect(body.escalationSummary).toContain('Guest reports');

    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(vals[':s']).toBe('ESCALATED');
    expect(vals[':summary']).toContain('Guest reports');
    expect(ebMock.commandCalls(PutEventsCommand)[0].args[0].input.Entries![0].DetailType).toBe('dispute.escalated');
  });

  it('generates AI escalation summary with chat history context', async () => {
    await handler(makeEvent(), {} as any, () => {});
    expect(mockGenerateSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        disputeId: DISPUTE_ID,
        chatHistory: expect.arrayContaining([
          expect.objectContaining({ text: 'The spot was blocked by a truck' }),
        ]),
      }),
    );
  });

  it('already ESCALATED → no-op, no EB event', async () => {
    ddbMock.on(GetCommand, { Key: { PK: `DISPUTE#${DISPUTE_ID}`, SK: 'METADATA' } }).resolves({ Item: { ...openDispute, status: 'ESCALATED' } });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
  });

  it('escalation proceeds even if AI summary fails — summary set to null', async () => {
    mockGenerateSummary.mockRejectedValue(new Error('Bedrock timeout'));
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(vals[':summary']).toBeNull();
  });
});
