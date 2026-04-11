import { handler } from '../../functions/spot-manager/rc-expiry-reminder-7d/index';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Get' })),
    PutCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Put' })),
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
  expiryDate: '2026-04-17',
};

const activeProfile = {
  PK: 'USER#user-1',
  SK: 'PROFILE',
  userId: 'user-1',
  email: 'duke@test.com',
  spotManagerStatus: 'ACTIVE',
};

describe('rc-expiry-reminder-7d', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('happy path: sends 7-day reminder and writes log', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission }) // get submission
      .mockResolvedValueOnce({ Item: activeProfile })       // get profile
      .mockResolvedValueOnce({ Item: undefined })            // idempotency check
      .mockResolvedValueOnce({});                            // put reminder log

    await handler(makeEvent('sub-1', 'user-1'));

    expect(sesMock).toHaveBeenCalledTimes(1);
    expect(ddbMock).toHaveBeenCalledTimes(4);
    expect(schedulerMock).not.toHaveBeenCalled();

    // Verify reminder log has correct type
    const putCall = ddbMock.mock.calls[3][0];
    expect(putCall.Item.type).toBe('7_DAY_REMINDER');
    expect(putCall.Item.SK).toBe('RCREMINDER#sub-1#7_DAY_REMINDER');
    expect(putCall.Item.sentAt).toBeTruthy();
    expect(putCall.Item.skipReason).toBeNull();
  });

  test('skips when submission is SUPERSEDED: writes log with skipReason, deletes rule', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: { ...approvedSubmission, status: 'SUPERSEDED' } })
      .mockResolvedValueOnce({});

    await handler(makeEvent('sub-1', 'user-1'));

    // Should write skip log
    const putCall = ddbMock.mock.calls[1][0];
    expect(putCall.Item.skipReason).toBe('SUPERSEDED');
    expect(putCall.Item.sentAt).toBeNull();
    expect(putCall.Item.type).toBe('7_DAY_REMINDER');

    // Should delete scheduler rule
    expect(schedulerMock).toHaveBeenCalledTimes(1);
    expect(schedulerMock.mock.calls[0][0].Name).toBe('rc-expiry-reminder-7d-sub-1');

    expect(sesMock).not.toHaveBeenCalled();
  });

  test('idempotent: second fire is no-op', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission })
      .mockResolvedValueOnce({ Item: activeProfile })
      .mockResolvedValueOnce({ Item: { PK: 'USER#user-1', SK: 'RCREMINDER#sub-1#7_DAY_REMINDER' } });

    await handler(makeEvent('sub-1', 'user-1'));

    expect(sesMock).not.toHaveBeenCalled();
    expect(ddbMock).toHaveBeenCalledTimes(3);
  });

  test('skips when profile not found', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission })
      .mockResolvedValueOnce({ Item: undefined });

    await handler(makeEvent('sub-1', 'user-1'));

    expect(sesMock).not.toHaveBeenCalled();
  });

  test('skips when spotManagerStatus is not ACTIVE', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission })
      .mockResolvedValueOnce({ Item: { ...activeProfile, spotManagerStatus: 'SUSPENDED' } });

    await handler(makeEvent('sub-1', 'user-1'));

    expect(sesMock).not.toHaveBeenCalled();
  });
});
