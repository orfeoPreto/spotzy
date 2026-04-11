/**
 * Webhook delivery Lambda — triggered by EventBridge events.
 * Queries the EVENT_SUB#{eventType} index to find all webhooks subscribed
 * to the given event type, then delivers the payload to each webhook URL.
 */
import { createHmac } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const DELIVERY_TIMEOUT_MS = 10_000;

interface WebhookEvent {
  'detail-type': string;
  detail: Record<string, any>;
  source?: string;
}

interface EventSubRow {
  PK: string;
  SK: string;
  webhookId: string;
  userId: string;
  url: string;
  signingSecretHash: string;
  active: boolean;
  registeredAt: string;
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

async function deliverWebhook(
  url: string,
  payload: string,
  signingSecretHash: string,
  webhookId: string,
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const signature = signPayload(payload, signingSecretHash);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Spotzy-Signature': `sha256=${signature}`,
        'X-Spotzy-Webhook-Id': webhookId,
      },
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return { success: response.ok, statusCode: response.status };
  } catch (err: any) {
    clearTimeout(timeout);
    return { success: false, error: err.message ?? 'unknown error' };
  }
}

export const handler = async (event: WebhookEvent): Promise<void> => {
  const eventType = event['detail-type'];
  if (!eventType) {
    console.warn('No detail-type in event, skipping');
    return;
  }

  // Query the EVENT_SUB# index for all webhooks subscribed to this event type
  const subscriptions: EventSubRow[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'active = :t',
      ExpressionAttributeValues: {
        ':pk': `EVENT_SUB#${eventType}`,
        ':t': true,
      },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    subscriptions.push(...(result.Items ?? []) as EventSubRow[]);
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  if (subscriptions.length === 0) {
    console.log(`No subscribers for event type: ${eventType}`);
    return;
  }

  const payload = JSON.stringify({
    eventType,
    data: event.detail,
    timestamp: new Date().toISOString(),
  });

  // Deliver to all subscribers in parallel
  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      deliverWebhook(sub.url, payload, sub.signingSecretHash, sub.webhookId)
        .then((result) => {
          if (!result.success) {
            console.warn(`Delivery failed for webhook ${sub.webhookId} to ${sub.url}:`, result);
          }
          return result;
        })
    ),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.length - succeeded;
  console.log(`Webhook delivery for ${eventType}: ${succeeded} succeeded, ${failed} failed out of ${subscriptions.length} subscribers`);
};
