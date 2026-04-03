import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/notifications/sms/index';

const ddbMock = mockClient(DynamoDBDocumentClient);
const snsMock = mockClient(SNSClient);

const HOST_ID = 'host-notif-1';
const SPOTTER_ID = 'spotter-notif-1';
const LISTING_ID = 'listing-notif-1';
const BOOKING_ID = 'booking-notif-1';
const REVIEW_ID = 'review-notif-1';

const hostUser = { userId: HOST_ID, phone: '+32471000001', name: 'Host Name', PK: `USER#${HOST_ID}`, SK: 'PROFILE' };
const spotterUser = { userId: SPOTTER_ID, phone: '+32471000002', name: 'Spotter Name', PK: `USER#${SPOTTER_ID}`, SK: 'PROFILE' };

const makeEvent = (detailType: string, detail: Record<string, unknown>): EventBridgeEvent<string, Record<string, unknown>> =>
  ({ 'detail-type': detailType, detail, source: 'spotzy', id: 'test', version: '0', account: '123', time: '', region: 'us-east-1', resources: [], 'replay-name': '' } as unknown as EventBridgeEvent<string, Record<string, unknown>>);

beforeEach(() => {
  ddbMock.reset();
  snsMock.reset();
  snsMock.on(PublishCommand).resolves({ MessageId: 'sms-1' });
  ddbMock.on(GetCommand).callsFake((input) => {
    if (input.Key?.PK === `USER#${HOST_ID}`) return { Item: hostUser };
    if (input.Key?.PK === `USER#${SPOTTER_ID}`) return { Item: spotterUser };
    return { Item: undefined };
  });
});

describe('notify-sms', () => {
  it('booking.confirmed → SMS to BOTH host and spotter, includes address and amount', async () => {
    await handler(makeEvent('booking.confirmed', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123 Main St', startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T12:00:00Z', totalPrice: 7.00 }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2);
    const msg = snsMock.commandCalls(PublishCommand)[0].args[0].input.Message!;
    expect(msg).toContain('123 Main St');
    expect(msg).toContain('7');
    expect(msg.length).toBeLessThanOrEqual(160);
  });

  it('booking.confirmed → SMS to spotter with confirmation', async () => {
    await handler(makeEvent('booking.confirmed', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '456 Oak Ave', startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T12:00:00Z', totalPrice: 14.00 }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2); // both host and spotter
    const inputs = snsMock.commandCalls(PublishCommand).map(c => c.args[0].input);
    const spotterSms = inputs.find(i => i.PhoneNumber === spotterUser.phone);
    expect(spotterSms).toBeDefined();
    expect(spotterSms!.Message).toContain('confirmed');
  });

  it('booking.modified → SMS to BOTH parties', async () => {
    await handler(makeEvent('booking.modified', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123 Main St', newStartTime: '2025-06-02T10:00:00Z' }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2);
  });

  it('booking.cancelled → SMS to BOTH host AND spotter', async () => {
    await handler(makeEvent('booking.cancelled', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123 Main St', startTime: '2025-06-01T10:00:00Z', refundAmount: 5.00 }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2);
  });

  it('booking.completed → SMS to BOTH parties with review prompt', async () => {
    await handler(makeEvent('booking.completed', { hostId: HOST_ID, spotterId: SPOTTER_ID, bookingId: BOOKING_ID, listingAddress: '123 Main St' }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2);
    const msg = snsMock.commandCalls(PublishCommand)[0].args[0].input.Message!;
    expect(msg.toLowerCase()).toContain('completed');
    expect(msg.toLowerCase()).toContain('review');
  });

  it('listing.published → SMS to host', async () => {
    await handler(makeEvent('listing.published', { hostId: HOST_ID, listingId: LISTING_ID, listingAddress: '789 Park Blvd' }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
    const input = snsMock.commandCalls(PublishCommand)[0].args[0].input;
    expect(input.PhoneNumber).toBe(hostUser.phone);
    expect(input.Message).toContain('789 Park Blvd');
    expect(input.Message!.toLowerCase()).toContain('live');
  });

  it('review.created → SMS to reviewed user with score', async () => {
    await handler(makeEvent('review.created', { reviewId: REVIEW_ID, bookingId: BOOKING_ID, authorId: SPOTTER_ID, reviewedUserId: HOST_ID, listingId: LISTING_ID, listingAddress: '123 Main St', avgScore: 4.5 }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
    const input = snsMock.commandCalls(PublishCommand)[0].args[0].input;
    expect(input.PhoneNumber).toBe(hostUser.phone);
    expect(input.Message).toContain('4.5');
  });

  it('dispute.created → SMS to host with 24h deadline', async () => {
    await handler(makeEvent('dispute.created', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123 Main St', reason: 'scratched car' }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
    const msg = snsMock.commandCalls(PublishCommand)[0].args[0].input.Message!;
    expect(msg).toContain('24');
  });

  it('dispute.escalated → SMS to BOTH parties', async () => {
    await handler(makeEvent('dispute.escalated', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123 Main St' }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2);
  });

  it('all SMS messages ≤ 160 chars', async () => {
    const longAddress = 'A'.repeat(120);
    await handler(makeEvent('booking.confirmed', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: longAddress, startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T12:00:00Z', totalPrice: 7.00 }), {} as any, () => {});
    const msg = snsMock.commandCalls(PublishCommand)[0].args[0].input.Message!;
    expect(msg.length).toBeLessThanOrEqual(160);
  });

  it('user has no phone → no SMS, no throw', async () => {
    ddbMock.on(GetCommand).callsFake(() => ({ Item: { ...hostUser, phone: undefined } }));
    await expect(handler(makeEvent('booking.confirmed', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123', startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T12:00:00Z', totalPrice: 7.00 }), {} as any, () => {})).resolves.not.toThrow();
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });
});
