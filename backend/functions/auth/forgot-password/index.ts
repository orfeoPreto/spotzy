import { APIGatewayProxyHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { badRequest, ok, internalError } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const cognito = new CognitoIdentityProviderClient({});
const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '';

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('auth-forgot-password', event.requestContext.requestId);

  const body = JSON.parse(event.body ?? '{}') as { email?: string };
  if (!body.email) {
    log.warn('validation failed', { reason: 'missing email' });
    return badRequest('MISSING_REQUIRED_FIELD', { field: 'email' });
  }

  log.info('forgot-password attempt', { email: body.email });

  try {
    await cognito.send(new ForgotPasswordCommand({
      ClientId: CLIENT_ID,
      Username: body.email,
    }));
    log.info('forgot-password triggered', { email: body.email });
    // Always return ok to avoid leaking whether email exists
    return ok({ message: 'If an account exists, a reset code has been sent' });
  } catch (err) {
    log.error('forgot-password error', err);
    return internalError();
  }
};
