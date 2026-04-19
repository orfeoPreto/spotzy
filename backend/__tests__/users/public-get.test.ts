import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/users/public-get/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const USER_ID = 'user_01HX1234';
const CALLER_ID = 'user_caller';

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  PK: `USER#${USER_ID}`,
  SK: 'PROFILE',
  userId: USER_ID,
  name: 'Jean Dupont',
  email: 'jean@example.com',
  phone: '+3200000000',
  address: '1 Rue de la Loi, Brussels',
  stripeConnectAccountId: 'acct_test123',
  createdAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

const makeEvent = (userId: string, callerId: string): APIGatewayProxyEvent =>
  ({
    pathParameters: { id: userId },
    body: null,
    headers: {},
    queryStringParameters: {},
    requestContext: {
      requestId: 'test',
      authorizer: { claims: { sub: callerId, email: 'caller@spotzy.be' } },
    },
  } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
});

describe('user-public-get', () => {
  test('returns name as first name + last initial', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeUser() });
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(makeEvent(USER_ID, CALLER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.name).toBe('Jean D.');
  });

  test('never returns email, phone, address, or stripeConnectAccountId', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeUser() });
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(makeEvent(USER_ID, CALLER_ID), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.email).toBeUndefined();
    expect(body.phone).toBeUndefined();
    expect(body.address).toBeUndefined();
    expect(body.stripeConnectAccountId).toBeUndefined();
  });

  test('for host: includes LIVE listings', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeUser() });
    ddbMock.on(QueryCommand).callsFake((input) => {
      const eav = input.ExpressionAttributeValues ?? {};
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('HOST#')) {
        return {
          Items: [{
            listingId: 'l1', address: '1 Main St', spotType: 'COVERED_GARAGE',
            pricePerHour: 3, status: 'live', photos: ['p.jpg'],
          }],
        };
      }
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('SPOTTER#')) {
        return { Items: [] };
      }
      if ((eav[':pk'] as string)?.startsWith('REVIEW#')) {
        return { Items: [] };
      }
      return { Items: [] };
    });

    const res = await handler(makeEvent(USER_ID, CALLER_ID), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0].listingId).toBe('l1');
  });

  test('only published reviews shown', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeUser() });
    ddbMock.on(QueryCommand).callsFake((input) => {
      const eav = input.ExpressionAttributeValues ?? {};
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('HOST#')) {
        return { Items: [] };
      }
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('SPOTTER#')) {
        return { Items: [] };
      }
      if ((eav[':pk'] as string)?.startsWith('REVIEW#')) {
        return {
          Items: [
            { reviewId: 'r1', rating: 5, comment: 'Great!', published: true, createdAt: '2026-01-01' },
            { reviewId: 'r2', rating: 3, comment: 'Ok', published: false, createdAt: '2026-01-02' },
          ],
        };
      }
      return { Items: [] };
    });

    const res = await handler(makeEvent(USER_ID, CALLER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  test('any authenticated user can access → 200', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeUser() });
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(makeEvent(USER_ID, 'any-user'), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  test('user not found → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const res = await handler(makeEvent('nonexistent', CALLER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  test('unauthenticated → 401', async () => {
    const event = {
      pathParameters: { id: USER_ID },
      body: null, headers: {}, queryStringParameters: {},
      requestContext: { requestId: 'test' },
    } as unknown as APIGatewayProxyEvent;

    const res = await handler(event, {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  test('profile includes completedBookings count', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeUser() });
    ddbMock.on(QueryCommand).callsFake((input) => {
      const eav = input.ExpressionAttributeValues ?? {};
      // HOST# listings
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('HOST#')) {
        return { Items: [] };
      }
      // REVIEW# query
      if ((eav[':pk'] as string)?.startsWith('REVIEW#')) {
        return { Items: [] };
      }
      // SPOTTER# bookings
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('SPOTTER#')) {
        return {
          Items: [
            { bookingId: 'b1', status: 'COMPLETED' },
            { bookingId: 'b2', status: 'COMPLETED' },
            { bookingId: 'b3', status: 'COMPLETED' },
            { bookingId: 'b4', status: 'COMPLETED' },
            { bookingId: 'b5', status: 'COMPLETED' },
            { bookingId: 'b6', status: 'COMPLETED' },
            { bookingId: 'b7', status: 'COMPLETED' },
            { bookingId: 'b8', status: 'CONFIRMED' },
          ],
        };
      }
      return { Items: [] };
    });

    const res = await handler(makeEvent(USER_ID, CALLER_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.completedBookings).toBe(7);
  });

  test('profile includes responseRate when >= 5 completed bookings', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeUser() });
    ddbMock.on(QueryCommand).callsFake((input) => {
      const eav = input.ExpressionAttributeValues ?? {};
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('HOST#')) {
        return { Items: [] };
      }
      if ((eav[':pk'] as string)?.startsWith('REVIEW#')) {
        return { Items: [] };
      }
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('SPOTTER#')) {
        return {
          Items: Array.from({ length: 6 }, (_, i) => ({ bookingId: `b${i}`, status: 'COMPLETED' })),
        };
      }
      return { Items: [] };
    });

    const res = await handler(makeEvent(USER_ID, CALLER_ID), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.responseRate).toBeGreaterThanOrEqual(0);
    expect(body.responseRate).toBeLessThanOrEqual(100);
  });

  test('showFullNamePublicly=false → fullName undefined in response', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeUser({ firstName: 'Jean', lastName: 'Dupont', showFullNamePublicly: false }) });
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(makeEvent(USER_ID, CALLER_ID), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.fullName).toBeUndefined();
  });

  test('showFullNamePublicly=true → fullName = "Jean Dupont"', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeUser({ firstName: 'Jean', lastName: 'Dupont', showFullNamePublicly: true }) });
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(makeEvent(USER_ID, CALLER_ID), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.fullName).toBe('Jean Dupont');
  });

  test('displayName uses pseudo when available, falls back to firstName', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeUser({ pseudo: 'JeannyBoy', firstName: 'Jean' }) });
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(makeEvent(USER_ID, CALLER_ID), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.displayName).toBe('JeannyBoy');

    // fallback to firstName
    ddbMock.on(GetCommand).resolves({ Item: makeUser({ pseudo: undefined, firstName: 'Jean' }) });
    const res2 = await handler(makeEvent(USER_ID, CALLER_ID), {} as any, () => {});
    const body2 = JSON.parse(res2!.body);
    expect(body2.displayName).toBe('Jean');
  });

  test('responseRate is null when < 5 completed bookings', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeUser() });
    ddbMock.on(QueryCommand).callsFake((input) => {
      const eav = input.ExpressionAttributeValues ?? {};
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('HOST#')) {
        return { Items: [] };
      }
      if ((eav[':pk'] as string)?.startsWith('REVIEW#')) {
        return { Items: [] };
      }
      if (input.IndexName === 'GSI1' && (eav[':pk'] as string)?.startsWith('SPOTTER#')) {
        return {
          Items: [
            { bookingId: 'b1', status: 'COMPLETED' },
            { bookingId: 'b2', status: 'COMPLETED' },
            { bookingId: 'b3', status: 'CONFIRMED' },
          ],
        };
      }
      return { Items: [] };
    });

    const res = await handler(makeEvent(USER_ID, CALLER_ID), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.responseRate).toBeNull();
  });
});
