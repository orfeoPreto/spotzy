import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { forbidden } from '../../../shared/utils/admin-response';
import { ok } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const admin = extractAdminClaims(event);
  const log = createLogger('admin-disputes-list', event.requestContext.requestId, admin?.userId);
  if (!admin) return forbidden();

  const qs = event.queryStringParameters ?? {};
  const statusFilter = qs.status; // 'resolved' for archived, undefined for default view

  // Scan for disputes matching the requested status
  const statuses = statusFilter === 'resolved' ? ['RESOLVED'] : ['ESCALATED', 'RESOLVED'];
  const scanResult = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'SK = :sk AND begins_with(PK, :dp) AND #status IN (' + statuses.map((_, i) => `:s${i}`).join(',') + ')',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':sk': 'METADATA',
      ':dp': 'DISPUTE#',
      ...Object.fromEntries(statuses.map((s, i) => [`:s${i}`, s])),
    },
  }));

  let disputes = (scanResult.Items ?? [])
    .sort((a, b) => {
      const aTime = (a.escalatedAt ?? a.resolvedAt ?? a.createdAt) as string;
      const bTime = (b.escalatedAt ?? b.resolvedAt ?? b.createdAt) as string;
      return new Date(bTime).getTime() - new Date(aTime).getTime(); // newest first
    });

  // For default view: return all escalated + last 10 resolved
  if (!statusFilter) {
    const escalated = disputes.filter((d) => d.status === 'ESCALATED');
    const resolved = disputes.filter((d) => d.status === 'RESOLVED').slice(0, 10);
    disputes = [...escalated, ...resolved];
  }

  if (disputes.length === 0) return ok({ disputes: [], hasMoreResolved: false });

  // Collect unique booking IDs and user IDs for batch get
  const bookingIds = [...new Set(disputes.map((d) => d.bookingId as string))];
  const userIds = [...new Set(disputes.flatMap((d) => [d.hostId as string, d.spotterId as string]))];

  const batchKeys = [
    ...bookingIds.map((id) => ({ PK: `BOOKING#${id}`, SK: 'METADATA' })),
    ...userIds.map((id) => ({ PK: `USER#${id}`, SK: 'PROFILE' })),
  ];

  const batchResult = await ddb.send(new BatchGetCommand({
    RequestItems: { [TABLE]: { Keys: batchKeys } },
  }));

  const items = batchResult.Responses?.[TABLE] ?? [];
  const bookingMap = new Map<string, Record<string, unknown>>();
  const userMap = new Map<string, Record<string, unknown>>();

  for (const item of items) {
    const pk = item.PK as string;
    if (pk.startsWith('BOOKING#')) {
      bookingMap.set(pk.replace('BOOKING#', ''), item);
    } else if (pk.startsWith('USER#')) {
      userMap.set(pk.replace('USER#', ''), item);
    }
  }

  // Check unread messages for each dispute
  const enriched = await Promise.all(disputes.map(async (d) => {
    const booking = bookingMap.get(d.bookingId as string) ?? {};
    const host = userMap.get(d.hostId as string) ?? {};
    const guest = userMap.get(d.spotterId as string) ?? {};

    // Check for messages after lastAdminVisit
    let unreadForAdmin = false;
    const lastVisit = d.lastAdminVisit as string | null;
    const msgResult = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND SK > :sk',
      ExpressionAttributeValues: {
        ':pk': `DISPUTE#${d.disputeId}`,
        ':sk': `MSG#${lastVisit ?? '1970-01-01T00:00:00.000Z'}`,
      },
      Limit: 1,
    }));
    if (msgResult.Items && msgResult.Items.length > 0) {
      unreadForAdmin = true;
    }

    return {
      disputeId: d.disputeId,
      bookingId: d.bookingId,
      status: d.status,
      escalatedAt: d.escalatedAt ?? null,
      resolvedAt: d.resolvedAt ?? null,
      outcome: d.outcome ?? null,
      escalationSummary: d.escalationSummary ?? null,
      unreadForAdmin,
      bookingRef: booking.referenceNumber ?? booking.bookingId ?? d.bookingId,
      listingAddress: booking.listingAddress ?? null,
      hostDisplayName: host.displayName ?? host.pseudo ?? null,
      guestDisplayName: guest.displayName ?? guest.pseudo ?? null,
    };
  }));

  // Check if there are more resolved disputes beyond the 10 shown
  const totalResolved = (scanResult.Items ?? []).filter((d) => d.status === 'RESOLVED').length;
  const hasMoreResolved = !statusFilter && totalResolved > 10;

  log.info('disputes listed', { count: enriched.length, hasMoreResolved });
  return ok({ disputes: enriched, hasMoreResolved });
};
