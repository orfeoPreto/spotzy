import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/listings/photo-url/index';
import { mockAuthContext, TEST_USER_ID, TEST_LISTING_ID } from '../setup';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://presigned.url/photo'),
}));

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

const existingListing = {
  PK: `LISTING#${TEST_LISTING_ID}`, SK: 'METADATA',
  listingId: TEST_LISTING_ID, hostId: TEST_USER_ID, status: 'draft',
};

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  ddbMock.on(GetCommand).resolves({ Item: existingListing });
  (getSignedUrl as jest.Mock).mockResolvedValue('https://presigned.url/photo');
});

const makeEvent = (params: { id?: string; photoIndex?: string; contentType?: string } = {}, auth = mockAuthContext()): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify({ photoIndex: params.photoIndex ?? 0, contentType: params.contentType ?? 'image/jpeg' }), pathParameters: { id: params.id ?? TEST_LISTING_ID }, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: `/listings/${params.id ?? TEST_LISTING_ID}/photo-url`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('listing-photo-url', () => {
  it('owner requests upload URL → 200 with uploadUrl and key', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.uploadUrl).toBeDefined();
    expect(body.key).toBeDefined();
  });

  it('key follows pattern listings/{listingId}/photos/{photoIndex}.jpg', async () => {
    const res = await handler(makeEvent({ photoIndex: '1' }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.key).toBe(`listings/${TEST_LISTING_ID}/photos/1.jpg`);
  });

  it('pre-signed URL expires in 300 seconds', async () => {
    await handler(makeEvent(), {} as any, () => {});
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ expiresIn: 300 }),
    );
  });

  it('not listing owner → 403', async () => {
    const res = await handler(makeEvent({}, mockAuthContext('other_user')), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });

  it('missing auth → 401', async () => {
    const res = await handler(makeEvent({}, { requestContext: {} } as any), {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  it('photoIndex 2 (not 0 or 1) → 400', async () => {
    const res = await handler(makeEvent({ photoIndex: '2' }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('invalid contentType → 400', async () => {
    const res = await handler(makeEvent({ contentType: 'text/plain' }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });
});
