import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  PutObjectCommand: jest.fn(),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
}));

import { handler } from '../../functions/spot-manager/rc-submission-presign/index';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function mockEvent(userId: string, body: any): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { claims: { sub: userId, email: `${userId}@test.com` } }, requestId: 'test-req' } as any,
    body: JSON.stringify(body),
    headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false,
    path: '/api/v1/spot-manager/rc-submissions/presign', pathParameters: null,
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

function mockUnauthEvent(body: any): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: {}, requestId: 'test-req' } as any,
    body: JSON.stringify(body),
    headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false,
    path: '/api/v1/spot-manager/rc-submissions/presign', pathParameters: null,
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

describe('rc-submission-presign', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns presigned URL for valid PDF upload', async () => {
    const result = await handler(mockEvent('user-1', {
      fileName: 'insurance.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 500000,
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.uploadUrl).toBe('https://s3.example.com/presigned-url');
    expect(body.s3Key).toMatch(/^rc-uploads\/user-1\/\d+-[A-Z0-9]+\.pdf$/);
    expect(getSignedUrl).toHaveBeenCalled();
  });

  test('returns presigned URL for JPEG upload', async () => {
    const result = await handler(mockEvent('user-1', {
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 200000,
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.s3Key).toMatch(/\.jpg$/);
  });

  test('returns presigned URL for PNG upload', async () => {
    const result = await handler(mockEvent('user-1', {
      fileName: 'scan.png',
      mimeType: 'image/png',
      sizeBytes: 300000,
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.s3Key).toMatch(/\.png$/);
  });

  test('returns 401 for unauthenticated request', async () => {
    const result = await handler(mockUnauthEvent({
      fileName: 'insurance.pdf', mimeType: 'application/pdf', sizeBytes: 500000,
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(401);
  });

  test('returns 400 for missing fields', async () => {
    const result = await handler(mockEvent('user-1', { fileName: 'test.pdf' }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
  });

  test('returns 400 for invalid mime type', async () => {
    const result = await handler(mockEvent('user-1', {
      fileName: 'doc.txt', mimeType: 'text/plain', sizeBytes: 1000,
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('INVALID_MIME_TYPE');
  });

  test('returns 400 for file too large', async () => {
    const result = await handler(mockEvent('user-1', {
      fileName: 'huge.pdf', mimeType: 'application/pdf', sizeBytes: 20 * 1024 * 1024,
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('FILE_TOO_LARGE');
  });

  test('returns 400 for empty file', async () => {
    const result = await handler(mockEvent('user-1', {
      fileName: 'empty.pdf', mimeType: 'application/pdf', sizeBytes: 0,
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('EMPTY_FILE');
  });
});
