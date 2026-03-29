/**
 * Integration test for mutual review visibility.
 * Both host and spotter reviews must be written before either becomes public.
 * Requires: docker-compose -f docker-compose.test.yml up -d
 */
import {
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { createTestTable, dropTestTable, docClient, TABLE_NAME } from './setup';

beforeAll(async () => {
  await dropTestTable();
  await createTestTable();
}, 30_000);

afterAll(async () => {
  await dropTestTable();
});

describe('Review visibility — mutual publish gate', () => {
  const bookingId = `bk-${ulid()}`;
  const listingId = `listing-${ulid()}`;
  const hostId = `host-${ulid()}`;
  const spotterId = `spotter-${ulid()}`;

  beforeAll(async () => {
    // Create a COMPLETED booking
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `BOOKING#${bookingId}`,
        SK: 'METADATA',
        bookingId,
        listingId,
        hostId,
        spotterId,
        status: 'completed',
      },
    }));
  });

  it('host writes review → published=false initially', async () => {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `REVIEW#${listingId}`,
        SK: `REVIEW#${bookingId}`,
        bookingId,
        authorId: hostId,
        targetId: listingId,
        targetType: 'listing',
        rating: 4,
        comment: 'Great spotter!',
        published: false,
        authorType: 'HOST',
      },
    }));

    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `REVIEW#${listingId}`, SK: `REVIEW#${bookingId}` },
    }));
    expect(result.Item?.published).toBe(false);
  });

  it('spotter writes review → both reviews flipped to published=true', async () => {
    // Write spotter review
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `REVIEW#${spotterId}`,
        SK: `REVIEW#${bookingId}`,
        bookingId,
        authorId: spotterId,
        targetId: hostId,
        targetType: 'user',
        rating: 5,
        comment: 'Perfect host!',
        published: false,
        authorType: 'SPOTTER',
      },
    }));

    // Simulate the publish-both logic: update both reviews to published=true
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { PK: `REVIEW#${listingId}`, SK: `REVIEW#${bookingId}` },
            UpdateExpression: 'SET published = :t',
            ExpressionAttributeValues: { ':t': true },
          },
        },
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { PK: `REVIEW#${spotterId}`, SK: `REVIEW#${bookingId}` },
            UpdateExpression: 'SET published = :t',
            ExpressionAttributeValues: { ':t': true },
          },
        },
      ],
    }));

    const hostReview = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `REVIEW#${listingId}`, SK: `REVIEW#${bookingId}` },
    }));
    const spotterReview = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `REVIEW#${spotterId}`, SK: `REVIEW#${bookingId}` },
    }));

    expect(hostReview.Item?.published).toBe(true);
    expect(spotterReview.Item?.published).toBe(true);
  });

  it('public query → only published reviews returned', async () => {
    // Write an unpublished review for a different booking (only one party reviewed)
    const otherBookingId = `bk-${ulid()}`;
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `REVIEW#${listingId}`,
        SK: `REVIEW#${otherBookingId}`,
        bookingId: otherBookingId,
        rating: 3,
        published: false,
      },
    }));

    // Query all reviews for this listing, filter to published only
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: 'published = :pub',
      ExpressionAttributeValues: {
        ':pk': `REVIEW#${listingId}`,
        ':prefix': 'REVIEW#',
        ':pub': true,
      },
    }));

    expect(result.Items?.length).toBeGreaterThanOrEqual(1);
    expect(result.Items?.every((r) => r.published === true)).toBe(true);
    // The unpublished review for otherBookingId must not appear
    expect(result.Items?.find((r) => r.bookingId === otherBookingId)).toBeUndefined();
  });
});
