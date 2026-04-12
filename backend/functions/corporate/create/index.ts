import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { created, badRequest, conflict } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const BELGIAN_VAT_REGEX = /^BE\d{10}$/;

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('corp-create', event.requestContext.requestId);
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { companyName, vatNumber, billingAddress } = JSON.parse(event.body ?? '{}');
  if (!companyName?.trim() || !vatNumber?.trim() || !billingAddress?.trim()) {
    return badRequest('MISSING_REQUIRED_FIELD', { field: 'companyName, vatNumber, billingAddress' });
  }

  if (!BELGIAN_VAT_REGEX.test(vatNumber)) {
    return badRequest('INVALID_VAT_NUMBER');
  }

  // Check if user already has a corporate account
  const existing = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `CORP_ADMIN#${userId}` },
    Limit: 1,
  }));
  if (existing.Items?.length) return conflict('ALREADY_CORPORATE_ADMIN');

  const corpId = ulid();
  const now = new Date().toISOString();

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `CORP#${corpId}`, SK: 'METADATA',
      GSI1PK: `CORP_ADMIN#${userId}`, GSI1SK: `CORP#${corpId}`,
      corpId, name: companyName.trim(), vatNumber: vatNumber.trim(),
      billingAddress: billingAddress.trim(), adminUserId: userId,
      status: 'ACTIVE', createdAt: now, updatedAt: now,
    },
  }));

  // Add admin as member
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `CORP#${corpId}`, SK: `MEMBER#${userId}`,
      userId, role: 'ADMIN', addedAt: now, addedBy: userId,
    },
  }));

  log.info('corporate account created', { corpId, userId });
  return created({ corpId, name: companyName.trim(), adminUserId: userId, status: 'ACTIVE', createdAt: now });
};
