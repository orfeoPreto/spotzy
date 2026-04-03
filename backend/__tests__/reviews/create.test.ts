import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/reviews/create/index';
import { mockAuthContext } from '../setup';
import { buildBooking } from '../factories/booking.factory';
import { recalcAverage } from '../../functions/reviews/shared/aggregate';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

const BOOKING_ID = 'booking-review-test';
const SPOTTER_ID = 'spotter-review-1';
const HOST_ID = 'host-review-1';
const LISTING_ID = 'listing-review-1';

const completedAt = new Date(Date.now() - 86400000).toISOString(); // yesterday
const completedBooking = {
  ...buildBooking({ bookingId: BOOKING_ID, spotterId: SPOTTER_ID, hostId: HOST_ID, listingId: LISTING_ID, status: 'COMPLETED' }),
  completedAt,
  PK: `BOOKING#${BOOKING_ID}`, SK: 'METADATA',
};

// Spotter can rate: LOCATION, CLEANLINESS, VALUE, ACCESS
// Host can rate: PUNCTUALITY, VEHICLE_CONDITION, COMMUNICATION

const spotterRatingSections = [
  { section: 'LOCATION', score: 4 },
  { section: 'CLEANLINESS', score: 5 },
];

const hostRatingSections = [
  { section: 'PUNCTUALITY', score: 5 },
];

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: completedBooking });
  ddbMock.on(QueryCommand).resolves({ Items: [] }); // no existing review
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
  ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0 });
});

const makeEvent = (body: object, auth = mockAuthContext(SPOTTER_ID)): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify({ bookingId: BOOKING_ID, ...body }), pathParameters: null, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: '/reviews', multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('recalcAverage helper', () => {
  it('[4,5,3] average = 4.0', () => {
    let avg = recalcAverage(null, 0, 4);
    avg = recalcAverage(avg, 1, 5);
    avg = recalcAverage(avg, 2, 3);
    expect(avg).toBe(4);
  });
  it('0 reviews → first score returned', () => expect(recalcAverage(null, 0, 5)).toBe(5));
  it('adds new review to running average', () => expect(recalcAverage(4.0, 2, 4)).toBe(4));
});

describe('review-create', () => {
  it('spotter rates with valid sections → 201', async () => {
    const res = await handler(makeEvent({ sections: spotterRatingSections }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
  });

  it('host rates with valid sections → 201', async () => {
    const res = await handler(makeEvent({ sections: hostRatingSections }, mockAuthContext(HOST_ID)), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
  });

  it('optional description stored', async () => {
    await handler(makeEvent({ sections: spotterRatingSections, description: 'Great spot!' }), {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.description).toBe('Great spot!');
  });

  it('rating 0 → 400 INVALID_RATING', async () => {
    const res = await handler(makeEvent({ sections: [{ section: 'LOCATION', score: 0 }] }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('INVALID_RATING');
  });

  it('rating 6 → 400', async () => {
    const res = await handler(makeEvent({ sections: [{ section: 'LOCATION', score: 6 }] }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('rating 3.5 (non-integer) → 400', async () => {
    const res = await handler(makeEvent({ sections: [{ section: 'LOCATION', score: 3.5 }] }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('spotter uses host section → 400 INVALID_SECTION_FOR_ROLE', async () => {
    const res = await handler(makeEvent({ sections: [{ section: 'PUNCTUALITY', score: 4 }] }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('INVALID_SECTION_FOR_ROLE');
  });

  it('host uses spotter section → 400', async () => {
    const res = await handler(makeEvent({ sections: [{ section: 'LOCATION', score: 4 }] }, mockAuthContext(HOST_ID)), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('description over 500 chars → 400', async () => {
    const res = await handler(makeEvent({ sections: spotterRatingSections, description: 'x'.repeat(501) }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('booking not COMPLETED → 400 BOOKING_NOT_COMPLETED', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...completedBooking, status: 'CONFIRMED' } });
    const res = await handler(makeEvent({ sections: spotterRatingSections }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('BOOKING_NOT_COMPLETED');
  });

  it('review already submitted → 409 ALREADY_REVIEWED', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ reviewId: 'existing' }] });
    const res = await handler(makeEvent({ sections: spotterRatingSections }), {} as any, () => {});
    expect(res!.statusCode).toBe(409);
    expect(res!.body).toContain('ALREADY_REVIEWED');
  });

  it('submitted > 7 days after completedAt → 400 REVIEW_WINDOW_EXPIRED', async () => {
    const oldCompleted = new Date(Date.now() - 8 * 86400000).toISOString();
    ddbMock.on(GetCommand).resolves({ Item: { ...completedBooking, completedAt: oldCompleted } });
    const res = await handler(makeEvent({ sections: spotterRatingSections }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('REVIEW_WINDOW_EXPIRED');
  });

  it('both parties reviewed → published=true on submitted review', async () => {
    // Simulate the OTHER party already reviewed (query returns 1 existing review)
    // First QueryCommand (checking if current user already reviewed) → empty
    // Second QueryCommand (checking if other party reviewed) → has other party's review
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: [] })
      .resolves({ Items: [{ reviewId: 'other-review', authorId: HOST_ID }] });
    ddbMock.on(GetCommand).resolves({ Item: completedBooking });
    await handler(makeEvent({ sections: spotterRatingSections }), {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.published).toBe(true);
  });

  it('only one party reviewed → published=false', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] }); // no other review yet
    await handler(makeEvent({ sections: spotterRatingSections }), {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.published).toBe(false);
  });
});
