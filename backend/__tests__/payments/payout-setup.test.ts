import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/users/payout-setup/index';
import { mockAuthContext } from '../setup';

const mockAccountCreate = jest.fn();
const mockAccountLinkCreate = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    paymentIntents: { create: jest.fn(), capture: jest.fn(), cancel: jest.fn() },
    refunds: { create: jest.fn() },
    accounts: { create: mockAccountCreate },
    accountLinks: { create: mockAccountLinkCreate },
    webhooks: { constructEvent: jest.fn() },
  }))
);

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: 'sk_test_mock' }),
  })),
  GetSecretValueCommand: jest.fn(),
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

const USER_ID = 'user-payout-test';
const userWithoutStripe = {
  PK: `USER#${USER_ID}`, SK: 'PROFILE',
  userId: USER_ID, email: 'host@spotzy.be', name: 'Test Host',
};
const userWithStripe = { ...userWithoutStripe, stripeConnectAccountId: 'acct_existing' };

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: userWithoutStripe });
  ddbMock.on(UpdateCommand).resolves({});
  mockAccountCreate.mockClear();
  mockAccountCreate.mockResolvedValue({ id: 'acct_new_test' });
  mockAccountLinkCreate.mockClear();
  mockAccountLinkCreate.mockResolvedValue({ url: 'https://connect.stripe.com/onboard/acct_new_test' });
});

const makeEvent = (auth = mockAuthContext(USER_ID)): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify({ country: 'BE' }), pathParameters: null, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: '/users/me/payout', multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('payout-setup', () => {
  it('first-time: creates Express account, stores accountId, returns onboardingUrl', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(JSON.parse(res!.body).onboardingUrl).toBeDefined();
    expect(mockAccountCreate).toHaveBeenCalledWith(expect.objectContaining({
      type: 'express',
      country: 'BE',
      email: 'host@spotzy.be',
    }));
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });

  it('accountLinks.create called with redirect URLs', async () => {
    await handler(makeEvent(), {} as any, () => {});
    expect(mockAccountLinkCreate).toHaveBeenCalledWith(expect.objectContaining({
      account: 'acct_new_test',
      type: 'account_onboarding',
    }));
  });

  it('returning user: skips account creation, creates new link for existing account', async () => {
    ddbMock.on(GetCommand).resolves({ Item: userWithStripe });
    mockAccountLinkCreate.mockResolvedValue({ url: 'https://connect.stripe.com/onboard/acct_existing' });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(mockAccountCreate).not.toHaveBeenCalled();
    expect(mockAccountLinkCreate).toHaveBeenCalledWith(expect.objectContaining({ account: 'acct_existing' }));
  });

  it('Stripe account creation fails → 500', async () => {
    mockAccountCreate.mockRejectedValue(new Error('Stripe error'));
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(500);
  });

  it('missing auth → 401', async () => {
    const res = await handler(makeEvent({ requestContext: {} } as any), {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });
});
