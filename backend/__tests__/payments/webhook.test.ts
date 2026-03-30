import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SchedulerClient, CreateScheduleCommand } from '@aws-sdk/client-scheduler';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/payments/webhook/index';
import { buildBooking } from '../factories/booking.factory';

const mockConstructEvent = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    paymentIntents: { create: jest.fn(), capture: jest.fn(), cancel: jest.fn() },
    refunds: { create: jest.fn() },
    accounts: { create: jest.fn() },
    accountLinks: { create: jest.fn() },
    webhooks: { constructEvent: mockConstructEvent },
  }))
);

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: 'whsec_test_mock' }),
  })),
  GetSecretValueCommand: jest.fn(),
}));

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);
const schedulerMock = mockClient(SchedulerClient);

const BOOKING_ID = 'booking-webhook-test';
const booking = {
  ...buildBooking({ bookingId: BOOKING_ID, status: 'PENDING_PAYMENT' }),
  PK: `BOOKING#${BOOKING_ID}`,
  SK: 'METADATA',
};

const makeStripeEvent = (type: string, data: object) => ({
  id: `evt_test_${type}`,
  type,
  data: { object: data },
});

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  schedulerMock.reset();
  ebMock.on(PutEventsCommand).resolves({});
  schedulerMock.on(CreateScheduleCommand).resolves({});
  ddbMock.on(GetCommand).resolves({ Item: booking });
  ddbMock.on(UpdateCommand).resolves({});
  mockConstructEvent.mockReturnValue(makeStripeEvent('payment_intent.succeeded', {
    id: 'pi_test', metadata: { bookingId: BOOKING_ID }, charges: { data: [{ id: 'ch_test' }] },
  }));
});

const makeEvent = (body: object, sig = 'valid-sig'): APIGatewayProxyEvent =>
  ({ requestContext: {}, body: JSON.stringify(body), headers: { 'stripe-signature': sig }, multiValueHeaders: {}, pathParameters: null, queryStringParameters: null, httpMethod: 'POST', isBase64Encoded: false, path: '/payments/webhook', multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('payment-webhook', () => {
  it('valid signature + payment_intent.succeeded → 200, booking CONFIRMED', async () => {
    const res = await handler(makeEvent({}), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const update = ddbMock.commandCalls(UpdateCommand)[0];
    const vals = update.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('CONFIRMED');
  });

  it('paidAt and stripeChargeId stored', async () => {
    await handler(makeEvent({}), {} as any, () => {});
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('ch_test');
    expect(Object.values(vals).some(v => typeof v === 'string' && v.match(/^\d{4}-/))).toBe(true);
  });

  it('invalid signature → 400, no DynamoDB update', async () => {
    mockConstructEvent.mockImplementation(() => { throw new Error('Signature mismatch'); });
    const res = await handler(makeEvent({}), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('missing stripe-signature header → 400', async () => {
    const event = makeEvent({});
    (event.headers as Record<string, string>)['stripe-signature'] = '';
    const res = await handler(event, {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('payment_intent.payment_failed → booking PAYMENT_FAILED, reason stored', async () => {
    mockConstructEvent.mockReturnValue(makeStripeEvent('payment_intent.payment_failed', {
      id: 'pi_test', metadata: { bookingId: BOOKING_ID }, last_payment_error: { message: 'insufficient_funds' },
    }));
    const res = await handler(makeEvent({}), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('PAYMENT_FAILED');
    expect(Object.values(vals)).toContain('insufficient_funds');
  });

  it('refund.created → refundStatus PROCESSED stored', async () => {
    mockConstructEvent.mockReturnValue(makeStripeEvent('refund.created', {
      id: 'ref_test', payment_intent: 'pi_test', amount: 700,
      metadata: { bookingId: BOOKING_ID },
    }));
    const res = await handler(makeEvent({}), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const vals = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('PROCESSED');
  });

  it('unhandled event type → 200, no DynamoDB update', async () => {
    mockConstructEvent.mockReturnValue(makeStripeEvent('customer.subscription.created', {}));
    const res = await handler(makeEvent({}), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('payment_intent.succeeded delivered twice → second is no-op (already CONFIRMED)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...booking, status: 'CONFIRMED' } });
    const res = await handler(makeEvent({}), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});
