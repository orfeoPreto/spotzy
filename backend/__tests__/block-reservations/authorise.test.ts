jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));

const mockDdbSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockDdbSend }) },
    QueryCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Query' })),
    UpdateCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Update' })),
    GetCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'Get' })),
    PutCommand: jest.fn(),
    TransactWriteCommand: jest.fn(),
  };
});

const mockPiCreate = jest.fn();
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: { create: mockPiCreate },
  }));
});

const mockSchedulerSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn().mockImplementation(() => ({ send: mockSchedulerSend })),
  CreateScheduleCommand: jest.fn().mockImplementation((params: any) => params),
}));

// Mock the Stripe secret loader so no Secrets Manager call is made in tests
jest.mock('../../functions/payments/shared/stripe-helpers', () => ({
  getStripeSecretKey: jest.fn().mockResolvedValue('sk_test_fake'),
}));

import { handler } from '../../functions/block-reservations/authorise/index';

const metadata = {
  PK: 'BLOCKREQ#req-1', SK: 'METADATA',
  reqId: 'req-1', ownerUserId: 'user-1', status: 'CONFIRMED',
};

const allocation = {
  PK: 'BLOCKREQ#req-1', SK: 'BLOCKALLOC#alloc-1',
  allocId: 'alloc-1', contributedBayCount: 10, pricePerBayEur: 25,
};

describe('block-authorise Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPiCreate.mockResolvedValue({ id: 'pi_auth_123' });
  });

  test('happy path: computes worst case, creates PI, transitions CONFIRMED -> AUTHORISED', async () => {
    let updateCalls: any[] = [];
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Query') {
        return Promise.resolve({ Items: [metadata, allocation] });
      }
      if (cmd._type === 'Get') {
        return Promise.resolve({
          Item: { stripeCustomerId: 'cus_123', defaultPaymentMethodId: 'pm_123' },
        });
      }
      if (cmd._type === 'Update') {
        updateCalls.push(cmd);
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    await handler({ reqId: 'req-1' });

    expect(mockPiCreate).toHaveBeenCalledTimes(1);
    const piArgs = mockPiCreate.mock.calls[0][0];
    expect(piArgs.amount).toBe(25000);
    expect(piArgs.capture_method).toBe('manual');

    const statusUpdate = updateCalls.find((c) => c.ExpressionAttributeValues?.[':s'] === 'AUTHORISED');
    expect(statusUpdate).toBeTruthy();
  });

  test('idempotency key uses blockreq:{reqId}:authorise', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Query') return Promise.resolve({ Items: [metadata, allocation] });
      if (cmd._type === 'Get') return Promise.resolve({ Item: { stripeCustomerId: 'cus_123', defaultPaymentMethodId: 'pm_123' } });
      return Promise.resolve({});
    });

    await handler({ reqId: 'req-1' });
    expect(mockPiCreate).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: 'blockreq:req-1:authorise' });
  });

  test('auth failure schedules grace period retry', async () => {
    mockPiCreate.mockRejectedValue(new Error('card_declined'));
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Query') return Promise.resolve({ Items: [metadata, allocation] });
      if (cmd._type === 'Get') return Promise.resolve({ Item: { stripeCustomerId: 'cus_123', defaultPaymentMethodId: 'pm_123' } });
      return Promise.resolve({});
    });

    await handler({ reqId: 'req-1' });

    expect(mockSchedulerSend).toHaveBeenCalledTimes(1);
    const scheduleCall = mockSchedulerSend.mock.calls[0][0];
    expect(scheduleCall.Name).toBe('block-auth-grace-req-1');
  });

  test('skips if CANCELLED status', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Query') return Promise.resolve({ Items: [{ ...metadata, status: 'CANCELLED' }] });
      return Promise.resolve({});
    });

    await handler({ reqId: 'req-1' });
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  test('skips if already AUTHORISED', async () => {
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Query') return Promise.resolve({ Items: [{ ...metadata, status: 'AUTHORISED' }] });
      return Promise.resolve({});
    });

    await handler({ reqId: 'req-1' });
    expect(mockPiCreate).not.toHaveBeenCalled();
  });

  test('worst case = sum(contributedBayCount * pricePerBayEur)', async () => {
    const alloc2 = { PK: 'BLOCKREQ#req-1', SK: 'BLOCKALLOC#alloc-2', allocId: 'alloc-2', contributedBayCount: 5, pricePerBayEur: 30 };
    mockDdbSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'Query') return Promise.resolve({ Items: [metadata, allocation, alloc2] });
      if (cmd._type === 'Get') return Promise.resolve({ Item: { stripeCustomerId: 'cus_123', defaultPaymentMethodId: 'pm_123' } });
      return Promise.resolve({});
    });

    await handler({ reqId: 'req-1' });

    const piArgs = mockPiCreate.mock.calls[0][0];
    expect(piArgs.amount).toBe(40000);
  });
});
