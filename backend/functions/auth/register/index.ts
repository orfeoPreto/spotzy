import { APIGatewayProxyHandler } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { badRequest, conflict, internalError, ok } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const cognito = new CognitoIdentityProviderClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? '';
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('auth-register', event.requestContext.requestId);

  const body = JSON.parse(event.body ?? '{}') as {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    role?: string;
    phone?: string;
    pseudo?: string;
  };

  const { email, password, firstName, lastName, role, phone } = body;
  if (!email || !password || !firstName || !lastName || !role) {
    log.warn('validation failed', { reason: 'missing required fields' });
    return badRequest('Missing required fields');
  }

  log.info('register attempt', { email, role });

  try {
    const res = await cognito.send(new SignUpCommand({
      ClientId: CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'name', Value: `${firstName} ${lastName}` },
        { Name: 'phone_number', Value: phone || '+10000000000' },
      ],
    }));

    const userId = res.UserSub!;
    const now = new Date().toISOString();

    try {
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `USER#${userId}`,
          SK: 'PROFILE',
          GSI1PK: `EMAIL#${email}`,
          GSI1SK: `USER#${userId}`,
          userId,
          email,
          name: `${firstName} ${lastName}`,
          firstName,
          lastName,
          phone: phone || '',
          role,
          pseudo: body.pseudo?.trim() || body.firstName,
          showFullNamePublicly: false,
          profilePhotoUrl: null,
          stripeConnectEnabled: false,
          createdAt: now,
          updatedAt: now,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }));
    } catch (_e) {
      // ignore ConditionalCheckFailedException (profile already exists)
    }

    log.info('register success', { userId, role });
    return ok({ userId, message: 'Verification code sent to email' });
  } catch (err) {
    if (err instanceof UsernameExistsException) {
      log.warn('email already exists', { email });
      return conflict('An account with this email already exists');
    }
    log.error('register error', err);
    return internalError();
  }
};
