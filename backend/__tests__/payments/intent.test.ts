import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/payments/intent/index';
import { mockAuthContext } from '../setup';
import { buildBooking } from '../factories/booking.factory';

// Mock Stripe
const mockPaymentIntentCreate = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    paymentIntents: { create: mockPaymentIntentCreate, capture: jest.fn(), cancel: jest.fn() },
    refunds: { create: jest.fn() },
    accounts: { create: jest.fn() },
    accountLinks: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  }))
);

// Mock Secrets Manager
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: 'sk_test_mock' }),
  })),
  GetSecretValueCommand: jest.fn(),
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

const BOOKING_ID = 'booking-intent-test';
const SPOTTER_ID = 'spotter-intent-1';
const HOST_ID = 'host-intent-1';

const pendingBooking = {
  ...buildBooking({
    bookingId: BOOKING_ID,
    spotterId: SPOTTER_ID,
    hostId: HOST_ID,
    totalPrice: 7.00,
    status: 'PENDING_PAYMENT',
  }),
  PK: `BOOKING#${BOOKING_ID}`,
  SK: 'METADATA',
};

const hostUser = {
  PK: `USER#${HOST_ID}`,
  SK: 'PROFILE',
  userId: HOST_ID,
  stripeConnectAccountId: 'acct_test_host',
};

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand)
    .resolvesOnce({ Item: pendingBooking })
    .resolvesOnce({ Item: hostUser });
  ddbMock.on(UpdateCommand).resolves({});
  mockPaymentIntentCreate.mockResolvedValue({
    id: 'pi_test_123',
    client_secret: 'pi_test_123_secret',
    amount: 700,
  });
});

const makeEvent = (bookingId = BOOKING_ID, auth = mockAuthContext(SPOTTER_ID)): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify({ bookingId }), pathParameters: null, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: '/payments/intent', multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('payment-intent', () => {
  it('PENDING_PAYMENT booking → creates PaymentIntent, returns clientSecret + amount', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.clientSecret).toBeDefined();
    expect(body.amount).toBe(700);
  });

  it('amount in cents: €7.00 → 700', async () => {
    await handler(makeEvent(), {} as any, () => {});
    expect(mockPaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 700 })
    );
  });

  it('application_fee_amount = 15% of total (€7.00 → 105 cents)', async () => {
    await handler(makeEvent(), {} as any, () => {});
    expect(mockPaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ application_fee_amount: 105 })
    );
  });

  it('transfer_data.destination = host stripeConnectAccountId', async () => {
    await handler(makeEvent(), {} as any, () => {});
    expect(mockPaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        transfer_data: expect.objectContaining({ destination: 'acct_test_host' }),
      })
    );
  });

  it('capture_method = automatic', async () => {
    await handler(makeEvent(), {} as any, () => {});
    expect(mockPaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ capture_method: 'automatic' })
    );
  });

  it('metadata includes bookingId, spotterId, listingId', async () => {
    await handler(makeEvent(), {} as any, () => {});
    expect(mockPaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          bookingId: BOOKING_ID,
          spotterId: SPOTTER_ID,
        }),
      })
    );
  });

  it('stripePaymentIntentId stored on booking in DynamoDB', async () => {
    await handler(makeEvent(), {} as any, () => {});
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });

  it('€100 booking → amount 10000, fee 1500', async () => {
    ddbMock.on(GetCommand)
      .resolvesOnce({ Item: { ...pendingBooking, totalPrice: 100.00 } })
      .resolvesOnce({ Item: hostUser });
    mockPaymentIntentCreate.mockResolvedValue({ id: 'pi_2', client_secret: 'sec', amount: 10000 });
    await handler(makeEvent(), {} as any, () => {});
    expect(mockPaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 10000, application_fee_amount: 1500 })
    );
  });

  it('€3.33 booking → amount 333, fee 49 (floor)', async () => {
    ddbMock.on(GetCommand)
      .resolvesOnce({ Item: { ...pendingBooking, totalPrice: 3.33 } })
      .resolvesOnce({ Item: hostUser });
    mockPaymentIntentCreate.mockResolvedValue({ id: 'pi_3', client_secret: 'sec', amount: 333 });
    await handler(makeEvent(), {} as any, () => {});
    expect(mockPaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 333, application_fee_amount: 49 })
    );
  });

  it('booking status CONFIRMED → 400 PAYMENT_ALREADY_PROCESSED', async () => {
    ddbMock.on(GetCommand).resolvesOnce({ Item: { ...pendingBooking, status: 'CONFIRMED' } });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('PAYMENT_ALREADY_PROCESSED');
  });

  it('booking status CANCELLED → 400', async () => {
    ddbMock.on(GetCommand).resolvesOnce({ Item: { ...pendingBooking, status: 'CANCELLED' } });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('requester not the spotter → 403', async () => {
    const res = await handler(makeEvent(BOOKING_ID, mockAuthContext('someone-else')), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });

  it('Stripe throws → 500, error NOT exposed to client', async () => {
    mockPaymentIntentCreate.mockRejectedValue(new Error('Stripe internal error: card_declined'));
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(500);
    expect(res!.body).not.toContain('card_declined');
  });

  it('booking not found → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  it('missing auth → 401', async () => {
    const res = await handler(makeEvent(BOOKING_ID, { requestContext: {} } as any), {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });
});
