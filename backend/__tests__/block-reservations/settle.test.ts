import { handler } from '../../functions/block-reservations/settle/index';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: jest.fn(), QueryCommand: jest.fn(), UpdateCommand: jest.fn(),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/client-ses', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    SESClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    SendEmailCommand: jest.fn(),
  };
});

const mockCapture = jest.fn();
const mockTransferCreate = jest.fn();
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: { capture: mockCapture },
    transfers: { create: mockTransferCreate },
  }));
});

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;

describe('block-settle', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('captures payment and transitions to SETTLED', async () => {
    ddbMock.mockResolvedValueOnce({
      Items: [
        {
          SK: 'METADATA', reqId: 'req-1', ownerUserId: 'user-1', status: 'AUTHORISED',
          authorisationId: 'pi_auth_123',
        },
        {
          SK: 'BLOCKALLOC#alloc-1', allocId: 'alloc-1', contributedBayCount: 5,
          pricePerBayEur: 20, riskShareMode: 'PERCENTAGE', riskShareRate: 0.3,
          spotManagerUserId: 'sm-1',
        },
        {
          SK: 'BOOKING#book-1', allocId: 'alloc-1', allocationStatus: 'ALLOCATED',
        },
        {
          SK: 'BOOKING#book-2', allocId: 'alloc-1', allocationStatus: 'ALLOCATED',
        },
      ],
    });
    // CONFIG#PLATFORM_FEE
    ddbMock.mockResolvedValueOnce({ Item: { blockReservationPct: 0.15 } });
    // Pool listing (for poolName lookup in the per-allocation loop)
    ddbMock.mockResolvedValueOnce({ Item: { address: 'Rue Test 1, Brussels' } });
    // SM profile
    ddbMock.mockResolvedValueOnce({ Item: { stripeConnectAccountId: 'acct_sm1' } });
    // Update calls
    ddbMock.mockResolvedValue({});

    mockCapture.mockResolvedValueOnce({ latest_charge: 'ch_123' });
    mockTransferCreate.mockResolvedValueOnce({ id: 'tr_123' });

    await handler({ reqId: 'req-1' });

    expect(mockCapture).toHaveBeenCalled();
    expect(mockTransferCreate).toHaveBeenCalled();
  });

  test('skips if status is not AUTHORISED', async () => {
    ddbMock.mockResolvedValueOnce({
      Items: [
        { SK: 'METADATA', reqId: 'req-1', status: 'CONFIRMED' },
      ],
    });
    await handler({ reqId: 'req-1' });
    expect(mockCapture).not.toHaveBeenCalled();
  });

  test('handles capture failure gracefully', async () => {
    ddbMock.mockResolvedValueOnce({
      Items: [
        { SK: 'METADATA', reqId: 'req-1', ownerUserId: 'user-1', status: 'AUTHORISED', authorisationId: 'pi_auth_123' },
        { SK: 'BLOCKALLOC#alloc-1', allocId: 'alloc-1', contributedBayCount: 5, pricePerBayEur: 20, riskShareMode: 'PERCENTAGE', spotManagerUserId: 'sm-1' },
      ],
    });
    ddbMock.mockResolvedValueOnce({ Item: {} });
    ddbMock.mockResolvedValue({});

    mockCapture.mockRejectedValueOnce(new Error('capture_failed'));

    await handler({ reqId: 'req-1' });
    // Should write settlementError but not crash
    expect(mockTransferCreate).not.toHaveBeenCalled();
  });
});
