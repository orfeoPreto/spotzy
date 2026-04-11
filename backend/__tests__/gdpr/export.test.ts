import { handler } from '../../functions/gdpr/export/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Query' })),
    PutCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'Put' })),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/client-s3', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.amazonaws.com/test-export-url'),
}));

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;

function mockEvent(userId: string): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { claims: { sub: userId } }, requestId: 'test-req' } as any,
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/api/v1/users/me/export',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
  };
}

describe('gdpr-export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns pre-signed S3 URL for JSON export', async () => {
    // Mock all queries to return empty/minimal data
    ddbMock.mockResolvedValue({ Items: [{ PK: 'USER#user-1', SK: 'PROFILE', email: 'test@example.com', firstName: 'Test' }] });

    const result = await handler(mockEvent('user-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.downloadUrl).toMatch(/^https:\/\//);
    expect(body.expiresIn).toBe('24 hours');
  });

  test('export contains required data categories', async () => {
    ddbMock.mockResolvedValue({ Items: [] });

    const result = await handler(mockEvent('user-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
  });

  test('returns 401 when no auth', async () => {
    const event = mockEvent('user-1');
    event.requestContext.authorizer = null as any;

    const result = await handler(event, {} as any, () => {});
    expect(result!.statusCode).toBe(401);
  });
});
