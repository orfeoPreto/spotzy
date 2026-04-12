import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { forbidden } from '../../../shared/utils/admin-response';
import { ok, badRequest, notFound, unauthorized } from '../../../shared/utils/response';
import { disputeMetadataKey, bookingMetadataKey, userProfileKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractAdminClaims(event);
  const log = createLogger('admin-dispute-get', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('forbidden'); return forbidden(); }

  const disputeId = event.pathParameters?.id;
  if (!disputeId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'disputeId' });

  // Fetch dispute
  const disputeResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: disputeMetadataKey(disputeId) }));
  if (!disputeResult.Item) return notFound();
  const dispute = disputeResult.Item;

  // Fetch booking for context
  const bookingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(dispute.bookingId as string) }));
  const booking = bookingResult.Item ?? {};

  // Fetch host + guest display names
  const [hostResult, guestResult] = await Promise.all([
    ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(dispute.hostId as string) })),
    ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(dispute.spotterId as string) })),
  ]);
  const host = hostResult.Item ?? {};
  const guest = guestResult.Item ?? {};

  // Fetch messages
  const messagesResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `DISPUTE#${disputeId}`, ':sk': 'MSG#' },
    ScanIndexForward: true,
  }));

  const messages = (messagesResult.Items ?? []).map((m) => ({
    messageId: m.messageId ?? m.SK,
    senderId: m.authorId,
    senderRole: m.authorId === 'SYSTEM' ? 'bot' : m.authorRole === 'ADMIN' ? 'admin' : m.authorId === dispute.hostId ? 'host' : m.authorId === dispute.spotterId ? 'guest' : 'admin',
    text: m.content,
    createdAt: m.createdAt,
  }));

  log.info('admin dispute fetched', { disputeId });

  return ok({
    disputeId,
    bookingRef: dispute.referenceNumber ?? booking.reference ?? disputeId.slice(0, 8),
    hostDisplayName: (host.pseudo as string)?.trim() || (host.firstName as string) || 'Host',
    guestDisplayName: (guest.pseudo as string)?.trim() || (guest.firstName as string) || 'Guest',
    listingAddress: booking.listingAddress ?? 'Unknown',
    escalationSummary: dispute.escalationSummary ?? null,
    escalationReason: dispute.escalationReason ?? null,
    status: dispute.status,
    outcome: dispute.outcome ?? null,
    resolvedAt: dispute.resolvedAt ?? null,
    adminNote: dispute.adminNote ?? null,
    messages,
  });
};
