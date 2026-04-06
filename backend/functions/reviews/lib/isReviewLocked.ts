import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export interface LockResult {
  locked: boolean;
  reason: 'OTHER_PARTY_REVIEWED' | 'WINDOW_EXPIRED' | null;
}

/**
 * Check whether a review is locked (no longer editable).
 * A review is locked if:
 * 1. The counterparty has already submitted their review, OR
 * 2. 7 days have passed since the booking ended (completedAt)
 */
export const isReviewLocked = async (
  ddb: DynamoDBDocumentClient,
  bookingId: string,
  authorId: string,
  booking: Record<string, unknown>,
): Promise<LockResult> => {
  const isSpotter = authorId === booking.spotterId;
  const otherAuthorId = isSpotter ? booking.hostId as string : booking.spotterId as string;
  const otherTargetId = isSpotter ? booking.spotterId as string : booking.listingId as string;

  // Check if counterparty has reviewed
  const otherReview = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    FilterExpression: 'authorId = :aid AND bookingId = :bid',
    ExpressionAttributeValues: { ':pk': `REVIEW#${otherTargetId}`, ':aid': otherAuthorId, ':bid': bookingId },
  }));
  if (otherReview.Items && otherReview.Items.length > 0) {
    return { locked: true, reason: 'OTHER_PARTY_REVIEWED' };
  }

  // Check 7-day window from completedAt
  const completedAt = booking.completedAt as string | undefined;
  if (completedAt) {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() > new Date(completedAt).getTime() + sevenDaysMs) {
      return { locked: true, reason: 'WINDOW_EXPIRED' };
    }
  }

  return { locked: false, reason: null };
};
