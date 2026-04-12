import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { ulid } from 'ulid';
import { extractClaims } from '../../../shared/utils/auth';
import { created, badRequest, unauthorized, forbidden } from '../../../shared/utils/response';
import { bookingMetadataKey } from '../../../shared/db/keys';
import { stripEmoji } from '../shared/emoji-filter';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const WS_ENDPOINT = process.env.WS_ENDPOINT ?? 'https://localhost';

const ACTIVE_BOOKING_STATUSES = new Set(['CONFIRMED', 'ACTIVE']);

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('chat-send', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const bookingId = event.pathParameters?.bookingId;
  if (!bookingId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'bookingId' });

  const body = JSON.parse(event.body ?? '{}');
  const { type, content, imageUrl } = body;

  // Validate message
  if (type === 'TEXT') {
    if (!content || content.length > 2000) return badRequest('MESSAGE_TOO_LONG', { maxLength: 2000 });
  } else if (type === 'IMAGE') {
    if (!imageUrl) return badRequest('MISSING_REQUIRED_FIELD', { field: 'imageUrl' });
  }

  // Fetch booking and check active status
  const bookingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(bookingId) }));
  if (!bookingResult.Item) return badRequest('BOOKING_NOT_FOUND');
  const booking = bookingResult.Item;

  if (!ACTIVE_BOOKING_STATUSES.has(booking.status)) {
    return forbidden();
  }

  const isSpotter = claims.userId === booking.spotterId;
  const isHost = claims.userId === booking.hostId;
  if (!isSpotter && !isHost) return forbidden();

  // Determine recipient
  const recipientId = isSpotter ? booking.hostId : booking.spotterId;

  // Strip emoji from text
  const cleanContent = type === 'TEXT' ? stripEmoji(content) : content;

  // Store message
  const messageId = ulid();
  const timestamp = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 90 * 86400;

  const message = {
    PK: `CHAT#${bookingId}`,
    SK: `MSG#${timestamp}#${messageId}`,
    messageId,
    bookingId,
    senderId: claims.userId,
    recipientId,
    type,
    content: cleanContent,
    imageUrl: type === 'IMAGE' ? imageUrl : undefined,
    read: false,
    ttl,
    createdAt: timestamp,
  };

  await ddb.send(new PutCommand({ TableName: TABLE, Item: message }));

  // Increment unread count for recipient (best-effort, don't break send)
  try {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `USER#${recipientId}`, SK: `UNREAD#${bookingId}` },
      UpdateExpression: 'ADD unreadCount :one',
      ExpressionAttributeValues: { ':one': 1 },
    }));
  } catch (err) {
    log.error('failed to increment unread count', err, { recipientId, bookingId });
  }

  log.info('message sent', { bookingId, messageId, type, recipientId });

  // Push to recipient WebSocket connections
  const connectionsResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `USER#${recipientId}`, ':prefix': 'CONNECTION#' },
  }));

  const connections = connectionsResult.Items ?? [];
  const apigw = new ApiGatewayManagementApiClient({ endpoint: WS_ENDPOINT });

  await Promise.all(connections.map(async (conn) => {
    try {
      await apigw.send(new PostToConnectionCommand({
        ConnectionId: conn.connectionId,
        Data: Buffer.from(JSON.stringify(message)),
      }));
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'GoneException') {
        await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: conn.PK, SK: conn.SK } }));
      }
    }
  }));

  return created(message);
};
