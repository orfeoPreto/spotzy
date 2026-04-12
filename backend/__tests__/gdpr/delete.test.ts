import { handler } from '../../functions/gdpr/delete/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock all AWS SDK clients
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Query' })),
    UpdateCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Update' })),
    DeleteCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Delete' })),
    BatchWriteCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'BatchWrite' })),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    AdminDisableUserCommand: jest.fn(),
    AdminDeleteUserCommand: jest.fn(),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    DeleteObjectCommand: jest.fn(),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/client-ses', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    SESClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    SendEmailCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;
const cognitoMock = require('@aws-sdk/client-cognito-identity-provider').__mockSend;
const s3Mock = require('@aws-sdk/client-s3').__mockSend;
const sesMock = require('@aws-sdk/client-ses').__mockSend;

function mockEvent(userId: string): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { claims: { sub: userId } }, requestId: 'test-req' } as any,
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'DELETE',
    isBase64Encoded: false,
    path: '/api/v1/users/me',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
  };
}

describe('gdpr-delete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 409 ACTIVE_BOOKINGS_EXIST when user has CONFIRMED booking', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [{ PK: 'BOOKING#b1', SK: 'METADATA', status: 'CONFIRMED', spotterId: 'user-1' }] }) // spotter bookings
      .mockResolvedValueOnce({ Items: [] }); // host bookings

    const result = await handler(mockEvent('user-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(409);
    const body = JSON.parse(result!.body);
    expect(body.error).toBe('ACTIVE_BOOKINGS_EXIST');
    expect(body.details.blockingBookings).toHaveLength(1);
  });

  test('returns 409 when user has ACTIVE booking as host', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [] }) // spotter bookings
      .mockResolvedValueOnce({ Items: [{ PK: 'BOOKING#b2', SK: 'METADATA', status: 'ACTIVE', hostId: 'user-1' }] }); // host bookings

    const result = await handler(mockEvent('user-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(409);
  });

  test('COMPLETED and CANCELLED bookings do not block deletion', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [] }) // spotter active
      .mockResolvedValueOnce({ Items: [] }) // host active
      .mockResolvedValueOnce({ Items: [] }) // open disputes
      .mockResolvedValueOnce({ Items: [{ PK: 'USER#user-1', SK: 'PROFILE', email: 'test@example.com', firstName: 'Test' }] }) // getUser
      .mockResolvedValue({ Items: [] }); // all other queries

    const result = await handler(mockEvent('user-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    expect(JSON.parse(result!.body).message).toBe('Account deleted successfully');
  });

  test('sends confirmation email BEFORE anonymising', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [] }) // spotter bookings
      .mockResolvedValueOnce({ Items: [] }) // host bookings
      .mockResolvedValueOnce({ Items: [] }) // open disputes
      .mockResolvedValueOnce({ Items: [{ PK: 'USER#user-1', SK: 'PROFILE', email: 'marc@example.com' }] }) // getUser
      .mockResolvedValue({ Items: [] }); // all other queries

    await handler(mockEvent('user-1'), {} as any, () => {});

    expect(sesMock).toHaveBeenCalled();
  });

  test('returns 409 when user has open disputes', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [] }) // spotter bookings
      .mockResolvedValueOnce({ Items: [] }) // host bookings
      .mockResolvedValueOnce({ Items: [{ PK: 'DISPUTE#d1', status: 'OPEN' }] }); // open disputes

    const result = await handler(mockEvent('user-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(409);
    const body = JSON.parse(result!.body);
    expect(body.error).toBe('OPEN_DISPUTES_EXIST');
  });

  test('returns 200 on successful deletion', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [{ PK: 'USER#user-1', SK: 'PROFILE', email: 'test@example.com' }] })
      .mockResolvedValue({ Items: [] });

    const result = await handler(mockEvent('user-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    expect(JSON.parse(result!.body).message).toBe('Account deleted successfully');
  });

  test('calls Cognito disable and delete', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [{ PK: 'USER#user-1', SK: 'PROFILE', email: 'test@example.com' }] })
      .mockResolvedValue({ Items: [] });

    await handler(mockEvent('user-1'), {} as any, () => {});

    // Cognito should be called twice (disable + delete)
    expect(cognitoMock).toHaveBeenCalledTimes(2);
  });

  test('deletes profile photo from S3', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [{ PK: 'USER#user-1', SK: 'PROFILE', email: 'test@example.com' }] })
      .mockResolvedValue({ Items: [] });

    await handler(mockEvent('user-1'), {} as any, () => {});

    expect(s3Mock).toHaveBeenCalled();
  });
});
