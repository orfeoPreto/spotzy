import { APIGatewayProxyEvent } from 'aws-lambda';
import { extractAdminClaims } from '../../shared/utils/admin-guard';

const buildEvent = (groups?: string, sub = 'admin-1', email = 'admin@spotzy.be'): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: {
        claims: {
          sub,
          email,
          ...(groups !== undefined ? { 'cognito:groups': groups } : {}),
        },
      },
    },
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

describe('extractAdminClaims', () => {
  it('returns claims when cognito:groups contains admin', () => {
    const result = extractAdminClaims(buildEvent('admin'));
    expect(result).toEqual({ userId: 'admin-1', email: 'admin@spotzy.be' });
  });

  it('returns claims when cognito:groups contains admin among other groups', () => {
    const result = extractAdminClaims(buildEvent('users,admin'));
    expect(result).toEqual({ userId: 'admin-1', email: 'admin@spotzy.be' });
  });

  it('returns null when cognito:groups does not contain admin', () => {
    const result = extractAdminClaims(buildEvent('users'));
    expect(result).toBeNull();
  });

  it('returns null when cognito:groups is missing', () => {
    const result = extractAdminClaims(buildEvent(undefined));
    expect(result).toBeNull();
  });

  it('returns null when no authorizer claims exist', () => {
    const event = { requestContext: {} } as unknown as APIGatewayProxyEvent;
    const result = extractAdminClaims(event);
    expect(result).toBeNull();
  });

  it('returns null when sub is missing', () => {
    const event = {
      requestContext: {
        authorizer: { claims: { email: 'a@b.com', 'cognito:groups': 'admin' } },
      },
    } as unknown as APIGatewayProxyEvent;
    const result = extractAdminClaims(event);
    expect(result).toBeNull();
  });
});
