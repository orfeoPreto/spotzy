import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, unauthorized, badRequest } from '../../../shared/utils/response';
import { bookingMetadataKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const forbidden = () => ({ statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) });

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('chat-get', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const bookingId = event.pathParameters?.bookingId;
  if (!bookingId) return badRequest('Missing bookingId');

  log.info('fetch chat messages', { bookingId });

  const bookingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(bookingId) }));
  if (!bookingResult.Item) return badRequest('Booking not found');
  const booking = bookingResult.Item;

  if (claims.userId !== booking.spotterId && claims.userId !== booking.hostId) return forbidden();

  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `CHAT#${bookingId}`, ':prefix': 'MSG#' },
    ScanIndexForward: true,
  }));

  const messages = (result.Items ?? []).sort((a, b) => a.SK < b.SK ? -1 : 1);

  // Clear unread count for this user/booking (best-effort, don't break get)
  try {
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { PK: `USER#${claims.userId}`, SK: `UNREAD#${bookingId}` },
    }));
  } catch (err) {
    log.error('failed to clear unread count', err, { bookingId });
  }

  log.info('chat messages fetched', { bookingId, count: messages.length });
  return ok({ messages, bookingId });
};
