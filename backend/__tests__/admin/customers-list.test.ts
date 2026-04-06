import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/admin/customers-list/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const mockAdminEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: 'admin-1', email: 'admin@spotzy.com', 'cognito:groups': 'admin' } },
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

const users = [
  {
    PK: 'USER#u1', SK: 'PROFILE',
    userId: 'u1', displayName: 'MarcDurand', pseudo: 'MarcDurand',
    firstName: 'Marc', lastName: 'Durand', email: 'marc@test.com',
    stripeConnectAccountId: 'acct_1', rating: 4.5,
    listingCount: 2, bookingCount: 5, disputeCount: 0,
  },
  {
    PK: 'USER#u2', SK: 'PROFILE',
    userId: 'u2', displayName: 'SophieLeroux', pseudo: 'SophieLeroux',
    firstName: 'Sophie', lastName: 'Leroux', email: 'sophie@test.com',
    rating: 3.8,
    listingCount: 0, bookingCount: 3, disputeCount: 1,
  },
  {
    PK: 'USER#u3', SK: 'PROFILE',
    userId: 'u3', displayName: 'JeanPierre', pseudo: 'JeanPierre',
    firstName: 'Jean', lastName: 'Pierre', email: 'jean@test.com',
    stripeConnectAccountId: 'acct_3', rating: 4.9,
    listingCount: 5, bookingCount: 10, disputeCount: 0,
  },
];

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(ScanCommand).resolves({ Items: users });
  ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });
});

describe('admin-customers-list', () => {
  it('returns paginated list of users', async () => {
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.customers.length).toBeLessThanOrEqual(25);
    expect(body.total).toBeDefined();
    expect(body.page).toBe(1);
  });

  it('each customer has required fields', async () => {
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    const customer = JSON.parse(result!.body).customers[0];
    expect(customer).toHaveProperty('userId');
    expect(customer).toHaveProperty('displayName');
    expect(customer).toHaveProperty('fullName');
    expect(customer).toHaveProperty('email');
    expect(customer).toHaveProperty('personas');
    expect(customer).toHaveProperty('rating');
    expect(customer).toHaveProperty('listingCount');
    expect(customer).toHaveProperty('bookingCount');
  });

  it('supports sortBy=rating descending', async () => {
    const result = await handler(mockAdminEvent({
      queryStringParameters: { sortBy: 'rating', sortDir: 'desc' },
    }), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    for (let i = 1; i < customers.length; i++) {
      expect(customers[i - 1].rating >= customers[i].rating).toBe(true);
    }
  });

  it('search by name returns matching users', async () => {
    const result = await handler(mockAdminEvent({
      queryStringParameters: { search: 'Marc' },
    }), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers.length).toBe(1);
    expect(customers[0].displayName).toBe('MarcDurand');
  });

  it('filter=hosts returns only users with stripeConnectAccountId', async () => {
    const result = await handler(mockAdminEvent({
      queryStringParameters: { filter: 'hosts' },
    }), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers.every((c: any) => c.isHost === true)).toBe(true);
    expect(customers.length).toBe(2);
  });

  it('filter=has_disputes returns only users with disputeCount > 0', async () => {
    const result = await handler(mockAdminEvent({
      queryStringParameters: { filter: 'has_disputes' },
    }), {} as any, () => {});
    const { customers } = JSON.parse(result!.body);
    expect(customers.every((c: any) => c.disputeCount > 0)).toBe(true);
    expect(customers.length).toBe(1);
  });

  it('non-admin returns 403', async () => {
    const event = mockAdminEvent({
      requestContext: {
        authorizer: { claims: { sub: 'user-1', email: 'u@s.com', 'cognito:groups': 'users' } },
        requestId: 'req-2',
      } as any,
    });
    const result = await handler(event, {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });
});
