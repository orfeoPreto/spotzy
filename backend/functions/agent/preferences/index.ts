import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ok, badRequest } from '../../../shared/utils/response';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.requestContext.authorizer?.userId
    ?? event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  if (event.httpMethod === 'GET') {
    const result = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: 'PREFERENCES' },
    }));
    const prefs = result.Item;
    return ok({
      covered: prefs?.covered ?? null,
      evCharging: prefs?.evCharging ?? null,
      accessible: prefs?.accessible ?? null,
      maxPricePerDayEur: prefs?.maxPricePerDayEur ?? null,
      maxWalkingMinutes: prefs?.maxWalkingMinutes ?? null,
    });
  }

  if (event.httpMethod === 'PUT') {
    const body = JSON.parse(event.body ?? '{}');
    const now = new Date().toISOString();

    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `USER#${userId}`,
        SK: 'PREFERENCES',
        covered: body.covered ?? null,
        evCharging: body.evCharging ?? null,
        accessible: body.accessible ?? null,
        maxPricePerDayEur: body.maxPricePerDayEur ?? null,
        maxWalkingMinutes: body.maxWalkingMinutes ?? null,
        updatedAt: now,
      },
    }));

    return ok({
      covered: body.covered ?? null,
      evCharging: body.evCharging ?? null,
      accessible: body.accessible ?? null,
      maxPricePerDayEur: body.maxPricePerDayEur ?? null,
      maxWalkingMinutes: body.maxWalkingMinutes ?? null,
    });
  }

  return badRequest('UNSUPPORTED_METHOD');
};
