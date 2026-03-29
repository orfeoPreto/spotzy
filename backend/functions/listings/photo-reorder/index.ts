import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound } from '../../../shared/utils/response';
import { listingMetadataKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const forbidden = () => ({
  statusCode: 403,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ error: 'Forbidden' }),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('listing-photo-reorder', event.requestContext.requestId, claims?.userId);
  if (!claims) return unauthorized();

  const listingId = event.pathParameters?.id;
  if (!listingId) return badRequest('Missing listing id');

  const body = JSON.parse(event.body ?? '{}') as { order?: number[] };
  if (!Array.isArray(body.order)) return badRequest('order array is required');

  // Fetch listing
  const meta = await ddb.send(new GetCommand({ TableName: TABLE, Key: listingMetadataKey(listingId) }));
  if (!meta.Item) return notFound();
  if (meta.Item.hostId !== claims.userId) return forbidden();

  const photos: string[] = meta.Item.photos ?? [];
  const order = body.order;

  // Validate order contains exactly the same indices as current photos
  if (order.length !== photos.length) {
    return badRequest(JSON.stringify({ code: 'ORDER_MISMATCH', message: 'Order array length must match photos count' }));
  }
  const sortedOrder = [...order].sort((a, b) => a - b);
  const expectedIndices = photos.map((_, i) => i);
  const isValid = sortedOrder.every((v, i) => v === expectedIndices[i]);
  if (!isValid) {
    return badRequest(JSON.stringify({ code: 'ORDER_MISMATCH', message: 'Order array must contain all current photo indices exactly once' }));
  }

  // Reorder photos array: index 0 of result = photos[order[0]], etc.
  const reordered = order.map((idx) => photos[idx]);

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: listingMetadataKey(listingId),
    UpdateExpression: 'SET photos = :p, updatedAt = :now',
    ExpressionAttributeValues: { ':p': reordered, ':now': new Date().toISOString() },
  }));

  log.info('photos reordered', { listingId, order });
  return ok({ reordered: true, photos: reordered });
};
