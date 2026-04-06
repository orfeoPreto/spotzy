import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

jest.mock('../../functions/disputes/shared/ai-respond', () => ({
  generateDisputeResponse: jest.fn().mockResolvedValue('Thank you for your message. Let me look into this for you.'),
}));

jest.mock('../../functions/disputes/shared/ai-summarize', () => ({
  generateEscalationSummary: jest.fn().mockResolvedValue('Dispute summary: user reported an issue.'),
}));

import { handler } from '../../functions/disputes/message/index';
import { mockAuthContext } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

const DISPUTE_ID = 'dispute-esc-test';
const SPOTTER_ID = 'spotter-esc-1';
const HOST_ID = 'host-esc-1';
const BOOKING_ID = 'booking-esc-1';

const makeDispute = (overrides: Record<string, unknown> = {}) => ({
  PK: `DISPUTE#${DISPUTE_ID}`, SK: 'METADATA',
  disputeId: DISPUTE_ID, spotterId: SPOTTER_ID, hostId: HOST_ID, bookingId: BOOKING_ID,
  status: 'OPEN', exchangeCount: 0,
  ...overrides,
});

const makeEvent = (body: object, auth = mockAuthContext(SPOTTER_ID)): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify(body), pathParameters: { id: DISPUTE_ID }, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: `/disputes/${DISPUTE_ID}/message`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: makeDispute() });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(QueryCommand).resolves({ Items: [] });
});

describe('dispute escalation', () => {
  it('escalates when user explicitly asks for human agent', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeDispute({ exchangeCount: 1 }) });
    const res = await handler(makeEvent({ content: 'I want to speak to a human agent please' }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    const escalationUpdate = updateCalls.find(c => {
      const vals = c.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
      return vals?.[':status'] === 'ESCALATED';
    });
    expect(escalationUpdate).toBeDefined();
    const vals = escalationUpdate!.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(vals[':reason']).toBe('USER_REQUESTED');
  });

  it('escalates after 3 bot exchanges (exchangeCount >= 3)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeDispute({ exchangeCount: 3 }) });
    const res = await handler(makeEvent({ content: 'Still not resolved' }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    const escalationUpdate = updateCalls.find(c => {
      const vals = c.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
      return vals?.[':status'] === 'ESCALATED';
    });
    expect(escalationUpdate).toBeDefined();
    const vals = escalationUpdate!.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(vals[':reason']).toBe('MAX_EXCHANGES_REACHED');
  });

  it('escalates when bot triage says requiresEscalation (damage keyword)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeDispute({ exchangeCount: 0 }) });
    const res = await handler(makeEvent({ content: 'My car was scratched in your parking lot' }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    const escalationUpdate = updateCalls.find(c => {
      const vals = c.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
      return vals?.[':status'] === 'ESCALATED';
    });
    expect(escalationUpdate).toBeDefined();
    const vals = escalationUpdate!.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(vals[':reason']).toBe('BOT_CANNOT_RESOLVE');
  });

  it('does NOT escalate on first exchange with resolvable issue', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeDispute({ exchangeCount: 0 }) });
    const res = await handler(makeEvent({ content: 'The spot was a bit dirty' }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    const escalationUpdate = updateCalls.find(c => {
      const vals = c.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
      return vals?.[':status'] === 'ESCALATED';
    });
    expect(escalationUpdate).toBeUndefined();
  });

  it('increments exchangeCount on non-escalated exchange', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeDispute({ exchangeCount: 1 }) });
    await handler(makeEvent({ content: 'The spot was a bit dirty' }), {} as any, () => {});

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    const countUpdate = updateCalls.find(c => {
      const vals = c.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
      return vals?.[':count'] === 2;
    });
    expect(countUpdate).toBeDefined();
  });

  it('on escalation: generates AI summary via ai-summarize', async () => {
    const { generateEscalationSummary } = require('../../functions/disputes/shared/ai-summarize');
    ddbMock.on(GetCommand).resolves({ Item: makeDispute({ exchangeCount: 3 }) });
    await handler(makeEvent({ content: 'Still unresolved' }), {} as any, () => {});
    expect(generateEscalationSummary).toHaveBeenCalled();
  });

  it('"human" keyword triggers USER_REQUESTED reason', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeDispute({ exchangeCount: 0 }) });
    await handler(makeEvent({ content: 'I need a human' }), {} as any, () => {});

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    const escalationUpdate = updateCalls.find(c => {
      const vals = c.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
      return vals?.[':status'] === 'ESCALATED';
    });
    expect(escalationUpdate).toBeDefined();
    const vals = escalationUpdate!.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(vals[':reason']).toBe('USER_REQUESTED');
  });
});
