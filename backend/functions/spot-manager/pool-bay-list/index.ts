import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('pool-bay-list', event.requestContext.requestId, claims?.userId);

  if (!claims) {
    log.warn('unauthorized');
    return unauthorized();
  }

  const poolId = event.pathParameters?.poolId;
  if (!poolId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'poolId' });

  // Fetch listing to check ownership
  const listingResult = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `LISTING#${poolId}`, SK: 'METADATA' },
  }));
  const listing = listingResult.Item;
  if (!listing) return notFound();
  if (!listing.isPool) return badRequest('NOT_A_POOL_LISTING');

  const isOwner = listing.hostId === claims.userId;
  const statusFilter = event.queryStringParameters?.status;

  // Query all BAY# children
  const baysResult = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `LISTING#${poolId}`, ':prefix': 'BAY#' },
  }));

  let bays = baysResult.Items ?? [];

  if (isOwner) {
    // Owner can filter by status
    if (statusFilter) {
      bays = bays.filter((b) => b.status === statusFilter);
    }
  } else {
    // Public: only ACTIVE bays, strip accessInstructions
    bays = bays
      .filter((b) => b.status === 'ACTIVE')
      .map(({ accessInstructions, ...rest }) => rest);
  }

  log.info('bays listed', { poolId, count: bays.length, isOwner });

  return ok({ bays });
};
