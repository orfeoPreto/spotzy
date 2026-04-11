import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { ok, created, badRequest, notFound } from '../../../shared/utils/response';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.requestContext.authorizer?.userId
    ?? event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  const bookingId = event.pathParameters?.bookingId;
  if (!bookingId) return badRequest('bookingId is required');

  // Verify user is participant
  const booking = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `BOOKING#${bookingId}`, SK: 'METADATA' },
  }));
  if (!booking.Item) return notFound();
  if (booking.Item.spotterId !== userId && booking.Item.hostId !== userId) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'FORBIDDEN' }) };
  }

  if (event.httpMethod === 'GET') {
    const since = event.queryStringParameters?.since;
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: since
        ? 'PK = :pk AND SK > :since'
        : 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: since
        ? { ':pk': `CHAT#${bookingId}`, ':since': `MSG#${since}` }
        : { ':pk': `CHAT#${bookingId}`, ':prefix': 'MSG#' },
      Limit: 100,
    }));

    const messages = (result.Items ?? []).map(({ PK, SK, GSI1PK, GSI1SK, ...rest }) => rest);
    return ok({ bookingId, messages });
  }

  if (event.httpMethod === 'POST') {
    const { text } = JSON.parse(event.body ?? '{}');
    if (!text?.trim()) return badRequest('text is required');
    if (text.length > 2000) return badRequest('Message too long (max 2000 characters)');

    const messageId = ulid();
    const now = new Date().toISOString();
    const senderRole = booking.Item.spotterId === userId ? 'GUEST' : 'HOST';

    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `CHAT#${bookingId}`,
        SK: `MSG#${now}#${messageId}`,
        GSI1PK: `SENDER#${userId}`,
        GSI1SK: `MSG#${now}`,
        messageId, bookingId, senderId: userId, senderRole,
        text: text.trim(), sentAt: now, isRead: false,
      },
    }));

    return created({ messageId, bookingId, senderRole, text: text.trim(), sentAt: now, isRead: false });
  }

  return badRequest('Unsupported method');
};
