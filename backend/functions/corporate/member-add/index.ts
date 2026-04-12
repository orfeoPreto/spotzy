import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ok, badRequest, notFound, forbidden } from '../../../shared/utils/response';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  const corpId = event.pathParameters?.corpId;
  if (!corpId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'corpId' });

  const { userId: memberUserId, role, spendingLimitPerBooking, spendingLimitMonthly } = JSON.parse(event.body ?? '{}');
  if (!memberUserId || !role) return badRequest('MISSING_REQUIRED_FIELD', { field: 'userId, role' });
  if (!['ADMIN', 'BOOKER', 'VIEWER'].includes(role)) return badRequest('INVALID_FIELD', { field: 'role' });

  // Verify corp exists and caller is admin
  const corp = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `CORP#${corpId}`, SK: 'METADATA' } }));
  if (!corp.Item) return notFound();
  if (corp.Item.adminUserId !== userId) {
    return forbidden();
  }

  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `CORP#${corpId}`, SK: `MEMBER#${memberUserId}`,
      userId: memberUserId, role,
      spendingLimitPerBooking: spendingLimitPerBooking ?? null,
      spendingLimitMonthly: spendingLimitMonthly ?? null,
      addedAt: now, addedBy: userId,
    },
  }));

  return ok({ corpId, userId: memberUserId, role, addedAt: now });
};
