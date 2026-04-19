import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const adminDisableUserMock = jest.fn().mockResolvedValue({});
  return {
    CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({
      send: adminDisableUserMock,
    })),
    AdminDisableUserCommand: jest.fn().mockImplementation((input) => ({ input })),
    __adminDisableUserMock: adminDisableUserMock,
  };
});

import { handler } from '../../functions/admin/customer-suspend/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const userProfile = {
  PK: 'USER#u1', SK: 'PROFILE',
  userId: 'u1', email: 'user@test.com', status: 'ACTIVE',
};

const mockAdminEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: 'admin-1', email: 'admin@spotzy.be', 'cognito:groups': 'admin' } },
      requestId: 'req-1',
    },
    body: JSON.stringify({ reason: 'Multiple fraud complaints' }),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/api/v1/admin/customers/u1/suspend',
    pathParameters: { userId: 'u1' },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: userProfile });
  ddbMock.on(UpdateCommand).resolves({});
  const { __adminDisableUserMock } = require('@aws-sdk/client-cognito-identity-provider');
  __adminDisableUserMock.mockClear();
});

describe('admin-customer-suspend', () => {
  it('sets user status=SUSPENDED and disables Cognito login', async () => {
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const vals = updateCalls[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(vals[':status']).toBe('SUSPENDED');

    const { __adminDisableUserMock } = require('@aws-sdk/client-cognito-identity-provider');
    expect(__adminDisableUserMock).toHaveBeenCalled();
  });

  it('requires reason field — returns 400 if missing', async () => {
    const result = await handler(mockAdminEvent({
      body: JSON.stringify({}),
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
    expect(JSON.parse(result!.body).error).toBe('REASON_REQUIRED');
  });

  it('non-admin returns 403', async () => {
    const event = mockAdminEvent({
      requestContext: {
        authorizer: { claims: { sub: 'u1', email: 'u@s.com', 'cognito:groups': 'users' } },
        requestId: 'r',
      } as any,
    });
    const result = await handler(event, {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });

  it('returns 404 if user not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const result = await handler(mockAdminEvent(), {} as any, () => {});
    expect(result!.statusCode).toBe(404);
  });
});
