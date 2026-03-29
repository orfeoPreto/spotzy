import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const ACTIVE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'ACTIVE']);
const ARCHIVED_STATUSES = new Set(['COMPLETED', 'CANCELLED']);

function formatName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('messages-list', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const archived = event.queryStringParameters?.archived === 'true';
  const allowedStatuses = archived ? ARCHIVED_STATUSES : ACTIVE_STATUSES;

  // 1. Fetch all bookings for this user (both as spotter and host)
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

  const spotterBookings = (spotterResult.Items ?? []).filter(
    (b) => allowedStatuses.has(b.status as string)
  );

  // Get host bookings via listing→booking relationship
  const listingIds = (hostListingsResult.Items ?? []).map((l) => l.listingId as string).filter(Boolean);
  const hostBookingIds = new Set<string>();

  if (listingIds.length > 0) {
    await Promise.all(listingIds.map(async (listingId) => {
      const r = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'BOOKING#' },
      }));
      for (const item of r.Items ?? []) {
        hostBookingIds.add((item.SK as string).replace('BOOKING#', ''));
      }
    }));
  }

  // Batch-get host booking metadata (exclude duplicates with spotter bookings)
  const spotterBookingIds = new Set(spotterBookings.map((b) => b.bookingId as string));
  const idsToFetch = [...hostBookingIds].filter((id) => !spotterBookingIds.has(id));

  let hostBookings: Record<string, unknown>[] = [];
  if (idsToFetch.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < idsToFetch.length; i += 100) chunks.push(idsToFetch.slice(i, i + 100));
    const results = await Promise.all(chunks.map((chunk) =>
      ddb.send(new BatchGetCommand({
        RequestItems: {
          [TABLE]: { Keys: chunk.map((id) => ({ PK: `BOOKING#${id}`, SK: 'METADATA' })) },
        },
      }))
    ));
    hostBookings = results
      .flatMap((r) => (r.Responses?.[TABLE] ?? []) as Record<string, unknown>[])
      .filter((b) => allowedStatuses.has(b.status as string));
  }

  const allBookings = [...spotterBookings, ...hostBookings];

  // 2. For each booking, fetch enrichment data in parallel
  const conversations = await Promise.all(
    allBookings.map(async (booking) => {
      const bookingId = booking.bookingId as string;
      const isSpotter = booking.spotterId === claims.userId;
      const otherPartyId = isSpotter ? booking.hostId as string : booking.spotterId as string;

      const [lastMsgResult, otherPartyResult, listingResult, unreadResult] = await Promise.all([
        // Last message
        ddb.send(new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': `CHAT#${bookingId}`, ':prefix': 'MSG#' },
          ScanIndexForward: false,
          Limit: 1,
        })),
        // Other party profile
        ddb.send(new GetCommand({
          TableName: TABLE,
          Key: { PK: `USER#${otherPartyId}`, SK: 'PROFILE' },
        })),
        // Listing address
        ddb.send(new GetCommand({
          TableName: TABLE,
          Key: { PK: `LISTING#${booking.listingId}`, SK: 'METADATA' },
        })),
        // Unread count
        ddb.send(new GetCommand({
          TableName: TABLE,
          Key: { PK: `USER#${claims.userId}`, SK: `UNREAD#${bookingId}` },
        })),
      ]);

      const lastMsg = lastMsgResult.Items?.[0];
      const otherParty = otherPartyResult.Item;
      const listing = listingResult.Item;

      return {
        bookingId,
        bookingStatus: booking.status as string,
        listingId: booking.listingId as string,
        listingAddress: (listing?.address as string) ?? '',
        otherPartyId,
        otherPartyName: otherParty ? formatName(otherParty.name as string) : 'Unknown',
        otherPartyPhotoUrl: (otherParty?.photoUrl as string) ?? null,
        lastMessagePreview: lastMsg?.content ? (lastMsg.content as string).slice(0, 80) : '',
        lastMessageAt: (lastMsg?.createdAt as string) ?? null,
        unreadCount: (unreadResult.Item?.unreadCount as number) ?? 0,
      };
    })
  );

  // 3. Sort by lastMessageAt descending
  conversations.sort((a, b) =>
    new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime()
  );

  log.info('conversations listed', { count: conversations.length, archived });
  return ok({ conversations });
};
