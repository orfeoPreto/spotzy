import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, forbidden } from '../../../shared/utils/response';
import { bookingMetadataKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('dispute-get', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const bookingId = event.queryStringParameters?.bookingId;

  // If no bookingId, return all disputes for this user
  if (!bookingId) {
    const scanResult = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'SK = :sk AND begins_with(PK, :dp) AND (initiatorId = :uid OR hostId = :uid OR spotterId = :uid)',
      ExpressionAttributeValues: { ':sk': 'METADATA', ':dp': 'DISPUTE#', ':uid': claims.userId },
    }));

    const disputes = (scanResult.Items ?? [])
      .sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

    // Enrich with booking address
    const enriched = await Promise.all(disputes.map(async (d) => {
      let listingAddress: string | null = null;
      try {
        const bResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(d.bookingId as string) }));
        listingAddress = (bResult.Item?.listingAddress as string) ?? null;
      } catch { /* ignore */ }
      return {
        disputeId: d.disputeId,
        bookingId: d.bookingId,
        status: d.status,
        reason: d.reason,
        referenceNumber: d.referenceNumber,
        listingAddress,
        createdAt: d.createdAt,
      };
    }));

    log.info('user disputes listed', { count: enriched.length });
    return ok({ disputes: enriched });
  }

  // Query disputes by booking using GSI1
  const disputeResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `BOOKING#${bookingId}`,
      ':sk': 'DISPUTE#',
    },
    ScanIndexForward: false,
    Limit: 1,
  }));

  if (!disputeResult.Items || disputeResult.Items.length === 0) {
    return notFound();
  }

  const dispute = disputeResult.Items[0];

  // Verify the caller is a party to the dispute
  if (claims.userId !== dispute.spotterId && claims.userId !== dispute.hostId && claims.userId !== dispute.initiatorId) {
    return forbidden();
  }

  // Fetch messages for this dispute
  const messagesResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `DISPUTE#${dispute.disputeId}`,
      ':sk': 'MSG#',
    },
    ScanIndexForward: true,
  }));

  const messages = (messagesResult.Items ?? []).map((m) => ({
    messageId: m.messageId,
    role: m.authorId === 'SYSTEM' ? 'AI' : 'USER',
    text: m.content,
    contentType: m.contentType ?? 'TEXT',
    requestsEvidence: m.requestsEvidence ?? false,
    createdAt: m.createdAt,
  }));

  log.info('dispute fetched', { disputeId: dispute.disputeId, bookingId, messageCount: messages.length });

  return ok({
    disputeId: dispute.disputeId,
    bookingId: dispute.bookingId,
    status: dispute.status,
    referenceNumber: dispute.referenceNumber,
    reason: dispute.reason,
    createdAt: dispute.createdAt,
    messages,
  });
};
