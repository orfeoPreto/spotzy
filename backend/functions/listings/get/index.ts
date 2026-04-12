import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ok, notFound, badRequest } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { listingMetadataKey, userProfileKey } from '../../../shared/db/keys';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('listing-get', event.requestContext.requestId);

  const listingId = event.pathParameters?.id;
  if (!listingId) { log.warn('validation failed', { reason: 'missing listingId' }); return badRequest('MISSING_REQUIRED_FIELD', { field: 'listingId' }); }

  const key = listingMetadataKey(listingId);
  const result = await client.send(new GetCommand({ TableName: TABLE, Key: key, ConsistentRead: true }));
  if (!result.Item) { log.warn('not found', { listingId }); return notFound(); }

  const listing = result.Item;

  // Draft listings are only visible to the host.
  // This route is public (no API Gateway authorizer), so we decode the JWT
  // from the Authorization header directly to identify the caller.
  if (listing.status === 'draft') {
    let callerId: string | null = null;
    try {
      const authHeader = event.headers?.Authorization ?? event.headers?.authorization ?? '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (token) {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
        callerId = payload.sub ?? null;
      }
    } catch { /* invalid token — treat as unauthenticated */ }
    if (!callerId || callerId !== listing.hostId) {
      log.warn('draft access denied', { listingId });
      return notFound();
    }
  }

  // Enrich with host profile
  if (listing.hostId) {
    try {
      const hostResult = await client.send(new GetCommand({
        TableName: TABLE,
        Key: userProfileKey(listing.hostId),
        ProjectionExpression: 'userId, #n, photoUrl, avgRating',
        ExpressionAttributeNames: { '#n': 'name' },
      }));
      if (hostResult.Item) {
        listing.host = {
          userId: hostResult.Item.userId,
          name: hostResult.Item.name,
          photoUrl: hostResult.Item.photoUrl ?? null,
          avgRating: hostResult.Item.avgRating ?? null,
        };
      }
    } catch { /* non-blocking */ }
  }

  log.info('listing fetched', { listingId, status: listing.status });
  return ok(listing);
};
