import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/users/update/index';
import { mockAuthContext, TEST_USER_ID } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

const existingUser = {
  PK: `USER#${TEST_USER_ID}`, SK: 'PROFILE',
  userId: TEST_USER_ID, email: 'test@spotzy.be',
  name: 'Old Name', phone: '+32471000001',
  vehicles: [],
};

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: existingUser });
  ddbMock.on(UpdateCommand).resolves({ Attributes: existingUser });
});

const makeEvent = (body: object, auth = mockAuthContext()): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify(body), pathParameters: null, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'PUT', isBase64Encoded: false, path: '/users/me', multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('user-update', () => {
  it('update name → 200', async () => {
    const res = await handler(makeEvent({ name: 'New Name' }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('update vehicles → stored', async () => {
    const res = await handler(makeEvent({ vehicles: [{ plate: 'ABC123', make: 'Toyota', model: 'Yaris' }] }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('phone change → phone saved directly, no OTP', async () => {
    await handler(makeEvent({ phone: '+32471000099' }), {} as any, () => {});
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    const vals = call.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain('+32471000099'); // phone saved directly
  });

  it('vehicle with empty plate → 400', async () => {
    const res = await handler(makeEvent({ vehicles: [{ plate: '', make: 'Toyota' }] }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('vehicle plate over 15 chars → 400', async () => {
    const res = await handler(makeEvent({ vehicles: [{ plate: 'TOOLONGPLATE1234', make: 'Toyota' }] }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('more than 5 vehicles → 400 MAX_VEHICLES_EXCEEDED', async () => {
    const vehicles = Array.from({ length: 6 }, (_, i) => ({ plate: `PLATE${i}`, make: 'Car' }));
    const res = await handler(makeEvent({ vehicles }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('MAX_VEHICLES_EXCEEDED');
  });

  it('userId in body → ignored', async () => {
    await handler(makeEvent({ userId: 'hacker', name: 'New Name' }), {} as any, () => {});
    const expr = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.UpdateExpression as string;
    expect(expr).not.toContain('userId');
  });

  it('email in body → ignored', async () => {
    await handler(makeEvent({ email: 'hacker@evil.com', name: 'New Name' }), {} as any, () => {});
    const expr = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.UpdateExpression as string;
    expect(expr).not.toContain('email');
  });

  it('empty pseudo string → stores null', async () => {
    await handler(makeEvent({ pseudo: '' }), {} as any, () => {});
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    const vals = call.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain(null);
  });
});
