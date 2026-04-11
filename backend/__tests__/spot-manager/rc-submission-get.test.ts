import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: jest.fn(),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  GetObjectCommand: jest.fn(),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/document-url'),
}));

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;

import { handler } from '../../functions/spot-manager/rc-submission-get/index';

const mockSubmission = {
  PK: 'USER#user-1',
  SK: 'RCSUBMISSION#sub-123',
  submissionId: 'sub-123',
  userId: 'user-1',
  insurer: 'AXA Belgium',
  policyNumber: 'POL-123',
  expiryDate: '2027-06-15',
  documentS3Key: 'rc-uploads/user-1/123.pdf',
  documentMimeType: 'application/pdf',
  documentSizeBytes: 500000,
  status: 'PENDING_REVIEW',
  createdAt: '2026-04-10T10:00:00.000Z',
  updatedAt: '2026-04-10T10:00:00.000Z',
};

function mockEvent(userId: string, overrides: any = {}): APIGatewayProxyEvent {
  return {
    requestContext: {
      authorizer: { claims: { sub: userId, email: `${userId}@test.com`, ...(overrides.claims ?? {}) } },
      requestId: 'test-req',
    } as any,
    body: null,
    headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false,
    path: '/api/v1/spot-manager/rc-submissions/sub-123',
    pathParameters: overrides.pathParameters ?? { submissionId: 'sub-123' },
    queryStringParameters: overrides.queryStringParameters ?? null,
    multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

function mockAdminEvent(adminId: string, targetUserId: string, submissionId: string): APIGatewayProxyEvent {
  return {
    requestContext: {
      authorizer: { claims: { sub: adminId, email: `${adminId}@test.com`, 'cognito:groups': 'admin' } },
      requestId: 'test-req',
    } as any,
    body: null,
    headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false,
    path: `/api/v1/spot-manager/rc-submissions/${submissionId}`,
    pathParameters: { submissionId },
    queryStringParameters: { userId: targetUserId },
    multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

describe('rc-submission-get', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns submission for owner', async () => {
    ddbMock.mockResolvedValueOnce({ Item: mockSubmission });

    const result = await handler(mockEvent('user-1'), {} as any, () => {});

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.submissionId).toBe('sub-123');
    expect(body.documentUrl).toBe('https://s3.example.com/document-url');
  });

  test('returns submission for admin accessing other user', async () => {
    ddbMock.mockResolvedValueOnce({ Item: mockSubmission });

    const result = await handler(mockAdminEvent('admin-1', 'user-1', 'sub-123'), {} as any, () => {});

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.submissionId).toBe('sub-123');
  });

  test('returns 401 for unauthenticated request', async () => {
    const event = {
      requestContext: { authorizer: {}, requestId: 'test-req' } as any,
      body: null,
      headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false,
      path: '/api/v1/spot-manager/rc-submissions/sub-123',
      pathParameters: { submissionId: 'sub-123' },
      queryStringParameters: null, multiValueQueryStringParameters: null,
      stageVariables: null, resource: '',
    } as APIGatewayProxyEvent;

    const result = await handler(event, {} as any, () => {});
    expect(result!.statusCode).toBe(401);
  });

  test('returns 404 for non-existent submission', async () => {
    ddbMock.mockResolvedValueOnce({ Item: undefined });

    const result = await handler(mockEvent('user-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(404);
  });

  test('returns 403 for non-owner non-admin', async () => {
    ddbMock.mockResolvedValueOnce({ Item: mockSubmission });

    const result = await handler(
      mockEvent('user-2', { queryStringParameters: { userId: 'user-1' } }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(403);
  });

  test('returns 404 when submissionId is missing', async () => {
    const result = await handler(
      mockEvent('user-1', { pathParameters: {} }),
      {} as any,
      () => {},
    );
    expect(result!.statusCode).toBe(404);
  });
});
