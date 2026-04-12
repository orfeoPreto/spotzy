import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/listings/delete/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const LISTING_ID = 'listing_01HX5678';
const HOST_ID = 'user_01HX1234';
const OTHER_ID = 'user_other';

const makeListing = (overrides: Record<string, unknown> = {}) => ({
  listingId: LISTING_ID, hostId: HOST_ID, status: 'live', ...overrides,
});

const makeEvent = (listingId: string, userId: string): APIGatewayProxyEvent =>
  ({
    pathParameters: { id: listingId },
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
});

describe('listing-delete', () => {
  test('listing with no bookings → hard delete', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [] })  // bookings
      .resolvesOnce({ Items: [] }); // avail rules
    ddbMock.on(DeleteCommand).resolves({});

    const res = await handler(makeEvent(LISTING_ID, HOST_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.deleted).toBe(true);
  });

  test('listing with only cancelled bookings → archive instead of delete', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });
    ddbMock.on(QueryCommand).resolves({
      Items: [{ bookingId: 'b1', status: 'CANCELLED' }],
    });
    ddbMock.on(UpdateCommand).resolves({});

    const res = await handler(makeEvent(LISTING_ID, HOST_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.archived).toBe(true);
    expect(body.reason).toBe('BOOKING_HISTORY_EXISTS');
  });

  test('listing with CONFIRMED booking → 409 ACTIVE_BOOKING_EXISTS', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });
    ddbMock.on(QueryCommand).resolves({
      Items: [{ bookingId: 'b1', status: 'CONFIRMED' }],
    });

    const res = await handler(makeEvent(LISTING_ID, HOST_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    const body = JSON.parse(res!.body);
    expect(body.error).toBe('ACTIVE_BOOKING_EXISTS');
  });

  test('listing with ACTIVE booking → 409 ACTIVE_BOOKING_EXISTS', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });
    ddbMock.on(QueryCommand).resolves({
      Items: [{ bookingId: 'b1', status: 'ACTIVE' }],
    });

    const res = await handler(makeEvent(LISTING_ID, HOST_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
  });

  test('not the owner → 403', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });

    const res = await handler(makeEvent(LISTING_ID, OTHER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });

  test('listing not found → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const res = await handler(makeEvent('nonexistent', HOST_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  test('also deletes all AVAIL_RULE# records on hard delete', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeListing() });
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [] }) // bookings
      .resolvesOnce({             // avail rules
        Items: [
          { PK: `LISTING#${LISTING_ID}`, SK: 'AVAIL_RULE#r1' },
          { PK: `LISTING#${LISTING_ID}`, SK: 'AVAIL_RULE#r2' },
        ],
      });
    ddbMock.on(BatchWriteCommand).resolves({});
    ddbMock.on(DeleteCommand).resolves({});

    const res = await handler(makeEvent(LISTING_ID, HOST_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    expect(batchCalls.length).toBeGreaterThan(0);
  });
});
