import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createLogger } from '../../../shared/utils/logger';
import type { BlockRequest, BlockBooking } from '../../../shared/block-reservations/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

interface AnonymiseEvent {
  reqId: string;
}

/**
 * Check if a stub user has any activity beyond the block reservation.
 * Activity means: other bookings, listings, or chat messages.
 */
async function hasOtherActivity(spotterId: string, reqId: string): Promise<boolean> {
  // Query USER# partition for any booking, listing, or message items
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `USER#${spotterId}` },
      Limit: 20,
    })
  );

  const items = result.Items ?? [];
  for (const item of items) {
    const sk = item.SK as string;
    // PROFILE is always there, skip it
    if (sk === 'PROFILE') continue;
    // BLOCKREQ# reverse projections for this request don't count
    if (sk.startsWith('BLOCKREQ#') && sk.includes(reqId)) continue;
    // Anything else (BOOKING#, LISTING#, CHAT#, etc.) is activity
    return true;
  }

  return false;
}

export const handler = async (event: AnonymiseEvent): Promise<void> => {
  const log = createLogger('block-guest-anonymise', 'scheduler', undefined);
  const { reqId } = event;
  log.info('anonymise invoked', { reqId });

  // Load all items under the BLOCKREQ#
  const queryResult = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `BLOCKREQ#${reqId}` },
    })
  );

  const items = queryResult.Items ?? [];
  const metadata = items.find((i) => i.SK === 'METADATA') as unknown as BlockRequest | undefined;
  if (!metadata) {
    log.warn('BLOCKREQ# not found', { reqId });
    return;
  }

  const bookings = items.filter(
    (i) => typeof i.SK === 'string' && i.SK.startsWith('BOOKING#')
  ) as unknown as BlockBooking[];

  const now = new Date().toISOString();
  let anonymisedCount = 0;
  let deletedStubUsers = 0;

  for (const booking of bookings) {
    // Skip already anonymised bookings
    if (booking.guestName === null && booking.guestEmail === null && booking.guestPhone === null) {
      continue;
    }

    // Anonymise PII fields
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `BLOCKREQ#${reqId}`, SK: `BOOKING#${booking.bookingId}` },
        UpdateExpression:
          'SET guestName = :null, guestEmail = :null, guestPhone = :null, updatedAt = :now',
        ExpressionAttributeValues: { ':null': null, ':now': now },
      })
    );
    anonymisedCount++;

    // Check if stub user should be deleted
    if (booking.spotterId) {
      const hasActivity = await hasOtherActivity(booking.spotterId, reqId);
      if (!hasActivity) {
        // Delete the stub user's PROFILE
        try {
          await ddb.send(
            new DeleteCommand({
              TableName: TABLE,
              Key: { PK: `USER#${booking.spotterId}`, SK: 'PROFILE' },
            })
          );
          deletedStubUsers++;
          log.info('deleted stub user', { spotterId: booking.spotterId });
        } catch (err) {
          log.warn('failed to delete stub user', { spotterId: booking.spotterId, err });
        }
      }
    }
  }

  log.info('anonymisation complete', { reqId, anonymisedCount, deletedStubUsers });
};
