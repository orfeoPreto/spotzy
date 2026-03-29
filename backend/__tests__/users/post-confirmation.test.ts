import { PostConfirmationTriggerEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/users/post-confirmation/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const makeCognitoEvent = (sub: string, email: string, name = 'Test User'): PostConfirmationTriggerEvent =>
  ({
    version: '1',
    triggerSource: 'PostConfirmation_ConfirmSignUp',
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    userName: sub,
    callerContext: { awsSdkVersion: '3', clientId: 'test' },
    request: { userAttributes: { sub, email, name } },
    response: {},
  } as unknown as PostConfirmationTriggerEvent);

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(PutCommand).resolves({});
});

describe('post-confirmation trigger', () => {
  it('valid event → DynamoDB PutItem called with correct PK/SK', async () => {
    const event = makeCognitoEvent('user-123', 'user@test.com');
    await handler(event, {} as any, () => {});
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.PK).toBe('USER#user-123');
    expect(item.SK).toBe('PROFILE');
  });

  it('role=SPOTTER set by default', async () => {
    const event = makeCognitoEvent('user-123', 'user@test.com');
    await handler(event, {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.role).toBe('SPOTTER');
  });

  it('stripeConnectEnabled=false set', async () => {
    const event = makeCognitoEvent('user-123', 'user@test.com');
    await handler(event, {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.stripeConnectEnabled).toBe(false);
  });

  it('returns original Cognito event unchanged', async () => {
    const event = makeCognitoEvent('user-123', 'user@test.com');
    const result = await handler(event, {} as any, () => {});
    expect(result).toEqual(event);
  });

  it('GSI1PK = EMAIL#{email}', async () => {
    const event = makeCognitoEvent('user-123', 'user@test.com');
    await handler(event, {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.GSI1PK).toBe('EMAIL#user@test.com');
    expect(item.GSI1SK).toBe('USER#user-123');
  });

  it('user already exists → conditional write fails silently, returns event', async () => {
    const conditionalError = Object.assign(new Error('ConditionalCheckFailed'), { name: 'ConditionalCheckFailedException' });
    ddbMock.on(PutCommand).rejects(conditionalError);
    const event = makeCognitoEvent('user-123', 'user@test.com');
    const result = await handler(event, {} as any, () => {});
    expect(result).toEqual(event);
  });
});
