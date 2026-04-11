import { APIGatewayProxyHandler } from 'aws-lambda';
import { createHash, randomBytes } from 'crypto';
import { ulid } from 'ulid';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ok, created, badRequest, internalError } from '../../../shared/utils/response';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const VALID_EVENTS = ['booking.confirmed', 'booking.active', 'booking.completed', 'booking.cancelled', 'message.received'];

export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.requestContext.authorizer?.userId
    ?? event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  // --- POST: Register webhook ---
  if (event.httpMethod === 'POST' && !event.pathParameters?.webhookId) {
    const body = JSON.parse(event.body ?? '{}');
    const { url, events: evts } = body;
    if (!url?.trim()) return badRequest('url is required');
    if (!evts?.length) return badRequest('events must contain at least one event type');

    const invalidTypes = evts.filter((e: string) => !VALID_EVENTS.includes(e));
    if (invalidTypes.length > 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'INVALID_EVENT_TYPE', details: { invalidTypes } }),
      };
    }

    const webhookId = ulid();
    const rawSecret = `whsec_${randomBytes(16).toString('hex')}`;
    const hashedSecret = createHash('sha256').update(rawSecret).digest('hex');
    const now = new Date().toISOString();

    // Build TransactWriteItems: 1 user-owned row + N EVENT_SUB# rows
    const transactItems: any[] = [
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: `USER#${userId}`, SK: `WEBHOOK#${webhookId}`,
            webhookId, url: url.trim(), events: evts,
            signingSecret: hashedSecret, active: true, createdAt: now,
          },
        },
      },
    ];

    for (const eventType of evts) {
      transactItems.push({
        Put: {
          TableName: TABLE,
          Item: {
            PK: `EVENT_SUB#${eventType}`,
            SK: `WEBHOOK#${userId}#${webhookId}`,
            webhookId,
            userId,
            url: url.trim(),
            signingSecretHash: hashedSecret,
            active: true,
            registeredAt: now,
          },
        },
      });
    }

    try {
      await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (err) {
      console.error('TransactWriteCommand failed during webhook register', err);
      return internalError();
    }

    return created({ webhookId, url: url.trim(), events: evts, signingSecret: rawSecret, active: true, createdAt: now });
  }

  // --- GET: List webhooks ---
  if (event.httpMethod === 'GET') {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'WEBHOOK#' },
    }));

    const webhooks = (result.Items ?? []).map(({ PK, SK, signingSecret, ...rest }) => rest);
    return ok({ webhooks });
  }

  // --- DELETE: Delete webhook + all EVENT_SUB# rows ---
  if (event.httpMethod === 'DELETE') {
    const webhookId = event.pathParameters?.webhookId;
    if (!webhookId) return badRequest('webhookId is required');

    // Load the existing user-owned row to find the events array
    const existing = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `USER#${userId}`, SK: `WEBHOOK#${webhookId}` },
    }));

    if (!existing.Item) {
      // Idempotent: already deleted
      return ok({ webhookId, deletedAt: new Date().toISOString() });
    }

    const evts: string[] = existing.Item.events ?? [];

    // Build TransactWriteItems: delete user-owned row + all EVENT_SUB# rows
    const transactItems: any[] = [
      {
        Delete: {
          TableName: TABLE,
          Key: { PK: `USER#${userId}`, SK: `WEBHOOK#${webhookId}` },
        },
      },
    ];

    for (const eventType of evts) {
      transactItems.push({
        Delete: {
          TableName: TABLE,
          Key: {
            PK: `EVENT_SUB#${eventType}`,
            SK: `WEBHOOK#${userId}#${webhookId}`,
          },
        },
      });
    }

    try {
      await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (err) {
      console.error('TransactWriteCommand failed during webhook delete', err);
      return internalError();
    }

    return ok({ webhookId, deletedAt: new Date().toISOString() });
  }

  return badRequest('Unsupported method');
};
