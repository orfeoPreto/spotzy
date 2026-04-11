import { handler } from '../../functions/spot-manager/rc-expiry-reminder-30d/index';

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
  expiryDate: '2026-05-10',
};

const activeProfile = {
  PK: 'USER#user-1',
  SK: 'PROFILE',
  userId: 'user-1',
  email: 'duke@test.com',
  spotManagerStatus: 'ACTIVE',
};

describe('rc-expiry-reminder-30d', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('happy path: sends 30-day reminder and writes log', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission }) // get submission
      .mockResolvedValueOnce({ Item: activeProfile })       // get profile
      .mockResolvedValueOnce({ Item: undefined })            // idempotency check (no existing reminder)
      .mockResolvedValueOnce({});                            // put reminder log

    await handler(makeEvent('sub-1', 'user-1'));

    // SES should be called
    expect(sesMock).toHaveBeenCalledTimes(1);
    // DDB put for reminder log
    expect(ddbMock).toHaveBeenCalledTimes(4);
    // Scheduler should NOT be called (no cleanup needed on happy path)
    expect(schedulerMock).not.toHaveBeenCalled();
  });

  test('skips when submission is SUPERSEDED: writes log with skipReason, deletes rule', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: { ...approvedSubmission, status: 'SUPERSEDED' } }) // get submission
      .mockResolvedValueOnce({});  // put skip log

    await handler(makeEvent('sub-1', 'user-1'));

    // Should write skip log
    expect(ddbMock).toHaveBeenCalledTimes(2);
    const putCall = ddbMock.mock.calls[1][0];
    expect(putCall.Item.skipReason).toBe('SUPERSEDED');
    expect(putCall.Item.sentAt).toBeNull();
    expect(putCall.Item.type).toBe('30_DAY_REMINDER');

    // Should delete scheduler rule
    expect(schedulerMock).toHaveBeenCalledTimes(1);
    expect(schedulerMock.mock.calls[0][0].Name).toBe('rc-expiry-reminder-30d-sub-1');

    // Should NOT send email
    expect(sesMock).not.toHaveBeenCalled();
  });

  test('idempotent: second fire is no-op', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission }) // get submission
      .mockResolvedValueOnce({ Item: activeProfile })       // get profile
      .mockResolvedValueOnce({ Item: { PK: 'USER#user-1', SK: 'RCREMINDER#sub-1#30_DAY_REMINDER' } }); // existing reminder

    await handler(makeEvent('sub-1', 'user-1'));

    // Should NOT send email or write log
    expect(sesMock).not.toHaveBeenCalled();
    expect(ddbMock).toHaveBeenCalledTimes(3); // only the 3 gets
  });

  test('skips when profile not found', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission }) // get submission
      .mockResolvedValueOnce({ Item: undefined });          // no profile

    await handler(makeEvent('sub-1', 'user-1'));

    expect(sesMock).not.toHaveBeenCalled();
    expect(ddbMock).toHaveBeenCalledTimes(2);
  });

  test('skips when spotManagerStatus is not ACTIVE', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: approvedSubmission })
      .mockResolvedValueOnce({ Item: { ...activeProfile, spotManagerStatus: 'SUSPENDED' } });

    await handler(makeEvent('sub-1', 'user-1'));

    expect(sesMock).not.toHaveBeenCalled();
    expect(ddbMock).toHaveBeenCalledTimes(2);
  });

  test('skips when submission not found', async () => {
    ddbMock.mockResolvedValueOnce({ Item: undefined });

    await handler(makeEvent('sub-1', 'user-1'));

    expect(sesMock).not.toHaveBeenCalled();
    expect(ddbMock).toHaveBeenCalledTimes(1);
  });
});
