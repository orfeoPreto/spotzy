import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ok, notFound, badRequest } from '../../../shared/utils/response';
import { disputeMetadataKey, bookingMetadataKey, userProfileKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';
import { generateEscalationSummary } from '../shared/ai-summarize';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('dispute-escalate', event.requestContext.requestId);

  const disputeId = event.pathParameters?.id;
  if (!disputeId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'disputeId' });
  log.info('escalate attempt', { disputeId });

  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: disputeMetadataKey(disputeId) }));
  if (!result.Item) return notFound();
  const dispute = result.Item;

  if (dispute.status === 'ESCALATED') return ok({ disputeId, status: 'ESCALATED', message: 'Already escalated' });

  // Fetch chat history for AI summary
  const messagesResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `DISPUTE#${disputeId}`, ':sk': 'MSG#' },
    ScanIndexForward: true,
  }));
  const chatHistory = (messagesResult.Items ?? []).map((m) => ({
    senderRole: m.authorId === 'SYSTEM' ? 'BOT' : 'USER',
    text: m.content as string,
  }));

  // Fetch booking, host, guest for context
  const bookingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(dispute.bookingId as string) }));
  const booking = bookingResult.Item ?? {};
  const hostResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(dispute.hostId as string) }));
  const host = hostResult.Item ?? {};
  const guestResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(dispute.spotterId as string) }));
  const guest = guestResult.Item ?? {};

  // Generate AI summary (non-blocking — if it fails, set null)
  let escalationSummary: string | null = null;
  try {
    escalationSummary = await generateEscalationSummary({
      disputeId,
      listingAddress: booking.listingAddress as string ?? 'Unknown',
      startTime: booking.startTime as string ?? '',
      endTime: booking.endTime as string ?? '',
      hostDisplayName: (host.displayName ?? host.pseudo ?? 'Host') as string,
      guestDisplayName: (guest.displayName ?? guest.pseudo ?? 'Guest') as string,
      chatHistory,
    });
  } catch (err) {
    log.warn('AI summary generation failed, proceeding without summary', { error: (err as Error).message });
    escalationSummary = null;
  }

  const now = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: disputeMetadataKey(disputeId),
    UpdateExpression: 'SET #status = :s, escalatedAt = :now, assignedToAgentQueue = :q, escalationSummary = :summary, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':s': 'ESCALATED', ':now': now, ':q': true, ':summary': escalationSummary },
  }));

  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS, Source: 'spotzy', DetailType: 'dispute.escalated',
      Detail: JSON.stringify({ disputeId, bookingId: dispute.bookingId, hostId: dispute.hostId, spotterId: dispute.spotterId }),
    }],
  }));

  log.info('dispute escalated', { disputeId, hasSummary: !!escalationSummary });
  return ok({ disputeId, status: 'ESCALATED', escalatedAt: now, escalationSummary });
};
