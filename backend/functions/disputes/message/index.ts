import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { extractClaims } from '../../../shared/utils/auth';
import { created, unauthorized, notFound, badRequest } from '../../../shared/utils/response';
import { disputeMetadataKey, disputeMessageKey, bookingMetadataKey, userProfileKey } from '../../../shared/db/keys';
import { classifyDisputeMessage } from '../shared/ai-triage';
import { generateDisputeResponse } from '../shared/ai-respond';
import { generateEscalationSummary } from '../shared/ai-summarize';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const forbidden = () => ({ statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) });

// Patterns that indicate the user wants to speak with a human
const HUMAN_REQUEST_PATTERNS = [
  /\bhuman\b/i, /\bagent\b/i, /\bperson\b/i, /\bspeak to\b/i, /\btalk to\b/i,
  /\bescalate\b/i, /\bmanager\b/i, /\bsupervisor\b/i, /\breal person\b/i,
];

const userWantsHuman = (message: string): boolean =>
  HUMAN_REQUEST_PATTERNS.some((p) => p.test(message));

interface EscalationCheck {
  escalate: boolean;
  reason: 'USER_REQUESTED' | 'BOT_CANNOT_RESOLVE' | 'MAX_EXCHANGES_REACHED' | '';
}

const shouldEscalate = (
  exchangeCount: number,
  userMessage: string,
  triageRequiresEscalation: boolean,
): EscalationCheck => {
  if (userWantsHuman(userMessage)) {
    return { escalate: true, reason: 'USER_REQUESTED' };
  }
  if (triageRequiresEscalation) {
    return { escalate: true, reason: 'BOT_CANNOT_RESOLVE' };
  }
  if (exchangeCount >= 3) {
    return { escalate: true, reason: 'MAX_EXCHANGES_REACHED' };
  }
  return { escalate: false, reason: '' };
};

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('dispute-message', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const disputeId = event.pathParameters?.id;
  if (!disputeId) return badRequest('Missing dispute id');

  const body = JSON.parse(event.body ?? '{}');
  const { content } = body;
  if (!content) return badRequest('content is required');

  const disputeResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: disputeMetadataKey(disputeId) }));
  if (!disputeResult.Item) return notFound();
  const dispute = disputeResult.Item;

  const isParty = claims.userId === dispute.spotterId || claims.userId === dispute.hostId;
  const isAgent = (event.requestContext as { authorizer?: { claims?: { 'cognito:groups'?: string } } })?.authorizer?.claims?.['cognito:groups']?.includes('AGENT');
  if (!isParty && !isAgent) return forbidden();

  const now = new Date().toISOString();
  const messageId = ulid();

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      ...disputeMessageKey(disputeId, now),
      messageId,
      disputeId,
      authorId: claims.userId,
      content,
      createdAt: now,
    },
  }));

  // AI triage for escalation triggers
  const { requiresEscalation } = classifyDisputeMessage(content);

  // Load conversation history for AI context
  const historyResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': `DISPUTE#${disputeId}`, ':sk': 'MSG#' },
    ScanIndexForward: true,
  }));
  const history = (historyResult.Items ?? []).map((m) => ({
    role: (m.authorId === 'SYSTEM' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: m.content as string,
  }));

  // Generate AI response
  const aiResponse = await generateDisputeResponse(history);
  const botAt = new Date(Date.now() + 1).toISOString();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      ...disputeMessageKey(disputeId, botAt),
      disputeId,
      authorId: 'SYSTEM',
      content: aiResponse,
      createdAt: botAt,
    },
  }));

  // Check escalation triggers
  const currentExchangeCount = (dispute.exchangeCount as number ?? 0) + 1;
  const { escalate, reason } = shouldEscalate(currentExchangeCount, content, requiresEscalation);

  if (escalate) {
    // Generate escalation summary
    let escalationSummary: string | null = null;
    try {
      // Fetch booking, host, guest for context
      const bookingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(dispute.bookingId as string) }));
      const bookingItem = bookingResult.Item ?? {};
      const hostResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(dispute.hostId as string) }));
      const host = hostResult.Item ?? {};
      const guestResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: userProfileKey(dispute.spotterId as string) }));
      const guest = guestResult.Item ?? {};

      const chatHistory = (historyResult.Items ?? []).map((m) => ({
        senderRole: m.authorId === 'SYSTEM' ? 'BOT' : 'USER',
        text: m.content as string,
      }));

      escalationSummary = await generateEscalationSummary({
        disputeId,
        listingAddress: bookingItem.listingAddress as string ?? 'Unknown',
        startTime: bookingItem.startTime as string ?? '',
        endTime: bookingItem.endTime as string ?? '',
        hostDisplayName: (host.displayName ?? host.pseudo ?? 'Host') as string,
        guestDisplayName: (guest.displayName ?? guest.pseudo ?? 'Guest') as string,
        chatHistory,
      });
    } catch (err) {
      log.warn('AI summary generation failed', { error: (err as Error).message });
      escalationSummary = null;
    }

    // Update dispute to ESCALATED
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: disputeMetadataKey(disputeId),
      UpdateExpression: 'SET #status = :status, escalatedAt = :now, escalationReason = :reason, escalationSummary = :summary, exchangeCount = :count, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'ESCALATED',
        ':now': now,
        ':reason': reason,
        ':summary': escalationSummary,
        ':count': currentExchangeCount,
      },
    }));

    log.info('dispute escalated', { disputeId, messageId, reason, exchangeCount: currentExchangeCount });
  } else {
    // Increment exchange count only
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: disputeMetadataKey(disputeId),
      UpdateExpression: 'SET exchangeCount = :count, updatedAt = :now',
      ExpressionAttributeValues: { ':count': currentExchangeCount, ':now': now },
    }));

    // Also update requiresEscalation flag if triage detected it
    if (requiresEscalation) {
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: disputeMetadataKey(disputeId),
        UpdateExpression: 'SET requiresEscalation = :esc, updatedAt = :now',
        ExpressionAttributeValues: { ':esc': true, ':now': now },
      }));
    }

    log.info('dispute message added', { disputeId, messageId, exchangeCount: currentExchangeCount, requiresEscalation });
  }

  return created({ messageId, disputeId, content, createdAt: now });
};
