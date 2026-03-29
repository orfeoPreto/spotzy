import { APIGatewayProxyHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ResendConfirmationCodeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { badRequest, ok, internalError } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const cognito = new CognitoIdentityProviderClient({});
const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '';

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('auth-resend-otp', event.requestContext.requestId);

  const body = JSON.parse(event.body ?? '{}') as { email?: string };
  if (!body.email) {
    log.warn('validation failed', { reason: 'missing email' });
    return badRequest('Missing email');
  }

  log.info('resend-otp attempt', { email: body.email });

  try {
    await cognito.send(new ResendConfirmationCodeCommand({
      ClientId: CLIENT_ID,
      Username: body.email,
    }));
    log.info('resend-otp success', { email: body.email });
    return ok({ message: 'Code resent' });
  } catch (err) {
    log.error('resend-otp error', err);
    return internalError();
  }
};
