import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { userPrefsKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler: Handler<any, void> = async (event) => {
  const log = createLogger('preferences-learn', event.id ?? 'unknown');
  const dt = event['detail-type'];
  const d = event.detail;

  log.info('preferences event', { detailType: dt });

  if (dt === 'booking.completed') {
    const spotterId = d.spotterId as string;
    const geohash = d.listingGeohash as string;
    const spotType = d.spotType as string;
    const isCovered = d.isCovered as boolean;
    const price = d.totalPrice as number;

    const existing = await ddb.send(new GetCommand({ TableName: TABLE, Key: userPrefsKey(spotterId) }));

    if (!existing.Item) {
      // Create initial prefs record
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: {
          ...userPrefsKey(spotterId),
          totalBookings: 1,
          coveredCount: isCovered ? 1 : 0,
          destinationHistory: { [geohash]: 1 },
          spotTypeHistory: { [spotType]: 1 },
          priceHistory: [price],
          searchHistory: {},
          filterHistory: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }));
    } else {
      const prefs = existing.Item;
      const newTotal = (prefs.totalBookings ?? 0) + 1;
      const newCovered = (prefs.coveredCount ?? 0) + (isCovered ? 1 : 0);
      const destHistory = { ...(prefs.destinationHistory as Record<string, number> ?? {}), [geohash]: ((prefs.destinationHistory as Record<string, number>)?.[geohash] ?? 0) + 1 };
      const typeHistory = { ...(prefs.spotTypeHistory as Record<string, number> ?? {}), [spotType]: ((prefs.spotTypeHistory as Record<string, number>)?.[spotType] ?? 0) + 1 };
      const priceHistory = [...(prefs.priceHistory as number[] ?? []), price];

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: userPrefsKey(spotterId),
        UpdateExpression: 'SET totalBookings = :tb, coveredCount = :cc, destinationHistory = :dh, spotTypeHistory = :sth, priceHistory = :ph, updatedAt = :now',
        ExpressionAttributeValues: {
          ':tb': newTotal,
          ':cc': newCovered,
          ':dh': destHistory,
          ':sth': typeHistory,
          ':ph': priceHistory,
          ':now': new Date().toISOString(),
        },
      }));
    }
  }

  if (dt === 'search.performed') {
    const spotterId = d.spotterId as string;
    const geohash = d.geohash as string;
    const filters = d.filters as Record<string, unknown> ?? {};

    const existing = await ddb.send(new GetCommand({ TableName: TABLE, Key: userPrefsKey(spotterId) }));

    if (!existing.Item) {
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: {
          ...userPrefsKey(spotterId),
          totalBookings: 0,
          coveredCount: 0,
          destinationHistory: {},
          spotTypeHistory: {},
          priceHistory: [],
          searchHistory: { [geohash]: 1 },
          filterHistory: filters,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }));
    } else {
      const prefs = existing.Item;
      const searchHistory = { ...(prefs.searchHistory as Record<string, number> ?? {}), [geohash]: ((prefs.searchHistory as Record<string, number>)?.[geohash] ?? 0) + 1 };
      const filterHistory = { ...(prefs.filterHistory as Record<string, unknown> ?? {}), ...filters };

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: userPrefsKey(spotterId),
        UpdateExpression: 'SET searchHistory = :sh, filterHistory = :fh, updatedAt = :now',
        ExpressionAttributeValues: {
          ':sh': searchHistory,
          ':fh': filterHistory,
          ':now': new Date().toISOString(),
        },
      }));
    }
  }
};
