import { APIGatewayProxyHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  CodeMismatchException,
  ExpiredCodeException,
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

const codeError = (message: string): APIGatewayProxyResult => ({
  statusCode: 400,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ message }),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('auth-verify-otp', event.requestContext.requestId);

  const body = JSON.parse(event.body ?? '{}') as {
    email?: string;
    code?: string;
    password?: string;
  };
  const { email, code, password } = body;
  if (!email || !code || !password) {
    log.warn('validation failed', { reason: 'missing required fields' });
    return badRequest('MISSING_REQUIRED_FIELDS');
  }

  log.info('verify-otp attempt', { email });

  try {
    await cognito.send(new ConfirmSignUpCommand({
      ClientId: CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
    }));

    const authRes = await cognito.send(new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }));

    const idToken = authRes.AuthenticationResult?.IdToken;
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

    log.info('verify-otp success', { userId, role });
    return ok({ token: idToken, userId, role });
  } catch (err) {
    if (err instanceof CodeMismatchException) {
      log.warn('invalid otp code', { email });
      return codeError('Invalid verification code');
    }
    if (err instanceof ExpiredCodeException) {
      log.warn('expired otp code', { email });
      return codeError('Code has expired — please request a new one');
    }
    log.error('verify-otp error', err);
    return internalError();
  }
};
