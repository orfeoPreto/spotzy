import { EventBridgeHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: EventBridgeHandler<string, {
  bookingId: string;
  listingId: string;
  startTime: string;
  endTime: string;
}, void> = async (event) => {
  const log = createLogger('availability-release', event.id);
  const { bookingId, listingId } = event.detail;
  log.info('releasing availability', { bookingId, listingId });

  // Query for all availability records belonging to this booking
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    FilterExpression: 'bookingId = :bid',
    ExpressionAttributeValues: {
      ':pk': `LISTING#${listingId}`,
      ':prefix': 'AVAIL_BLOCK#',
      ':bid': bookingId,
    },
  }));

  const items = result.Items ?? [];
  if (items.length === 0) { log.info('already released, idempotent', { bookingId }); return; }

  await Promise.all(items.map((item) =>
    ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { PK: item.PK, SK: item.SK },
    }))
  ));
};
