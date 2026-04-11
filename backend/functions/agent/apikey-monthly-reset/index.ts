import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const cloudwatch = new CloudWatchClient({});

const BATCH_SIZE = 100;

export const handler = async (event: { time?: string; source?: string }): Promise<{ resetCount: number }> => {
  const newResetAt = new Date(event.time ?? new Date().toISOString()).toISOString();

  let resetCount = 0;
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND attribute_not_exists(revokedAt)',
      ExpressionAttributeValues: {
        ':prefix': 'APIKEY#',
        ':sk': 'METADATA',
      },
      ExclusiveStartKey: lastEvaluatedKey,
      Limit: BATCH_SIZE,
    }));

    const updates = (result.Items ?? []).map(async (item) => {
      try {
        await ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: 'SET monthlySpendingSoFarEur = :zero, monthlyResetAt = :now',
          ExpressionAttributeValues: { ':zero': 0, ':now': newResetAt },
          ConditionExpression: 'attribute_not_exists(revokedAt)',
        }));
        return true;
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    });

    const results = await Promise.all(updates);
    resetCount += results.filter(Boolean).length;

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  // Emit CloudWatch metric
  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: 'Spotzy/AgentApi',
    MetricData: [{
      MetricName: 'MonthlyResetCount',
      Value: resetCount,
      Unit: 'Count',
      Timestamp: new Date(),
    }],
  }));

  console.log(`Monthly reset complete: ${resetCount} keys reset at ${newResetAt}`);
  return { resetCount };
};
