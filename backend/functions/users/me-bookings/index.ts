import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('user-me-bookings', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  // Spotter bookings via GSI1
  const spotterResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `SPOTTER#${claims.userId}` },
  }));
  const spotterBookings = spotterResult.Items ?? [];

  // Host bookings: get listing IDs, then query listing-booking relationship records
  const listingsResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `HOST#${claims.userId}` },
  }));
  const listingIds = (listingsResult.Items ?? []).map((l) => l.listingId as string).filter(Boolean);

  const hostBookingIds = new Set<string>();
  if (listingIds.length > 0) {
    await Promise.all(listingIds.map(async (listingId) => {
      const r = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'BOOKING#' },
      }));
      for (const item of r.Items ?? []) {
        const bookingId = (item.SK as string).replace('BOOKING#', '');
        hostBookingIds.add(bookingId);
      }
    }));
  }

  // Batch-get full booking metadata for host bookings not already in spotter results
  const spotterBookingIds = new Set(spotterBookings.map((b) => b.bookingId as string));
  const idsToFetch = [...hostBookingIds].filter((id) => !spotterBookingIds.has(id));

  let hostBookings: Record<string, unknown>[] = [];
  if (idsToFetch.length > 0) {
    // BatchGet supports max 100 items; chunk if needed
    const chunks: string[][] = [];
    for (let i = 0; i < idsToFetch.length; i += 100) chunks.push(idsToFetch.slice(i, i + 100));
    const results = await Promise.all(chunks.map((chunk) =>
      ddb.send(new BatchGetCommand({
        RequestItems: {
          [TABLE]: { Keys: chunk.map((id) => ({ PK: `BOOKING#${id}`, SK: 'METADATA' })) },
        },
      }))
    ));
    hostBookings = results.flatMap((r) => (r.Responses?.[TABLE] ?? []) as Record<string, unknown>[]);
  }

  const bookings = [...spotterBookings, ...hostBookings];
  log.info('bookings fetched', { spotterCount: spotterBookings.length, hostCount: hostBookings.length });
  return ok({ bookings });
};
