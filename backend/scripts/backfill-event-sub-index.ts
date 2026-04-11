/**
 * ONE-TIME migration script: backfills EVENT_SUB#{eventType} reverse-lookup rows
 * from existing USER#{userId}/WEBHOOK#{webhookId} records.
 *
 * Usage:
 *   ts-node backend/scripts/backfill-event-sub-index.ts --env=staging --dry-run
 *   ts-node backend/scripts/backfill-event-sub-index.ts --env=staging
 *   ts-node backend/scripts/backfill-event-sub-index.ts --env=prod
 *
 * Idempotent and resumable from checkpoint.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  TransactWriteCommand,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

const CHECKPOINT_PK = 'CHECKPOINT#backfill-event-sub-index';
const CHECKPOINT_SK = 'METADATA';
const BATCH_SIZE = 10;

export interface BackfillOptions {
  dryRun?: boolean;
  failAfter?: number;
}

export async function runBackfill(
  client: DynamoDBDocumentClient,
  tableName: string,
  options: BackfillOptions = {},
): Promise<{ backfilledCount: number; skippedCount: number }> {
  const { dryRun = false, failAfter } = options;
  let backfilledCount = 0;
  let skippedCount = 0;
  let processedCount = 0;

  // Load checkpoint for resume capability
  let lastEvaluatedKey: Record<string, any> | undefined;
  try {
    const checkpoint = await client.send(new GetCommand({
      TableName: tableName,
      Key: { PK: CHECKPOINT_PK, SK: CHECKPOINT_SK },
    }));
    if (checkpoint.Item?.lastProcessedKey) {
      lastEvaluatedKey = checkpoint.Item.lastProcessedKey;
      console.log('Resuming from checkpoint:', JSON.stringify(lastEvaluatedKey));
    }
  } catch {
    // No checkpoint, start from beginning
  }

  let hasMore = true;
  while (hasMore) {
    const result = await client.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(SK, :prefix) AND active = :t',
      ExpressionAttributeValues: {
        ':prefix': 'WEBHOOK#',
        ':t': true,
      },
      ExclusiveStartKey: lastEvaluatedKey,
      Limit: 100,
    }));

    const webhookRows = (result.Items ?? []).filter((item) =>
      item.PK?.startsWith('USER#') && item.SK?.startsWith('WEBHOOK#')
    );

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < webhookRows.length; i += BATCH_SIZE) {
      const batch = webhookRows.slice(i, i + BATCH_SIZE);
      const transactItems: any[] = [];

      for (const row of batch) {
        const userId = row.PK.replace('USER#', '');
        const webhookId = row.webhookId ?? row.SK.replace('WEBHOOK#', '');
        const events: string[] = row.events ?? [];

        for (const eventType of events) {
          transactItems.push({
            Put: {
              TableName: tableName,
              Item: {
                PK: `EVENT_SUB#${eventType}`,
                SK: `WEBHOOK#${userId}#${webhookId}`,
                webhookId,
                userId,
                url: row.url,
                signingSecretHash: row.signingSecret,
                active: true,
                registeredAt: row.createdAt,
              },
            },
          });
        }
      }

      if (transactItems.length > 0 && !dryRun) {
        // Simulate failure for testing
        if (failAfter !== undefined && processedCount >= failAfter) {
          // Save checkpoint before "crashing"
          await client.send(new PutCommand({
            TableName: tableName,
            Item: {
              PK: CHECKPOINT_PK,
              SK: CHECKPOINT_SK,
              lastProcessedKey: result.LastEvaluatedKey ?? lastEvaluatedKey,
              processedCount,
              updatedAt: new Date().toISOString(),
            },
          }));
          throw new Error(`Simulated failure after ${processedCount} items`);
        }

        // Split into sub-batches of 25 (TransactWriteItems limit)
        for (let j = 0; j < transactItems.length; j += 25) {
          const subBatch = transactItems.slice(j, j + 25);
          await client.send(new TransactWriteCommand({ TransactItems: subBatch }));
        }
      }

      backfilledCount += transactItems.length;
      processedCount += batch.length;
    }

    // Save checkpoint
    if (!dryRun && result.LastEvaluatedKey) {
      await client.send(new PutCommand({
        TableName: tableName,
        Item: {
          PK: CHECKPOINT_PK,
          SK: CHECKPOINT_SK,
          lastProcessedKey: result.LastEvaluatedKey,
          processedCount,
          updatedAt: new Date().toISOString(),
        },
      }));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
    hasMore = !!lastEvaluatedKey;
  }

  // Clean up checkpoint on successful completion
  if (!dryRun) {
    try {
      await client.send(new PutCommand({
        TableName: tableName,
        Item: {
          PK: CHECKPOINT_PK,
          SK: CHECKPOINT_SK,
          status: 'COMPLETED',
          processedCount,
          backfilledCount,
          completedAt: new Date().toISOString(),
        },
      }));
    } catch {
      // Non-critical
    }
  }

  console.log(`Backfill ${dryRun ? '(DRY RUN) ' : ''}complete: ${backfilledCount} EVENT_SUB# rows created, ${skippedCount} skipped`);
  return { backfilledCount, skippedCount };
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const envArg = args.find((a) => a.startsWith('--env='));
  const env = envArg?.split('=')[1] ?? 'dev';
  const dryRun = args.includes('--dry-run');

  const tableName = env === 'prod' ? 'spotzy-main' : `spotzy-main-${env}`;

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'eu-west-3',
  }));

  runBackfill(client, tableName, { dryRun })
    .then((result) => {
      console.log('Result:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Backfill failed:', err);
      process.exit(1);
    });
}
