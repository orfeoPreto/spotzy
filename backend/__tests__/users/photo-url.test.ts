import { APIGatewayProxyEvent } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/users/photo-url/index';
import { mockAuthContext, TEST_USER_ID } from '../setup';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://presigned.url/photo'),
}));

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
  (getSignedUrl as jest.Mock).mockResolvedValue('https://presigned.url/photo');
});

const makeEvent = (auth = mockAuthContext()): APIGatewayProxyEvent =>
  ({
    ...auth,
    body: JSON.stringify({ contentType: 'image/jpeg' }),
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/users/me/photo-url',
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

describe('user-photo-url', () => {
  it('returns pre-signed S3 PUT URL for profile photo', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.uploadUrl).toBeDefined();
    expect(body.key).toBeDefined();
    expect(body.publicUrl).toBeDefined();
  });

  it('key = users/{userId}/profile.jpg', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.key).toBe(`media/users/${TEST_USER_ID}/profile.jpg`);
  });

  it('publicUrl contains the key', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.publicUrl).toContain(`users/${TEST_USER_ID}/profile.jpg`);
  });

  it('missing auth → 401', async () => {
    const res = await handler(makeEvent({ requestContext: {} } as any), {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });
});
