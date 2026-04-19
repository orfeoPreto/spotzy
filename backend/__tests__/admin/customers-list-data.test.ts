import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/admin/customers-list/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const mockAdminEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: 'admin-1', email: 'admin@spotzy.be', 'cognito:groups': 'admin' } },
      requestId: 'req-1',
    },
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/api/v1/admin/customers',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent);

const usersWithPseudo = [
  {
    PK: 'USER#u1', SK: 'PROFILE',
    userId: 'u1', pseudo: 'Marc from Brussels', firstName: 'Marc', lastName: 'Durand',
    email: 'marc@test.com', stripeConnectAccountId: 'acct_1',
  },
];

const usersWithoutPseudo = [
  {
    PK: 'USER#u2', SK: 'PROFILE',
    userId: 'u2', pseudo: null, firstName: 'Jean', lastName: 'Pierre',
    email: 'jean@test.com',
  },
];

const minimalUsers = [
  { PK: 'USER#u3', SK: 'PROFILE', userId: 'u3', email: 'min@test.com' },
  { PK: 'USER#u4', SK: 'PROFILE', userId: 'u4', firstName: 'Sophie', email: 'sophie@test.com' },
];

describe('admin-customers-list data mapping', () => {
  beforeEach(() => {
    ddbMock.reset();
    // Default: empty for query commands (listings, bookings, reviews)
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });
  });

  it('displayName uses pseudo when available', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: usersWithPseudo });
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers[0].displayName).toBe('Marc from Brussels');
  });

  it('displayName falls back to firstName when pseudo is null', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: usersWithoutPseudo });
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers[0].displayName).toBe('Jean');
  });

  it('displayName falls back to "Unknown" when no pseudo and no firstName', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [{ PK: 'USER#u5', SK: 'PROFILE', userId: 'u5', email: 'anon@test.com' }] });
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers[0].displayName).toBe('Unknown');
  });

  it('fullName is firstName + lastName', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: usersWithPseudo });
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers[0].fullName).toBe('Marc Durand');
  });

  it('rating is computed from review averages', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: usersWithPseudo });
    // Reviews query returns ratings
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [{ avgScore: 4 }, { avgScore: 5 }], Count: 2 }) // reviews for u1
      .resolves({ Items: [], Count: 0 }); // listings, bookings
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers[0].rating).toBe(4.5);
  });

  it('rating is null when user has no reviews', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: usersWithPseudo });
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers[0].rating).toBeNull();
  });

  it('listingCount reflects actual listing count from GSI', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: usersWithPseudo });
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [], Count: 0 }) // reviews
      .resolvesOnce({ Items: [{}, {}, {}], Count: 3 }) // listings
      .resolves({ Items: [], Count: 0 }); // bookings
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers[0].listingCount).toBe(3);
  });

  it('bookingCount reflects bookings as spotter + host', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: usersWithPseudo });
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [], Count: 0 }) // reviews
      .resolvesOnce({ Items: [], Count: 0 }) // listings
      .resolvesOnce({ Items: [{}, {}], Count: 2 }) // bookings as spotter
      .resolvesOnce({ Items: [{}], Count: 1 }); // bookings as host
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers[0].bookingCount).toBe(3);
  });

  it('personas includes HOST when stripeConnectAccountId is set', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: usersWithPseudo });
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers[0].personas).toContain('HOST');
    expect(customers[0].personas).toContain('SPOTTER');
  });

  it('personas includes only SPOTTER when no stripeConnectAccountId', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: usersWithoutPseudo });
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers[0].personas).toContain('SPOTTER');
    expect(customers[0].personas).not.toContain('HOST');
  });

  it('all rows have required fields — no undefined for required fields', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [...usersWithPseudo, ...usersWithoutPseudo, ...minimalUsers] });
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    customers.forEach((c: any) => {
      expect(c.userId).toBeDefined();
      expect(c.displayName).toBeTruthy();
      expect(c.fullName).toBeDefined();
      expect(c.email).toBeDefined();
      expect(c.personas).toBeInstanceOf(Array);
      expect(typeof c.listingCount).toBe('number');
      expect(typeof c.bookingCount).toBe('number');
      expect('rating' in c).toBe(true);
    });
  });
});
