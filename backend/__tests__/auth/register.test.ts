import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, SignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/auth/register/index';

const ddbMock = mockClient(DynamoDBDocumentClient);
const cognitoMock = mockClient(CognitoIdentityProviderClient);

beforeEach(() => {
  ddbMock.reset();
  cognitoMock.reset();
  cognitoMock.on(SignUpCommand).resolves({ UserSub: 'user_new123' });
  ddbMock.on(PutCommand).resolves({});
});

const makeEvent = (body: Record<string, unknown>): APIGatewayProxyEvent =>
  ({
    body: JSON.stringify(body),
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/auth/register',
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
    requestContext: { requestId: 'test' },
  } as unknown as APIGatewayProxyEvent);

const validBody = {
  email: 'test@spotzy.be',
  password: 'Str0ngP@ss!',
  firstName: 'Jean',
  lastName: 'Dupont',
  role: 'SPOTTER',
};

describe('auth-register', () => {
  it('pseudo stored when provided', async () => {
    await handler(makeEvent({ ...validBody, pseudo: 'JeannyBoy' }), {} as any, () => {});
    const putCall = ddbMock.commandCalls(PutCommand)[0];
    const item = putCall.args[0].input.Item as Record<string, unknown>;
    expect(item.pseudo).toBe('JeannyBoy');
  });

  it('pseudo defaults to firstName when empty', async () => {
    await handler(makeEvent({ ...validBody, pseudo: '' }), {} as any, () => {});
    const putCall = ddbMock.commandCalls(PutCommand)[0];
    const item = putCall.args[0].input.Item as Record<string, unknown>;
    expect(item.pseudo).toBe('Jean');
  });

  it('pseudo defaults to firstName when not provided', async () => {
    await handler(makeEvent(validBody), {} as any, () => {});
    const putCall = ddbMock.commandCalls(PutCommand)[0];
    const item = putCall.args[0].input.Item as Record<string, unknown>;
    expect(item.pseudo).toBe('Jean');
  });

  it('showFullNamePublicly defaults to false', async () => {
    await handler(makeEvent(validBody), {} as any, () => {});
    const putCall = ddbMock.commandCalls(PutCommand)[0];
    const item = putCall.args[0].input.Item as Record<string, unknown>;
    expect(item.showFullNamePublicly).toBe(false);
  });

  it('profilePhotoUrl defaults to null', async () => {
    await handler(makeEvent(validBody), {} as any, () => {});
    const putCall = ddbMock.commandCalls(PutCommand)[0];
    const item = putCall.args[0].input.Item as Record<string, unknown>;
    expect(item.profilePhotoUrl).toBeNull();
  });
});
