import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { extractClaims } from '../../../shared/utils/auth';
import { created, unauthorized, notFound, badRequest } from '../../../shared/utils/response';
import { disputeMetadataKey, disputeMessageKey } from '../../../shared/db/keys';
import { classifyDisputeMessage } from '../shared/ai-triage';
import { generateDisputeResponse } from '../shared/ai-respond';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const forbidden = () => ({ statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) });

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
  if (requiresEscalation) {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: disputeMetadataKey(disputeId),
      UpdateExpression: 'SET requiresEscalation = :esc, updatedAt = :now',
      ExpressionAttributeValues: { ':esc': true, ':now': now },
    }));
  }

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

  log.info('dispute message added', { disputeId, messageId, requiresEscalation });
  return created({ messageId, disputeId, content, createdAt: now });
};
