import { handler } from '../../functions/block-reservations/guest-anonymise/index';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: jest.fn(), UpdateCommand: jest.fn(), DeleteCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;

describe('block-guest-anonymise', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('anonymises PII fields on bookings', async () => {
    // QueryCommand — BLOCKREQ partition
    ddbMock.mockResolvedValueOnce({
      Items: [
        { SK: 'METADATA', reqId: 'req-1', ownerUserId: 'user-1', status: 'SETTLED' },
        {
          SK: 'BOOKING#book-1', bookingId: 'book-1', reqId: 'req-1',
          guestName: 'Alice', guestEmail: 'alice@test.com', guestPhone: '+32470000001',
          spotterId: null,
        },
        {
          SK: 'BOOKING#book-2', bookingId: 'book-2', reqId: 'req-1',
          guestName: 'Bob', guestEmail: 'bob@test.com', guestPhone: '+32470000002',
          spotterId: null,
        },
      ],
    });
    ddbMock.mockResolvedValue({});

    await handler({ reqId: 'req-1' });

    // 2 UpdateCommands for anonymising bookings
    expect(ddbMock).toHaveBeenCalledTimes(3); // 1 query + 2 updates
  });

  test('deletes stub users with no other activity', async () => {
    ddbMock.mockResolvedValueOnce({
      Items: [
        { SK: 'METADATA', reqId: 'req-1', ownerUserId: 'user-1', status: 'SETTLED' },
        {
          SK: 'BOOKING#book-1', bookingId: 'book-1', reqId: 'req-1',
          guestName: 'Alice', guestEmail: 'alice@test.com', guestPhone: '+32470000001',
          spotterId: 'stub-user-1',
        },
      ],
    });
    // UpdateCommand — anonymise booking
    ddbMock.mockResolvedValueOnce({});
    // QueryCommand — check stub user activity (only PROFILE)
    ddbMock.mockResolvedValueOnce({ Items: [{ SK: 'PROFILE' }] });
    // DeleteCommand — delete stub user
    ddbMock.mockResolvedValue({});

    await handler({ reqId: 'req-1' });

    // 1 query + 1 update + 1 activity query + 1 delete
    expect(ddbMock).toHaveBeenCalledTimes(4);
  });

  test('skips already anonymised bookings', async () => {
    ddbMock.mockResolvedValueOnce({
      Items: [
        { SK: 'METADATA', reqId: 'req-1', ownerUserId: 'user-1', status: 'SETTLED' },
        {
          SK: 'BOOKING#book-1', bookingId: 'book-1', reqId: 'req-1',
          guestName: null, guestEmail: null, guestPhone: null,
          spotterId: null,
        },
      ],
    });

    await handler({ reqId: 'req-1' });
    expect(ddbMock).toHaveBeenCalledTimes(1); // Only the initial query
  });

  test('handles missing block request gracefully', async () => {
    ddbMock.mockResolvedValueOnce({ Items: [] });
    await handler({ reqId: 'req-nonexistent' });
    expect(ddbMock).toHaveBeenCalledTimes(1);
  });
});
