import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/admin/platform-fee-get/index';

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
    path: '/api/v1/admin/config/platform-fee',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent);

const mockNonAdminEvent = (): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: 'user-1', email: 'user@spotzy.com', 'cognito:groups': 'users' } },
      requestId: 'req-2',
    },
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/api/v1/admin/config/platform-fee',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
});

describe('admin-platform-fee-get', () => {
  test('returns platform fee config for admin', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'CONFIG#PLATFORM_FEE',
        SK: 'METADATA',
        singleShotPct: 0.15,
        blockReservationPct: 0.15,
        lastModifiedBy: null,
        lastModifiedAt: null,
        historyLog: [],
      },
    });

    const result = await handler(mockAdminEvent(), {} as any, {} as any);
    expect(result).toBeDefined();
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.singleShotPct).toBe(0.15);
    expect(body.blockReservationPct).toBe(0.15);
  });

  test('returns defaults when config record does not exist', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await handler(mockAdminEvent(), {} as any, {} as any);
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.singleShotPct).toBe(0.15);
    expect(body.blockReservationPct).toBe(0.15);
  });

  test('returns 403 for non-admin', async () => {
    const result = await handler(mockNonAdminEvent(), {} as any, {} as any);
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(403);
  });
});
