import { handler } from '../../functions/block-reservations/payment-webhook/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: jest.fn(), QueryCommand: jest.fn(), UpdateCommand: jest.fn(),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/client-scheduler', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    SchedulerClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    CreateScheduleCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

const mockConstructEvent = jest.fn();
const mockChargesRetrieve = jest.fn();
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    charges: { retrieve: mockChargesRetrieve },
  }));
});

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;
const schedulerMock = require('@aws-sdk/client-scheduler').__mockSend;

function mockEvent(body: string, signature: string): APIGatewayProxyEvent {
  return {
    requestContext: { requestId: 'test' } as any,
    body,
    headers: { 'Stripe-Signature': signature },
    multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false,
    path: '/api/v1/payments/block-webhook', pathParameters: null,
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

describe('block-payment-webhook', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns 400 for invalid signature', async () => {
    mockConstructEvent.mockImplementationOnce(() => { throw new Error('Invalid signature'); });

    const result = await handler(mockEvent('{}', 'bad-sig'), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
  });

  test('handles payment_intent.succeeded', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      id: 'evt_1',
      data: { object: { id: 'pi_123', metadata: { reqId: 'req-1' }, amount: 10000 } },
    });

    ddbMock.mockResolvedValueOnce({ Item: { reqId: 'req-1', status: 'AUTHORISED' } });
    ddbMock.mockResolvedValue({});

    const result = await handler(mockEvent('{}', 'valid-sig'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    expect(JSON.parse(result!.body).received).toBe(true);
  });

  test('handles payment_intent.payment_failed and schedules retry', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'payment_intent.payment_failed',
      id: 'evt_2',
      data: { object: { id: 'pi_123', metadata: { reqId: 'req-1' } } },
    });

    ddbMock.mockResolvedValueOnce({
      Item: { reqId: 'req-1', status: 'CONFIRMED', authorisationRetryCount: 0 },
    });
    ddbMock.mockResolvedValue({});

    const result = await handler(mockEvent('{}', 'valid-sig'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    expect(schedulerMock).toHaveBeenCalled();
  });

  test('handles charge.dispute.created', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'charge.dispute.created',
      id: 'evt_3',
      data: { object: { id: 'dp_123', charge: 'ch_123', reason: 'fraudulent' } },
    });

    mockChargesRetrieve.mockResolvedValueOnce({ metadata: { reqId: 'req-1' } });
    ddbMock.mockResolvedValue({});

    const result = await handler(mockEvent('{}', 'valid-sig'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    expect(mockChargesRetrieve).toHaveBeenCalledWith('ch_123');
  });

  test('handles transfer events', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'transfer.created',
      id: 'evt_4',
      data: { object: { id: 'tr_123', metadata: { reqId: 'req-1', allocId: 'alloc-1' } } },
    });

    ddbMock.mockResolvedValueOnce({
      Item: {
        settlement: { transferStatus: 'PENDING', transferId: null, amountEur: 100 },
      },
    });
    ddbMock.mockResolvedValue({});

    const result = await handler(mockEvent('{}', 'valid-sig'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
  });

  test('ignores payment_failed without reqId in metadata', async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: 'payment_intent.payment_failed',
      id: 'evt_5',
      data: { object: { id: 'pi_unrelated', metadata: {} } },
    });

    const result = await handler(mockEvent('{}', 'valid-sig'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    expect(ddbMock).not.toHaveBeenCalled();
  });
});
