import { EventBridgeHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const getDatesInRange = (startTime: string, endTime: string): string[] => {
  const dates: string[] = [];
  const current = new Date(startTime);
  const endDate = new Date(endTime);

  // Normalise to start of UTC day
  const startDay = new Date(current);
  startDay.setUTCHours(0, 0, 0, 0);

  const endDay = new Date(endDate);
  endDay.setUTCHours(0, 0, 0, 0);

  const iter = new Date(startDay);

  // Include the start day always; include subsequent days only if they are strictly
  // before the end day (i.e. the booking is not already finished at midnight of that day).
  // Special case: if start and end are on the same calendar day, include that day once.
  do {
    dates.push(iter.toISOString().split('T')[0]);
    iter.setUTCDate(iter.getUTCDate() + 1);
  } while (iter < endDay);

  return dates;
};

export const handler: EventBridgeHandler<string, {
  bookingId: string;
  listingId: string;
  startTime: string;
  endTime: string;
  oldStartTime?: string;
  oldEndTime?: string;
}, void> = async (event) => {
  const log = createLogger('availability-block', event.id);
  const { bookingId, listingId, startTime, endTime } = event.detail;
  const dates = getDatesInRange(startTime, endTime);
  log.info('blocking availability', { bookingId, listingId, dates });
  const now = new Date().toISOString();

  await Promise.all(dates.map((date) =>
    ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `LISTING#${listingId}`,
        SK: `AVAIL#${date}#${bookingId}`,
        listingId,
        bookingId,
        date,
        startTime,
        endTime,
        createdAt: now,
      },
    }))
  ));
};
