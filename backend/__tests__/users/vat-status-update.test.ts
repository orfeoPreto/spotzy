import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/users/vat-status-update/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const mockAuthEvent = (body: Record<string, unknown> = {}): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: 'user-1', email: 'user@spotzy.com' } },
      requestId: 'req-1',
    },
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'PATCH',
    isBase64Encoded: false,
    path: '/api/v1/users/me/vat-status',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

const mockUnauthEvent = (body: Record<string, unknown> = {}): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: {},
      requestId: 'req-2',
    },
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'PATCH',
    isBase64Encoded: false,
    path: '/api/v1/users/me/vat-status',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

const existingProfile = {
  PK: 'USER#user-1',
  SK: 'PROFILE',
  userId: 'user-1',
  email: 'user@spotzy.com',
  vatStatus: 'NONE',
};

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: existingProfile });
  ddbMock.on(UpdateCommand).resolves({
    Attributes: { ...existingProfile, vatStatus: 'EXEMPT_FRANCHISE' },
  });
});

describe('user-vat-status-update', () => {
  test('set EXEMPT_FRANCHISE returns 200', async () => {
    const result = await handler(mockAuthEvent({ vatStatus: 'EXEMPT_FRANCHISE' }), {} as any, {} as any);
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.vatStatus).toBe('EXEMPT_FRANCHISE');
  });

  test('set VAT_REGISTERED with valid number returns 200', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { ...existingProfile, vatStatus: 'VAT_REGISTERED', vatNumber: 'BE0123456749' },
    });
    const result = await handler(mockAuthEvent({
      vatStatus: 'VAT_REGISTERED',
      vatNumber: 'BE0123456749',
    }), {} as any, {} as any);
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.vatStatus).toBe('VAT_REGISTERED');
    expect(body.vatNumber).toBe('BE0123456749');
  });

  test('VAT_REGISTERED without vatNumber returns 400 VAT_NUMBER_REQUIRED', async () => {
    const result = await handler(mockAuthEvent({ vatStatus: 'VAT_REGISTERED' }), {} as any, {} as any);
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VAT_NUMBER_REQUIRED');
  });

  test('VAT_REGISTERED with invalid format returns 400 VAT_NUMBER_INVALID_FORMAT', async () => {
    const result = await handler(mockAuthEvent({
      vatStatus: 'VAT_REGISTERED',
      vatNumber: 'INVALID',
    }), {} as any, {} as any);
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VAT_NUMBER_INVALID_FORMAT');
  });

  test('VAT_REGISTERED with bad checksum returns 400 VAT_NUMBER_INVALID_CHECKSUM', async () => {
    const result = await handler(mockAuthEvent({
      vatStatus: 'VAT_REGISTERED',
      vatNumber: 'BE0123456799',
    }), {} as any, {} as any);
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VAT_NUMBER_INVALID_CHECKSUM');
  });

  test('invalid vatStatus returns 400 INVALID_VAT_STATUS', async () => {
    const result = await handler(mockAuthEvent({ vatStatus: 'BOGUS' }), {} as any, {} as any);
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_VAT_STATUS');
  });

  test('unauthenticated returns 401', async () => {
    const result = await handler(mockUnauthEvent({ vatStatus: 'EXEMPT_FRANCHISE' }), {} as any, {} as any);
    const res = result as { statusCode: number; body: string };
    expect(res.statusCode).toBe(401);
  });

  test('first VAT_REGISTERED transition sets vatRegisteredSince', async () => {
    // Profile has no vatRegisteredSince
    ddbMock.on(GetCommand).resolves({ Item: { ...existingProfile, vatRegisteredSince: undefined } });
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { ...existingProfile, vatStatus: 'VAT_REGISTERED', vatNumber: 'BE0123456749' },
    });

    await handler(mockAuthEvent({
      vatStatus: 'VAT_REGISTERED',
      vatNumber: 'BE0123456749',
    }), {} as any, {} as any);

    const updateCall = ddbMock.commandCalls(UpdateCommand)[0];
    const expr = updateCall.args[0].input.UpdateExpression as string;
    expect(expr).toContain('vatRegisteredSince');
  });
});
