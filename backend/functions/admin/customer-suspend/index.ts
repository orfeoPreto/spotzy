import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminDisableUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { forbidden } from '../../../shared/utils/admin-response';
import { ok, badRequest, notFound } from '../../../shared/utils/response';
import { userProfileKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';

export const handler: APIGatewayProxyHandler = async (event) => {
  const admin = extractAdminClaims(event);
  const log = createLogger('admin-customer-suspend', event.requestContext.requestId, admin?.userId);
  if (!admin) return forbidden();

  const userId = event.pathParameters?.userId;
  if (!userId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'userId' });

  const body = JSON.parse(event.body ?? '{}');
  const { reason } = body;
  if (!reason) return badRequest('REASON_REQUIRED');

  // Fetch user profile to verify existence
  const userResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(userId) }));
  if (!userResult.Item) return notFound();

  const now = new Date().toISOString();

  // Set user status to SUSPENDED
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: userProfileKey(userId),
    UpdateExpression: 'SET #status = :status, suspendedAt = :now, suspendedBy = :admin, suspendReason = :reason, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': 'SUSPENDED',
      ':now': now,
      ':admin': admin.userId,
      ':reason': reason,
    },
  }));

  // Disable user in Cognito
  await cognito.send(new AdminDisableUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: userId,
  }));

  log.info('customer suspended', { userId, reason });
  return ok({ userId, status: 'SUSPENDED', suspendedAt: now });
};
