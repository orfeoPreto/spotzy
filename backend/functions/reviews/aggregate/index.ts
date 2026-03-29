import { EventBridgeHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { listingMetadataKey } from '../../../shared/db/keys';
import { recalcAverage } from '../shared/aggregate';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: EventBridgeHandler<string, { listingId: string; bookingId: string }, void> = async (event) => {
  const log = createLogger('review-aggregate', event.id);
  const { listingId } = event.detail;
  log.info('aggregating reviews', { listingId });

  const listingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: listingMetadataKey(listingId) }));
  if (!listingResult.Item) { log.warn('listing not found', { listingId }); return; }

  const reviewsResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `REVIEW#${listingId}` },
  }));

  const reviews = reviewsResult.Items ?? [];
  const reviewCount = reviews.length;
  const avgRating = reviewCount > 0
    ? Math.round(reviews.reduce((sum, r) => sum + (r.avgScore ?? 0), 0) / reviewCount * 10) / 10
    : null;

  // recalcAverage is available for use in incremental updates if needed
  void recalcAverage;

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: listingMetadataKey(listingId),
    UpdateExpression: 'SET avgRating = :avg, reviewCount = :cnt, updatedAt = :now',
    ExpressionAttributeValues: { ':avg': avgRating, ':cnt': reviewCount, ':now': new Date().toISOString() },
  }));

  log.info('review aggregate updated', { listingId, avgRating, reviewCount });
};
