import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/payments/payout-trigger/index';
import { buildBooking } from '../factories/booking.factory';

const mockCapture = jest.fn();
const mockRefundCreate = jest.fn();
const mockCancel = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    paymentIntents: { create: jest.fn(), capture: mockCapture, cancel: mockCancel },
    refunds: { create: mockRefundCreate },
    accounts: { create: jest.fn() },
    accountLinks: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  }))
);

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: 'sk_test_mock' }),
  })),
  GetSecretValueCommand: jest.fn(),
}));

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

const BOOKING_ID = 'booking-payout-test';
const activeBooking = {
  ...buildBooking({ bookingId: BOOKING_ID, status: 'ACTIVE', stripePaymentIntentId: 'pi_test_123', totalPrice: 7.00 }),
  PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA',
};
const confirmedBooking = { ...activeBooking, status: 'CONFIRMED' };
const pendingBooking = { ...activeBooking, status: 'PENDING_PAYMENT' };

const makeEvent = (detailType: string, detail: object): EventBridgeEvent<string, object> =>
  ({ 'detail-type': detailType, detail, source: 'spotzy', id: 'test', version: '0', account: '123', time: '', region: 'us-east-1', resources: [], 'replay-name': '' } as unknown as EventBridgeEvent<string, object>);

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: activeBooking });
  ddbMock.on(UpdateCommand).resolves({});
  ebMock.on(PutEventsCommand).resolves({});
  mockCapture.mockClear();
  mockCapture.mockResolvedValue({ id: 'pi_test_123', status: 'succeeded' });
  mockRefundCreate.mockClear();
  mockRefundCreate.mockResolvedValue({ id: 'ref_test', status: 'succeeded' });
  mockCancel.mockClear();
  mockCancel.mockResolvedValue({ id: 'pi_test_123', status: 'canceled' });
});

describe('payout-trigger — booking.completed', () => {
  it('ACTIVE booking → captured, status set to COMPLETED, payoutStatus=PROCESSING', async () => {
    await handler(makeEvent('booking.completed', { bookingId: BOOKING_ID }), {} as any, () => {});
    expect(mockCapture).toHaveBeenCalledWith('pi_test_123');
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('COMPLETED');
    expect(Object.values(vals)).toContain('PROCESSING');
  });

  it('already COMPLETED → no-op, no Stripe call', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...activeBooking, status: 'COMPLETED' } });
    await handler(makeEvent('booking.completed', { bookingId: BOOKING_ID }), {} as any, () => {});
    expect(mockCapture).not.toHaveBeenCalled();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('CANCELLED booking → no-op', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...activeBooking, status: 'CANCELLED' } });
    await handler(makeEvent('booking.completed', { bookingId: BOOKING_ID }), {} as any, () => {});
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('Stripe capture fails → payoutStatus=FAILED, no throw', async () => {
    mockCapture.mockRejectedValue(new Error('Stripe error'));
    await expect(handler(makeEvent('booking.completed', { bookingId: BOOKING_ID }), {} as any, () => {})).resolves.not.toThrow();
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('FAILED');
  });
});

describe('payout-trigger — booking.cancelled', () => {
  it('refundAmount > 0 + CONFIRMED → stripe.refunds.create called, refundStatus=PENDING', async () => {
    ddbMock.on(GetCommand).resolves({ Item: confirmedBooking });
    await handler(makeEvent('booking.cancelled', { bookingId: BOOKING_ID, refundAmount: 5.00 }), {} as any, () => {});
    expect(mockRefundCreate).toHaveBeenCalled();
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('PENDING');
  });

  it('refundAmount = 0 → no Stripe call', async () => {
    ddbMock.on(GetCommand).resolves({ Item: confirmedBooking });
    await handler(makeEvent('booking.cancelled', { bookingId: BOOKING_ID, refundAmount: 0 }), {} as any, () => {});
    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('PENDING_PAYMENT + refundAmount > 0 → paymentIntents.cancel called', async () => {
    ddbMock.on(GetCommand).resolves({ Item: pendingBooking });
    await handler(makeEvent('booking.cancelled', { bookingId: BOOKING_ID, refundAmount: 5.00 }), {} as any, () => {});
    expect(mockCancel).toHaveBeenCalledWith('pi_test_123');
    expect(mockRefundCreate).not.toHaveBeenCalled();
  });

  it('no stripePaymentIntentId → no Stripe call', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...confirmedBooking, stripePaymentIntentId: undefined } });
    await handler(makeEvent('booking.cancelled', { bookingId: BOOKING_ID, refundAmount: 5.00 }), {} as any, () => {});
    expect(mockRefundCreate).not.toHaveBeenCalled();
    expect(mockCancel).not.toHaveBeenCalled();
  });
});
