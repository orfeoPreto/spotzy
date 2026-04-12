import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/listings/photo-reorder/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const LISTING_ID = 'listing_01HX5678';
const HOST_ID = 'user_01HX1234';
const OTHER_ID = 'user_other';

const makeEvent = (listingId: string, userId: string, body: unknown): APIGatewayProxyEvent =>
  ({
    pathParameters: { id: listingId },
    body: JSON.stringify(body),
    headers: {},
    queryStringParameters: {},
    requestContext: {
      requestId: 'test',
      authorizer: { claims: { sub: userId, email: 'test@spotzy.com' } },
    },
  } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
});

describe('listing-photo-reorder', () => {
  test('reorders photos array to new sequence', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        listingId: LISTING_ID, hostId: HOST_ID,
        photos: ['photo0.jpg', 'photo1.jpg', 'photo2.jpg'],
      },
    });
    ddbMock.on(UpdateCommand).resolves({});

    const res = await handler(makeEvent(LISTING_ID, HOST_ID, { order: [2, 0, 1] }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.photos).toEqual(['photo2.jpg', 'photo0.jpg', 'photo1.jpg']);
    expect(body.reordered).toBe(true);
  });

  test('index 0 of result is the new primary photo', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        listingId: LISTING_ID, hostId: HOST_ID,
        photos: ['old-primary.jpg', 'secondary.jpg'],
      },
    });
    ddbMock.on(UpdateCommand).resolves({});

    const res = await handler(makeEvent(LISTING_ID, HOST_ID, { order: [1, 0] }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.photos[0]).toBe('secondary.jpg');
  });

  test('order array with wrong length → 400 ORDER_MISMATCH', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        listingId: LISTING_ID, hostId: HOST_ID,
        photos: ['photo0.jpg', 'photo1.jpg', 'photo2.jpg'],
      },
    });

    const res = await handler(makeEvent(LISTING_ID, HOST_ID, { order: [0, 1] }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    const body = JSON.parse(res!.body);
    expect(body.error).toBe('ORDER_MISMATCH');
  });

  test('order array with invalid indices → 400 ORDER_MISMATCH', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        listingId: LISTING_ID, hostId: HOST_ID,
        photos: ['photo0.jpg', 'photo1.jpg'],
      },
    });

    // Duplicate index instead of unique indices
    const res = await handler(makeEvent(LISTING_ID, HOST_ID, { order: [0, 0] }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  test('not the owner → 403', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { listingId: LISTING_ID, hostId: HOST_ID, photos: ['p0.jpg', 'p1.jpg'] },
    });

    const res = await handler(makeEvent(LISTING_ID, OTHER_ID, { order: [1, 0] }), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });
});
