import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, unauthorized, badRequest } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('user-invoicing', event.requestContext.requestId, claims?.userId);
  if (!claims) return unauthorized();

  if (event.httpMethod === 'GET') {
    const result = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `USER#${claims.userId}`, SK: 'INVOICING' },
    }));
    return ok(result.Item ?? {});
  }

  // PUT
  const body = JSON.parse(event.body ?? '{}');
  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `USER#${claims.userId}`,
      SK: 'INVOICING',
      vatNumber: body.vatNumber ?? null,
      companyName: body.companyName ?? null,
      billingStreet: body.billingStreet ?? null,
      billingCity: body.billingCity ?? null,
      billingPostcode: body.billingPostcode ?? null,
      billingCountry: body.billingCountry ?? null,
      updatedAt: now,
    },
  }));

  log.info('invoicing updated');
  return ok({ success: true });
};
