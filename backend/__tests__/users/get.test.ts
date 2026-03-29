import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/users/get/index';
import { mockAuthContext, TEST_USER_ID } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

const existingUser = {
  PK: `USER#${TEST_USER_ID}`, SK: 'PROFILE',
  userId: TEST_USER_ID,
  email: 'test@spotzy.com',
  name: 'Test User',
  role: 'HOST',
  stripeConnectAccountId: 'acct_secret_123',
  stripeConnectEnabled: true,
  createdAt: '2025-01-01T00:00:00.000Z',
};

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: existingUser });
  ddbMock.on(PutCommand).resolves({});
});

const makeEvent = (auth = mockAuthContext()): APIGatewayProxyEvent =>
  ({ ...auth, body: null, pathParameters: null, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false, path: '/users/me', multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('user-get', () => {
  it('existing user → 200 with profile', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.userId).toBe(TEST_USER_ID);
  });

  it('stripeConnectAccountId NOT in response (stripped)', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.stripeConnectAccountId).toBeUndefined();
  });

  it('role and stripeConnectEnabled ARE in response', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.role).toBeDefined();
    expect(body.stripeConnectEnabled).toBeDefined();
  });

  it('user not found → auto-creates with role=SPOTTER, returns 200', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    const body = JSON.parse(res!.body);
    expect(body.role).toBe('SPOTTER');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });

  it('missing auth → 401', async () => {
    const res = await handler(makeEvent({ requestContext: {} } as any), {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });
});
