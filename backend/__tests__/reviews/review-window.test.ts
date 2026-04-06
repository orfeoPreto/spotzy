import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/reviews/create/index';
import { mockAuthContext } from '../setup';
import { buildBooking } from '../factories/booking.factory';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

const BOOKING_ID = 'booking-window-test';
const SPOTTER_ID = 'spotter-window-1';
const HOST_ID = 'host-window-1';
const LISTING_ID = 'listing-window-1';

const yesterday = () => new Date(Date.now() - 86400000).toISOString();
const eightDaysAgo = () => new Date(Date.now() - 8 * 86400000).toISOString();

const completedBooking = {
  ...buildBooking({ bookingId: BOOKING_ID, spotterId: SPOTTER_ID, hostId: HOST_ID, listingId: LISTING_ID, status: 'COMPLETED' }),
  completedAt: yesterday(),
  PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA',
};

const spotterSections = [
  { section: 'LOCATION', score: 4 },
  { section: 'CLEANLINESS', score: 5 },
];

const makeEvent = (body: object, auth = mockAuthContext(SPOTTER_ID)): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify({ bookingId: BOOKING_ID, ...body }), pathParameters: null, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: '/reviews', multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: completedBooking });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
  ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
});

describe('review editing window', () => {
  it('first submission always allowed on COMPLETED booking → 201', async () => {
    // No existing review
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(makeEvent({ sections: spotterSections }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
  });

  it('allows update when own review exists but counterparty has NOT reviewed → 200', async () => {
    // First query: existing review by this user → found
    // Second query: counterparty review → not found (not locked)
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [{ reviewId: 'existing-review', authorId: SPOTTER_ID, bookingId: BOOKING_ID, avgScore: 3 }] })
      .resolves({ Items: [] }); // no counterparty review
    const res = await handler(makeEvent({ sections: spotterSections }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('returns 409 REVIEW_LOCKED when counterparty has reviewed', async () => {
    // First query: existing review by this user → found
    // Second query (lock check - counterparty): found
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [{ reviewId: 'existing-review', authorId: SPOTTER_ID, bookingId: BOOKING_ID }] })
      .resolvesOnce({ Items: [{ reviewId: 'host-review', authorId: HOST_ID, bookingId: BOOKING_ID }] });
    const res = await handler(makeEvent({ sections: spotterSections }), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    const body = JSON.parse(res!.body);
    expect(body.error).toBe('REVIEW_LOCKED');
    expect(body.reason).toBe('OTHER_PARTY_REVIEWED');
  });

  it('returns 409 REVIEW_LOCKED after 7-day window expires', async () => {
    // Booking completed 8 days ago
    ddbMock.on(GetCommand).resolves({ Item: { ...completedBooking, completedAt: eightDaysAgo() } });
    // First query: existing review by this user → found
    // Second query (lock check - counterparty): not found
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [{ reviewId: 'existing-review', authorId: SPOTTER_ID, bookingId: BOOKING_ID }] })
      .resolves({ Items: [] });
    const res = await handler(makeEvent({ sections: spotterSections }), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    const body = JSON.parse(res!.body);
    expect(body.error).toBe('REVIEW_LOCKED');
    expect(body.reason).toBe('WINDOW_EXPIRED');
  });

  it('update changes the review data (rating updated)', async () => {
    // Existing review found, not locked
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [{ reviewId: 'existing-review', authorId: SPOTTER_ID, bookingId: BOOKING_ID, avgScore: 3, PK: `REVIEW#${LISTING_ID}`, SK: `REVIEW#${BOOKING_ID}` }] })
      .resolves({ Items: [] });
    const res = await handler(makeEvent({ sections: [{ section: 'LOCATION', score: 5 }, { section: 'CLEANLINESS', score: 5 }] }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    // Verify UpdateCommand was used
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });
});
