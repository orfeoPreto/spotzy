import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: jest.fn(),
    TransactWriteCommand: jest.fn(),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/client-eventbridge', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutEventsCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;
const ebMock = require('@aws-sdk/client-eventbridge').__mockSend;

import { handler } from '../../functions/spot-manager/rc-submission-create/index';

const validBody = {
  insurer: 'AXA Belgium',
  policyNumber: 'POL-123456',
  expiryDate: '2027-06-15',
  document: { mimeType: 'application/pdf', size: 500000, s3Key: 'rc-uploads/user-1/123.pdf' },
  checklist: {
    reliableAccess: true,
    stableInstructions: true,
    chatResponseCommitment: true,
    suspensionAcknowledged: true,
  },
  tcsVersion: '2026-04-v1',
};

function mockEvent(userId: string, body: any): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { claims: { sub: userId, email: `${userId}@test.com` } }, requestId: 'test-req' } as any,
    body: JSON.stringify(body),
    headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false,
    path: '/api/v1/spot-manager/rc-submissions', pathParameters: null,
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

function mockUnauthEvent(body: any): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: {}, requestId: 'test-req' } as any,
    body: JSON.stringify(body),
    headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false,
    path: '/api/v1/spot-manager/rc-submissions', pathParameters: null,
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

describe('rc-submission-create', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('creates submission with valid data', async () => {
    ddbMock
      .mockResolvedValueOnce({ Item: { userId: 'user-1', stripeConnectEnabled: true } }) // GetCommand profile
      .mockResolvedValueOnce({}); // TransactWriteCommand

    const result = await handler(mockEvent('user-1', validBody), {} as any, () => {});

    expect(result!.statusCode).toBe(201);
    const body = JSON.parse(result!.body);
    expect(body.submissionId).toBeDefined();
    expect(body.status).toBe('PENDING_REVIEW');
    expect(body.insurer).toBe('AXA Belgium');
    expect(body.policyNumber).toBe('POL-123456');
    expect(body.userId).toBe('user-1');
    expect(ebMock).toHaveBeenCalled();
  });

  test('returns warnings for near-expiry policy', async () => {
    const nearExpiry = new Date();
    nearExpiry.setDate(nearExpiry.getDate() + 20);
    const nearExpiryStr = nearExpiry.toISOString().split('T')[0];

    ddbMock
      .mockResolvedValueOnce({ Item: { userId: 'user-1', stripeConnectEnabled: true } })
      .mockResolvedValueOnce({});

    const result = await handler(mockEvent('user-1', { ...validBody, expiryDate: nearExpiryStr }), {} as any, () => {});

    expect(result!.statusCode).toBe(201);
    const body = JSON.parse(result!.body);
    expect(body.warnings).toContain('POLICY_NEAR_EXPIRY');
  });

  test('returns 401 for unauthenticated request', async () => {
    const result = await handler(mockUnauthEvent(validBody), {} as any, () => {});
    expect(result!.statusCode).toBe(401);
  });

  test('returns 400 for invalid insurer', async () => {
    const result = await handler(mockEvent('user-1', { ...validBody, insurer: 'FakeInsurer' }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('INVALID_INSURER');
  });

  test('returns 400 for missing policy number', async () => {
    const result = await handler(mockEvent('user-1', { ...validBody, policyNumber: '' }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('POLICY_NUMBER_REQUIRED');
  });

  test('returns 400 for expiry date in the past', async () => {
    const result = await handler(mockEvent('user-1', { ...validBody, expiryDate: '2020-01-01' }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('EXPIRY_DATE_IN_PAST');
  });

  test('returns 400 for invalid document mime type', async () => {
    const result = await handler(mockEvent('user-1', {
      ...validBody,
      document: { mimeType: 'text/plain', size: 500000, s3Key: 'test.txt' },
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('INVALID_MIME_TYPE');
  });

  test('returns 400 for file too large', async () => {
    const result = await handler(mockEvent('user-1', {
      ...validBody,
      document: { mimeType: 'application/pdf', size: 20 * 1024 * 1024, s3Key: 'test.pdf' },
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('FILE_TOO_LARGE');
  });

  test('returns 400 for incomplete checklist', async () => {
    const result = await handler(mockEvent('user-1', {
      ...validBody,
      checklist: { reliableAccess: true, stableInstructions: true, chatResponseCommitment: false, suspensionAcknowledged: true },
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('CHECKLIST_INCOMPLETE');
  });

  test('returns 400 for missing tcsVersion', async () => {
    const result = await handler(mockEvent('user-1', { ...validBody, tcsVersion: undefined }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('TCS_VERSION_REQUIRED');
  });

  test('returns 403 when Stripe Connect not enabled', async () => {
    ddbMock.mockResolvedValueOnce({ Item: { userId: 'user-1', stripeConnectEnabled: false } });

    const result = await handler(mockEvent('user-1', validBody), {} as any, () => {});
    expect(result!.statusCode).toBe(403);
    expect(JSON.parse(result!.body).error).toBe('STRIPE_CONNECT_REQUIRED');
  });

  test('returns 400 for missing document', async () => {
    const result = await handler(mockEvent('user-1', { ...validBody, document: {} }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('DOCUMENT_REQUIRED');
  });
});
