import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/listings/photo-delete/index';

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

const LISTING_ID = 'listing_01HX5678';
const HOST_ID = 'user_01HX1234';
const OTHER_ID = 'user_other';

const makeEvent = (listingId: string, index: string, userId: string): APIGatewayProxyEvent =>
  ({
    pathParameters: { id: listingId, index },
    body: null,
    headers: {},
    queryStringParameters: {},
    requestContext: {
      requestId: 'test',
      authorizer: { claims: { sub: userId, email: 'test@spotzy.com' } },
    },
  } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  s3Mock.on(DeleteObjectCommand).resolves({});
});

describe('listing-photo-delete', () => {
  test('deletes photo at given index and shifts remaining photos down', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        listingId: LISTING_ID, hostId: HOST_ID, status: 'live',
        photos: ['photo0.jpg', 'photo1.jpg', 'photo2.jpg'],
      },
    });
    ddbMock.on(UpdateCommand).resolves({});

    const res = await handler(makeEvent(LISTING_ID, '1', HOST_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.deleted).toBe(true);
    expect(body.photos).toEqual(['photo0.jpg', 'photo2.jpg']);
    expect(body.photos).toHaveLength(2);
  });

  test('cannot delete if only 1 photo remains → 400 MINIMUM_PHOTO_REQUIRED', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        listingId: LISTING_ID, hostId: HOST_ID, status: 'live',
        photos: ['photo0.jpg'],
      },
    });

    const res = await handler(makeEvent(LISTING_ID, '0', HOST_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    const body = JSON.parse(res!.body);
    expect(body.code).toBe('MINIMUM_PHOTO_REQUIRED');
  });

  test('deletes from S3 as well as DynamoDB', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        listingId: LISTING_ID, hostId: HOST_ID, status: 'live',
        photos: ['photo0.jpg', 'photo1.jpg'],
      },
    });
    ddbMock.on(UpdateCommand).resolves({});

    await handler(makeEvent(LISTING_ID, '0', HOST_ID), {} as any, () => {});
    const s3Calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(s3Calls.length).toBeGreaterThan(0);
  });

  test('not the owner → 403', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { listingId: LISTING_ID, hostId: HOST_ID, photos: ['p0.jpg', 'p1.jpg'] },
    });

    const res = await handler(makeEvent(LISTING_ID, '0', OTHER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });

  test('listing not found → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const res = await handler(makeEvent('nonexistent', '0', HOST_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });
});
