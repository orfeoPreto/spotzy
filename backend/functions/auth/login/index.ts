import { APIGatewayProxyHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  NotAuthorizedException,
  UserNotConfirmedException,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { badRequest, ok, internalError } from '../../../shared/utils/response';
import { APIGatewayProxyResult } from 'aws-lambda';
import { createLogger } from '../../../shared/utils/logger';

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '';
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
}

const errResponse = (status: number, message: string): APIGatewayProxyResult => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ message }),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('auth-login', event.requestContext.requestId);

  const body = JSON.parse(event.body ?? '{}') as { email?: string; password?: string };
  const { email, password } = body;
  if (!email || !password) {
    log.warn('validation failed', { reason: 'missing email or password' });
    return badRequest('MISSING_CREDENTIALS');
  }

  log.info('login attempt', { email });

  try {
    const res = await cognito.send(new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }));

    const idToken = res.AuthenticationResult?.IdToken;
    if (!idToken) return internalError();

    const claims = decodeJwtPayload(idToken);
    const userId = claims['sub'] as string;

    const profile = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `EMAIL#${email}` },
      Limit: 1,
    }));
    const role = (profile.Items?.[0]?.role as string) ?? 'SPOTTER';

    log.info('login success', { userId, role });
    return ok({ token: idToken, userId, email, role });
  } catch (err) {
    if (err instanceof NotAuthorizedException) {
      log.warn('invalid credentials', { email });
      return errResponse(401, 'Invalid credentials — please check your email or password');
    }
    if (err instanceof UserNotConfirmedException) {
      log.warn('email not verified', { email });
      return errResponse(403, 'Email not verified. Please check your inbox for the confirmation code.');
    }
    log.error('login error', err);
    return internalError();
  }
};
