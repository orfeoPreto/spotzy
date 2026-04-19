import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/admin/dispute-resolve/index';

jest.mock('stripe', () => {
  const refundsCreate = jest.fn().mockResolvedValue({ id: 're_123' });
  return jest.fn().mockImplementation(() => ({
    refunds: { create: refundsCreate },
  }));
});

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

const dispute = {
  PK: 'DISPUTE#d1', SK: 'METADATA',
  disputeId: 'd1', bookingId: 'b1', status: 'ESCALATED',
  hostId: 'host-1', spotterId: 'guest-1',
};

const booking = {
  PK: 'BOOKING#b1', SK: 'METADATA',
  bookingId: 'b1', paymentIntentId: 'pi_test123',
};

const mockAdminEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: 'admin-1', email: 'admin@spotzy.be', 'cognito:groups': 'admin' } },
      requestId: 'req-1',
    },
    body: JSON.stringify({ outcome: 'RESOLVED_FOR_GUEST', refundAmount: 5000 }),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/api/v1/admin/disputes/d1/resolve',
    pathParameters: { id: 'd1' },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  ddbMock.on(GetCommand, { Key: { PK: 'DISPUTE#d1', SK: 'METADATA' } }).resolves({ Item: dispute });
  ddbMock.on(GetCommand, { Key: { PK: 'BOOKING#b1', SK: 'METADATA' } }).resolves({ Item: booking });
  ddbMock.on(UpdateCommand).resolves({});
  ebMock.on(PutEventsCommand).resolves({});
});

describe('admin-dispute-resolve', () => {
  it('sets dispute status to RESOLVED with outcome', async () => {
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const vals = updateCalls[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(vals[':status']).toBe('RESOLVED');
    expect(vals[':outcome']).toBe('RESOLVED_FOR_GUEST');
  });

  it('triggers Stripe refund when refundAmount > 0', async () => {
    const Stripe = require('stripe');
    const stripeInstance = new Stripe('sk_test');
    await handler(mockAdminEvent(), {} as any, () => {});
    expect(stripeInstance.refunds.create).toHaveBeenCalledWith({
      payment_intent: 'pi_test123',
      amount: 5000,
    });
  });

  it('emits dispute.resolved event', async () => {
    await handler(mockAdminEvent(), {} as any, () => {});
    const ebCalls = ebMock.commandCalls(PutEventsCommand);
    expect(ebCalls.length).toBe(1);
    expect(ebCalls[0].args[0].input.Entries![0].DetailType).toBe('dispute.resolved');
  });

  it('non-admin returns 403', async () => {
    const event = mockAdminEvent({
      requestContext: {
        authorizer: { claims: { sub: 'user-1', email: 'u@s.com', 'cognito:groups': 'users' } },
        requestId: 'req-2',
      } as any,
    });
    const result = await handler(event, {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });

  it('no refund when refundAmount is 0', async () => {
    const Stripe = require('stripe');
    const stripeInstance = new Stripe('sk_test');
    stripeInstance.refunds.create.mockClear();
    const event = mockAdminEvent({
      body: JSON.stringify({ outcome: 'NO_ACTION', refundAmount: 0 }),
    });
    await handler(event, {} as any, () => {});
    expect(stripeInstance.refunds.create).not.toHaveBeenCalled();
  });
});
