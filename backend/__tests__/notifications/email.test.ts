import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/notifications/email/index';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sesMock = mockClient(SESClient);

const HOST_ID = 'host-email-1';
const SPOTTER_ID = 'spotter-email-1';
const BOOKING_ID = 'booking-email-1';
const LISTING_ID = 'listing-email-1';
const REVIEW_ID = 'review-email-1';

const hostUser = { userId: HOST_ID, email: 'host@test.com', name: 'Host Name', PK: `USER#${HOST_ID}`, SK: 'PROFILE' };
const spotterUser = { userId: SPOTTER_ID, email: 'spotter@test.com', name: 'Spotter Name', PK: `USER#${SPOTTER_ID}`, SK: 'PROFILE' };

const makeEvent = (detailType: string, detail: Record<string, unknown>): EventBridgeEvent<string, Record<string, unknown>> =>
  ({ 'detail-type': detailType, detail, source: 'spotzy', id: 'test', version: '0', account: '123', time: '', region: 'us-east-1', resources: [], 'replay-name': '' } as unknown as EventBridgeEvent<string, Record<string, unknown>>);

beforeEach(() => {
  ddbMock.reset();
  sesMock.reset();
  sesMock.on(SendEmailCommand).resolves({ MessageId: 'email-1' });
  ddbMock.on(GetCommand).callsFake((input) => {
    if (input.Key?.PK === `USER#${HOST_ID}`) return { Item: hostUser };
    if (input.Key?.PK === `USER#${SPOTTER_ID}`) return { Item: spotterUser };
    return { Item: undefined };
  });
});

describe('notify-email', () => {
  it('booking.confirmed → email to BOTH host and spotter with address and booking summary', async () => {
    await handler(makeEvent('booking.confirmed', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123 Main St', bookingId: BOOKING_ID, startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T12:00:00Z', totalPrice: 7.00 }), {} as any, () => {});
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2);
    const inputs = sesMock.commandCalls(SendEmailCommand).map(c => c.args[0].input);
    const toAddresses = inputs.flatMap(i => i.Destination!.ToAddresses!);
    expect(toAddresses).toContain(hostUser.email);
    expect(toAddresses).toContain(spotterUser.email);
    expect(inputs[0].Message!.Body!.Html!.Data).toContain('123 Main St');
  });

  it('booking.modified → email to BOTH parties', async () => {
    await handler(makeEvent('booking.modified', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123 Main St', bookingId: BOOKING_ID, newStartTime: '2025-06-02T10:00:00Z', newEndTime: '2025-06-02T14:00:00Z', priceDifference: 7.00 }), {} as any, () => {});
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2);
    const subjects = sesMock.commandCalls(SendEmailCommand).map(c => c.args[0].input.Message!.Subject!.Data ?? '');
    expect(subjects.every(s => s.toLowerCase().includes('modified'))).toBe(true);
  });

  it('booking.cancelled → email to BOTH parties with refund amount', async () => {
    await handler(makeEvent('booking.cancelled', { hostId: HOST_ID, spotterId: SPOTTER_ID, bookingId: BOOKING_ID, listingAddress: '123 Main St', refundAmount: 5.00 }), {} as any, () => {});
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2);
    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.Message!.Subject!.Data!.toLowerCase()).toContain('cancel');
    expect(input.Message!.Body!.Html!.Data).toContain('5');
  });

  it('booking.completed → email to BOTH parties with review link', async () => {
    await handler(makeEvent('booking.completed', { hostId: HOST_ID, spotterId: SPOTTER_ID, bookingId: BOOKING_ID, listingAddress: '123 Main St' }), {} as any, () => {});
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2);
    const bodies = sesMock.commandCalls(SendEmailCommand).map(c => c.args[0].input.Message!.Body!.Html!.Data ?? '');
    expect(bodies.some(b => b.includes(`/review/${BOOKING_ID}`))).toBe(true);
  });

  it('listing.published → email to host with listing link', async () => {
    await handler(makeEvent('listing.published', { hostId: HOST_ID, listingId: LISTING_ID, listingAddress: '789 Park Blvd' }), {} as any, () => {});
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.Message!.Subject!.Data!.toLowerCase()).toContain('live');
    expect(input.Message!.Body!.Html!.Data).toContain(`/listings/${LISTING_ID}`);
    expect(input.Destination!.ToAddresses).toContain(hostUser.email);
  });

  it('review.created → email to reviewed user with score', async () => {
    await handler(makeEvent('review.created', { reviewId: REVIEW_ID, bookingId: BOOKING_ID, authorId: SPOTTER_ID, reviewedUserId: HOST_ID, listingId: LISTING_ID, listingAddress: '123 Main St', avgScore: 4.5 }), {} as any, () => {});
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.Message!.Body!.Html!.Data).toContain('4.5');
    expect(input.Destination!.ToAddresses).toContain(hostUser.email);
  });

  it('Source is noreply@spotzy.com', async () => {
    await handler(makeEvent('booking.confirmed', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123', bookingId: BOOKING_ID, startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T12:00:00Z', totalPrice: 7.00 }), {} as any, () => {});
    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.Source).toBe('noreply@spotzy.com');
  });

  it('user has no email → no send, no throw', async () => {
    ddbMock.on(GetCommand).callsFake(() => ({ Item: { ...hostUser, email: undefined } }));
    await expect(handler(makeEvent('booking.confirmed', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123', bookingId: BOOKING_ID, startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T12:00:00Z', totalPrice: 7.00 }), {} as any, () => {})).resolves.not.toThrow();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
});
