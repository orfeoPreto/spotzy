import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const ACTIVE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'ACTIVE']);

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('messages-unread', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  // 1. Get all bookings for this user (spotter + host)
  const [spotterResult, hostListingsResult] = await Promise.all([
    ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `SPOTTER#${claims.userId}` },
    })),
    ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `HOST#${claims.userId}` },
    })),
  ]);

  // Collect active booking IDs
  const activeBookingIds = new Set<string>();
  for (const b of spotterResult.Items ?? []) {
    if (ACTIVE_STATUSES.has(b.status as string)) activeBookingIds.add(b.bookingId as string);
  }

  // Host bookings via listing→booking relations
  const listingIds = (hostListingsResult.Items ?? []).map((l) => l.listingId as string).filter(Boolean);
  if (listingIds.length > 0) {
    const relResults = await Promise.all(listingIds.map((listingId) =>
      ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'BOOKING#' },
      }))
    ));

    const hostBookingIdsList = relResults.flatMap((r) =>
      (r.Items ?? []).map((item) => (item.SK as string).replace('BOOKING#', ''))
    );

    // Fetch booking metadata to check status
    if (hostBookingIdsList.length > 0) {
      const chunks: string[][] = [];
      for (let i = 0; i < hostBookingIdsList.length; i += 100) {
        chunks.push(hostBookingIdsList.slice(i, i + 100));
      }
      const batchResults = await Promise.all(chunks.map((chunk) =>
        ddb.send(new BatchGetCommand({
          RequestItems: {
            [TABLE]: { Keys: chunk.map((id) => ({ PK: `BOOKING#${id}`, SK: 'METADATA' })) },
          },
        }))
      ));
      for (const r of batchResults) {
        for (const b of (r.Responses?.[TABLE] ?? []) as Record<string, unknown>[]) {
          if (ACTIVE_STATUSES.has(b.status as string)) {
            activeBookingIds.add(b.bookingId as string);
          }
        }
      }
    }
  }

  // 2. Query all UNREAD# records for this user
  const unreadResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `USER#${claims.userId}`, ':prefix': 'UNREAD#' },
  }));

  // 3. Sum only unread from active bookings
  let unreadCount = 0;
  for (const item of unreadResult.Items ?? []) {
    const bookingId = (item.SK as string).replace('UNREAD#', '');
    if (activeBookingIds.has(bookingId)) {
      unreadCount += (item.unreadCount as number) ?? 0;
    }
  }

  log.info('unread count', { unreadCount });
  return ok({ unreadCount });
};
