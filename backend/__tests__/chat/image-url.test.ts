import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { handler } from '../../functions/chat/image-url/index';

jest.mock('@aws-sdk/s3-request-presigner');

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);
const mockGetSignedUrl = getSignedUrl as jest.MockedFunction<typeof getSignedUrl>;

const BOOKING_ID = 'booking_01HX1234';
const SPOTTER_ID = 'user_spotter';
const HOST_ID = 'user_host';
const UNRELATED_ID = 'user_unrelated';

const makeBooking = (overrides: Record<string, unknown> = {}) => ({
  bookingId: BOOKING_ID,
  spotterId: SPOTTER_ID,
  hostId: HOST_ID,
  status: 'CONFIRMED',
  ...overrides,
});

const makeEvent = (bookingId: string, userId: string): APIGatewayProxyEvent =>
  ({
    pathParameters: { bookingId },
    body: null,
    headers: {},
    queryStringParameters: {},
    requestContext: {
      requestId: 'test',
      authorizer: { claims: { sub: userId, email: 'test@spotzy.be' } },
    },
  } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  mockGetSignedUrl.mockResolvedValue('https://s3.example.com/presigned-url');
});

describe('chat-image-url', () => {
  test('spotter can generate pre-signed PUT URL', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeBooking() });

    const res = await handler(makeEvent(BOOKING_ID, SPOTTER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.uploadUrl).toBeDefined();
    expect(body.key).toMatch(/^chat\/booking_01HX1234\//);
    expect(body.publicUrl).toBeDefined();
  });

  test('host can also generate pre-signed PUT URL', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeBooking() });

    const res = await handler(makeEvent(BOOKING_ID, HOST_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  test('URL key is in chat/{bookingId}/{messageId}.jpg format', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeBooking() });
    mockGetSignedUrl.mockResolvedValue('https://signed.url');

    const res = await handler(makeEvent(BOOKING_ID, SPOTTER_ID), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.key).toMatch(/^chat\/booking_01HX1234\/[A-Z0-9]+\.jpg$/);
  });

  test('unrelated user → 403', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeBooking() });

    const res = await handler(makeEvent(BOOKING_ID, UNRELATED_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });

  test('booking not found → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const res = await handler(makeEvent('nonexistent', SPOTTER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  test('unauthenticated → 401', async () => {
    const event = {
      pathParameters: { bookingId: BOOKING_ID },
      body: null, headers: {}, queryStringParameters: {},
      requestContext: { requestId: 'test' },
    } as unknown as APIGatewayProxyEvent;

    const res = await handler(event, {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });
});
