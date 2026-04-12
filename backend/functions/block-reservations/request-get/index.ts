import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, forbidden } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('block-request-get', event.requestContext.requestId, claims?.userId);

  if (!claims) {
    log.warn('unauthorized');
    return unauthorized();
  }

  const reqId = event.pathParameters?.reqId;
  if (!reqId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'reqId' });

  // Single query: PK = BLOCKREQ#{reqId} returns METADATA + BLOCKALLOC# + BOOKING#
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `BLOCKREQ#${reqId}` },
  }));

  const items = result.Items ?? [];
  const metadata = items.find((i) => i.SK === 'METADATA');
  if (!metadata) return notFound();

  // Auth check
  const isOwner = metadata.ownerUserId === claims.userId;
  const isAdmin = event.requestContext.authorizer?.claims?.['cognito:groups']?.includes('admin');

  // Check if caller is a Spot Manager for any allocation
  const allocations = items.filter((i) => (i.SK as string).startsWith('BLOCKALLOC#'));
  const isSpotManager = allocations.some((a) => a.spotManagerUserId === claims.userId);

  if (!isOwner && !isAdmin && !isSpotManager) {
    return forbidden();
  }

  const bookings = items.filter((i) => (i.SK as string).startsWith('BOOKING#'));

  // Redact PII for Spot Manager
  const processedBookings = bookings.map((b) => {
    if (isSpotManager && !isOwner && !isAdmin) {
      return {
        ...b,
        guestEmail: '[redacted]',
        guestPhone: '[redacted]',
        guestName: b.guestName ? (b.guestName as string).split(' ')[0] : null,
      };
    }
    return b;
  });

  log.info('block request fetched', { reqId, isOwner, isSpotManager, isAdmin });
  return ok({
    ...metadata,
    allocations,
    bookings: processedBookings,
  });
};
