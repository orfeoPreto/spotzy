import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ulid } from 'ulid';
import { extractClaims } from '../../../shared/utils/auth';
import { created, ok, badRequest, unauthorized, forbidden, conflict } from '../../../shared/utils/response';
import { bookingMetadataKey, reviewKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';
import { isReviewLocked } from '../lib/isReviewLocked';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

const SPOTTER_SECTIONS = new Set(['LOCATION', 'CLEANLINESS', 'VALUE', 'ACCESS']);
const HOST_SECTIONS = new Set(['PUNCTUALITY', 'VEHICLE_CONDITION', 'COMMUNICATION']);


export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('review-create', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const body = JSON.parse(event.body ?? '{}');
  const { bookingId, sections, description } = body;
  log.info('review attempt', { bookingId });

  if (!sections || sections.length === 0) return badRequest('MISSING_REQUIRED_FIELD', { field: 'sections' });
  if (description && description.length > 500) return badRequest('FIELD_TOO_LONG', { field: 'description', maxLength: 500 });

  // Validate scores
  for (const { score } of sections) {
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return badRequest('INVALID_RATING');
    }
  }

  // Fetch booking
  const bookingResult = await ddb.send(new GetCommand({ TableName: TABLE, Key: bookingMetadataKey(bookingId) }));
  if (!bookingResult.Item) return badRequest('BOOKING_NOT_FOUND');
  const booking = bookingResult.Item;

  if (booking.status !== 'COMPLETED') return badRequest('BOOKING_NOT_COMPLETED');

  const isSpotter = claims.userId === booking.spotterId;
  const isHost = claims.userId === booking.hostId;
  if (!isSpotter && !isHost) return forbidden();

  // Role-based section validation
  const allowedSections = isSpotter ? SPOTTER_SECTIONS : HOST_SECTIONS;
  for (const { section } of sections) {
    if (!allowedSections.has(section)) {
      return badRequest('INVALID_SECTION_FOR_ROLE', { section });
    }
  }

  // Check for existing review by this user
  const targetId = isSpotter ? booking.listingId : booking.spotterId;
  const existingReviews = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    FilterExpression: 'authorId = :aid AND bookingId = :bid',
    ExpressionAttributeValues: { ':pk': `REVIEW#${targetId}`, ':aid': claims.userId, ':bid': bookingId },
  }));

  if (existingReviews.Items && existingReviews.Items.length > 0) {
    // Review exists — check if it can be edited (lock check includes window expiry)
    const lockResult = await isReviewLocked(ddb, bookingId, claims.userId, booking);
    if (lockResult.locked) {
      return conflict('REVIEW_LOCKED', { reason: lockResult.reason! });
    }

    // Not locked — allow update
    const avgScore = Math.round(sections.reduce((sum: number, s: { score: number }) => sum + s.score, 0) / sections.length * 10) / 10;
    const existingReview = existingReviews.Items[0];
    const now = new Date().toISOString();

    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: existingReview.PK as string, SK: existingReview.SK as string },
      UpdateExpression: 'SET sections = :sec, avgScore = :avg, description = :desc, updatedAt = :now',
      ExpressionAttributeValues: {
        ':sec': sections,
        ':avg': avgScore,
        ':desc': description ?? null,
        ':now': now,
      },
    }));

    log.info('review updated', { reviewId: existingReview.reviewId, bookingId, avgScore });
    return ok({ ...existingReview, sections, avgScore, description, updatedAt: now });
  }

  // Review window check (7 days) — only for first-time submissions
  if (booking.completedAt) {
    const daysSinceCompletion = (Date.now() - new Date(booking.completedAt).getTime()) / 86400000;
    if (daysSinceCompletion > 7) return badRequest('REVIEW_WINDOW_EXPIRED');
  }

  // Check if other party has reviewed (for visibility toggle)
  const otherAuthorId = isSpotter ? booking.hostId : booking.spotterId;
  const otherTargetId = isSpotter ? booking.spotterId : booking.listingId;
  const otherReview = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    FilterExpression: 'authorId = :aid AND bookingId = :bid',
    ExpressionAttributeValues: { ':pk': `REVIEW#${otherTargetId}`, ':aid': otherAuthorId, ':bid': bookingId },
  }));
  const published = (otherReview.Items?.length ?? 0) > 0;

  const reviewId = ulid();
  const avgScore = Math.round(sections.reduce((sum: number, s: { score: number }) => sum + s.score, 0) / sections.length * 10) / 10;

  const review = {
    ...reviewKey(targetId, bookingId),
    reviewId,
    bookingId,
    authorId: claims.userId,
    targetId,
    sections,
    avgScore,
    description,
    published,
    createdAt: new Date().toISOString(),
  };

  await ddb.send(new PutCommand({ TableName: TABLE, Item: review }));

  // Notify the reviewed party
  const reviewedUserId = isSpotter ? booking.hostId : booking.spotterId;
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS,
      Source: 'spotzy',
      DetailType: 'review.created',
      Detail: JSON.stringify({
        reviewId,
        bookingId,
        authorId: claims.userId,
        reviewedUserId,
        listingId: booking.listingId,
        listingAddress: booking.listingAddress,
        avgScore,
      }),
    }],
  }));

  log.info('review created', { reviewId, bookingId, avgScore, published });
  return created(review);
};
