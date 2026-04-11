import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('block-request-list', event.requestContext.requestId, claims?.userId);

  if (!claims) {
    log.warn('unauthorized');
    return unauthorized();
  }

  const qs = event.queryStringParameters ?? {};
  const limit = Math.min(parseInt(qs.limit ?? '20', 10), 100);
  const statusFilter = qs.status ?? null;

  let exclusiveStartKey: Record<string, any> | undefined;
  if (qs.cursor) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(qs.cursor, 'base64').toString('utf-8'));
    } catch {
      // Invalid cursor — start from the beginning
    }
  }

  const queryParams: any = {
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `USER#${claims.userId}`,
      ':prefix': 'BLOCKREQ#',
    } as Record<string, any>,
    ScanIndexForward: false,
    Limit: limit,
  };

  if (exclusiveStartKey) {
    queryParams.ExclusiveStartKey = exclusiveStartKey;
  }

  if (statusFilter) {
    queryParams.FilterExpression = '#status = :statusFilter';
    queryParams.ExpressionAttributeNames = { '#status': 'status' };
    queryParams.ExpressionAttributeValues[':statusFilter'] = statusFilter;
  }

  const result = await ddb.send(new QueryCommand(queryParams));

  const items = result.Items ?? [];
  let cursor: string | null = null;
  if (result.LastEvaluatedKey) {
    cursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }

  log.info('block requests listed', { count: items.length, hasMore: !!cursor });
  return ok({ items, cursor });
};
