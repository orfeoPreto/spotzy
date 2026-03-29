import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
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

const conflict = (code: string, message: string) => ({
  statusCode: 409,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ error: message, code }),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('listing-delete', event.requestContext.requestId, claims?.userId);
  if (!claims) return unauthorized();

  const listingId = event.pathParameters?.id;
  if (!listingId) return badRequest('Missing listing id');

  // Verify listing exists and caller is owner
  const meta = await ddb.send(new GetCommand({ TableName: TABLE, Key: listingMetadataKey(listingId) }));
  if (!meta.Item) return notFound();
  if (meta.Item.hostId !== claims.userId) return forbidden();

  // Query for any bookings linked to this listing
  const bookingQuery = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `LISTING#${listingId}`,
      ':prefix': 'BOOKING#',
    },
  }));
  const bookings = bookingQuery.Items ?? [];

  // Check for active bookings (CONFIRMED or ACTIVE) — cannot delete or archive
  const activeBooking = bookings.find((b) =>
    b.status === 'CONFIRMED' || b.status === 'ACTIVE',
  );
  if (activeBooking) {
    log.warn('cannot delete — active booking exists', { listingId, bookingId: activeBooking.bookingId });
    return conflict('ACTIVE_BOOKING_EXISTS', 'Cannot delete a listing with active or confirmed bookings');
  }

  // If any booking history exists (e.g. CANCELLED) → archive instead of hard delete
  if (bookings.length > 0) {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: listingMetadataKey(listingId),
      UpdateExpression: 'SET #status = :s, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':s': 'ARCHIVED', ':now': new Date().toISOString() },
    }));
    log.info('listing archived', { listingId, reason: 'BOOKING_HISTORY_EXISTS' });
    return ok({ archived: true, reason: 'BOOKING_HISTORY_EXISTS' });
  }

  // No booking history — hard delete
  // 1. Delete all AVAIL_RULE# records
  const rulesQuery = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `LISTING#${listingId}`,
      ':prefix': 'AVAIL_RULE#',
    },
  }));
  const rules = rulesQuery.Items ?? [];

  if (rules.length > 0) {
    for (let i = 0; i < rules.length; i += 25) {
      const chunk = rules.slice(i, i + 25);
      await ddb.send(new BatchWriteCommand({
        RequestItems: {
          [TABLE]: chunk.map((r) => ({
            DeleteRequest: { Key: { PK: r.PK, SK: r.SK } },
          })),
        },
      }));
    }
  }

  // 2. Delete the listing METADATA record itself
  await ddb.send(new DeleteCommand({
    TableName: TABLE,
    Key: listingMetadataKey(listingId),
  }));

  log.info('listing hard deleted', { listingId });
  return ok({ deleted: true });
};
