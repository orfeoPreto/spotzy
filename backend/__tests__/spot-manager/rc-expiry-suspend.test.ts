import { handler } from '../../functions/spot-manager/rc-expiry-suspend/index';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Get' })),
    QueryCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Query' })),
    TransactWriteCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'TransactWrite' })),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/client-scheduler', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    SchedulerClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    DeleteScheduleCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'DeleteSchedule' })),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/client-ses', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    SESClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    SendEmailCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'SendEmail' })),
    __mockSend: mockSend,
  };
});

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;
const schedulerMock = require('@aws-sdk/client-scheduler').__mockSend;
const sesMock = require('@aws-sdk/client-ses').__mockSend;

const makeEvent = (submissionId: string, userId: string) => ({ submissionId, userId });

const approvedSubmission = {
  PK: 'USER#user-1',
  SK: 'RCSUBMISSION#sub-1',
  submissionId: 'sub-1',
  status: 'APPROVED',
  expiryDate: '2026-04-10',
};

const activeProfile = {
  PK: 'USER#user-1',
  SK: 'PROFILE',
  userId: 'user-1',
  email: 'duke@test.com',
  spotManagerStatus: 'ACTIVE',
  blockReservationCapable: true,
  rcInsuranceStatus: 'VALID',
};

const poolListings = [
  { listingId: 'listing-1', isPool: true, blockReservationsOptedIn: true },
  { listingId: 'listing-2', isPool: true, blockReservationsOptedIn: true },
];

describe('rc-expiry-suspend', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('happy path: suspends block reservation capability, writes log, sends email', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission })   // get submission
      .mockResolvedValueOnce({ Item: activeProfile })         // get profile
      .mockResolvedValueOnce({ Items: poolListings })         // query pool listings
      .mockResolvedValueOnce({});                              // transact write

    await handler(makeEvent('sub-1', 'user-1'));

    // TransactWrite should update profile + write suspend log
    expect(ddbMock).toHaveBeenCalledTimes(4);
    const txCall = ddbMock.mock.calls[3][0];
    expect(txCall.TransactItems).toHaveLength(2);

    // Verify profile update
    const profileUpdate = txCall.TransactItems[0].Update;
    expect(profileUpdate.Key).toEqual({ PK: 'USER#user-1', SK: 'PROFILE' });
    expect(profileUpdate.ExpressionAttributeValues[':false']).toBe(false);
    expect(profileUpdate.ExpressionAttributeValues[':expired']).toBe('EXPIRED');

    // Verify suspend log
    const suspendPut = txCall.TransactItems[1].Put;
    expect(suspendPut.Item.SK).toBe('RCSUSPEND#sub-1');
    expect(suspendPut.Item.reason).toBe('EXPIRED');
    expect(suspendPut.Item.affectedListingIds).toEqual(['listing-1', 'listing-2']);

    // Email sent
    expect(sesMock).toHaveBeenCalledTimes(1);

    // Scheduler rule cleaned up
    expect(schedulerMock).toHaveBeenCalledTimes(1);
    expect(schedulerMock.mock.calls[0][0].Name).toBe('rc-expiry-suspend-sub-1');
  });

  test('skips when submission is SUPERSEDED (already renewed), deletes rule', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: { ...approvedSubmission, status: 'SUPERSEDED' } });

    await handler(makeEvent('sub-1', 'user-1'));

    // Should only get submission, then bail
    expect(ddbMock).toHaveBeenCalledTimes(1);

    // Should delete scheduler rule
    expect(schedulerMock).toHaveBeenCalledTimes(1);
    expect(schedulerMock.mock.calls[0][0].Name).toBe('rc-expiry-suspend-sub-1');

    // Should NOT send email or transact
    expect(sesMock).not.toHaveBeenCalled();
  });

  test('handles no affected pool listings', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission })
      .mockResolvedValueOnce({ Item: activeProfile })
      .mockResolvedValueOnce({ Items: [] })                    // no pool listings
      .mockResolvedValueOnce({});                              // transact write

    await handler(makeEvent('sub-1', 'user-1'));

    const txCall = ddbMock.mock.calls[3][0];
    const suspendPut = txCall.TransactItems[1].Put;
    expect(suspendPut.Item.affectedListingIds).toEqual([]);

    expect(sesMock).toHaveBeenCalledTimes(1);
  });

  test('preserves existing BLOCKALLOC records (does not touch them)', async () => {
    // Seed scenario: user has BLOCKALLOC# records in the table.
    // The suspend handler should NOT issue any delete/update on BLOCKALLOC# items.
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission })
      .mockResolvedValueOnce({ Item: activeProfile })
      .mockResolvedValueOnce({ Items: poolListings })
      .mockResolvedValueOnce({});

    await handler(makeEvent('sub-1', 'user-1'));

    // Verify every DDB call — none should reference BLOCKALLOC
    for (let i = 0; i < ddbMock.mock.calls.length; i++) {
      const call = ddbMock.mock.calls[i][0];
      const callStr = JSON.stringify(call);
      expect(callStr).not.toContain('BLOCKALLOC');
    }

    // TransactWrite should only have 2 items (profile update + suspend log)
    const txCall = ddbMock.mock.calls[3][0];
    expect(txCall.TransactItems).toHaveLength(2);
  });

  test('queries pool listings with correct filter', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission })
      .mockResolvedValueOnce({ Item: activeProfile })
      .mockResolvedValueOnce({ Items: poolListings })
      .mockResolvedValueOnce({});

    await handler(makeEvent('sub-1', 'user-1'));

    // The third DDB call should be the query for pool listings
    const queryCall = ddbMock.mock.calls[2][0];
    expect(queryCall.IndexName).toBe('GSI1');
    expect(queryCall.ExpressionAttributeValues[':hostPk']).toBe('HOST#user-1');
    expect(queryCall.ExpressionAttributeValues[':isPool']).toBe(true);
    expect(queryCall.ExpressionAttributeValues[':opted']).toBe(true);
  });

  test('skips when profile not found', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission })
      .mockResolvedValueOnce({ Item: undefined });

    await handler(makeEvent('sub-1', 'user-1'));

    expect(sesMock).not.toHaveBeenCalled();
    expect(ddbMock).toHaveBeenCalledTimes(2);
  });

  test('skips when submission not found', async () => {
    ddbMock.mockResolvedValueOnce({ Item: undefined });

    await handler(makeEvent('sub-1', 'user-1'));

    expect(sesMock).not.toHaveBeenCalled();
    expect(schedulerMock).not.toHaveBeenCalled();
    expect(ddbMock).toHaveBeenCalledTimes(1);
  });
});
