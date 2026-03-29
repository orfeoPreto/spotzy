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

const hostUser = { userId: HOST_ID, email: 'host@test.com', name: 'Host Name', PK: `USER#${HOST_ID}`, SK: 'PROFILE' };
const spotterUser = { userId: SPOTTER_ID, email: 'spotter@test.com', name: 'Spotter Name', PK: `USER#${SPOTTER_ID}`, SK: 'PROFILE' };

const makeEvent = (detailType: string, detail: Record<string, unknown>): EventBridgeEvent<string, Record<string, unknown>> =>
  ({ 'detail-type': detailType, detail, source: 'spotzy', id: 'test', version: '0', account: '123', time: '', region: 'us-east-1', resources: [], 'replay-name': '' } as unknown as EventBridgeEvent<string, Record<string, unknown>>);

beforeEach(() => {
  ddbMock.reset();
  sesMock.reset();
  sesMock.on(SendEmailCommand).resolves({ MessageId: 'email-1' });
  ddbMock.on(GetCommand)
    .resolvesOnce({ Item: hostUser })
    .resolvesOnce({ Item: spotterUser });
});

describe('notify-email', () => {
  it('booking.created → email to host, subject contains address, HTML body with booking summary', async () => {
    await handler(makeEvent('booking.created', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123 Main St', bookingId: BOOKING_ID, startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T12:00:00Z', totalPrice: 7.00 }), {} as any, () => {});
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.Message!.Subject!.Data).toContain('123 Main St');
    expect(input.Destination!.ToAddresses).toContain(hostUser.email);
    expect(input.Message!.Body!.Html!.Data).toContain('<');
  });

  it('Source is noreply@spotzy.com', async () => {
    await handler(makeEvent('booking.created', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123', bookingId: BOOKING_ID, startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T12:00:00Z', totalPrice: 7.00 }), {} as any, () => {});
    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.Source).toBe('noreply@spotzy.com');
  });

  it('booking.completed → email to BOTH parties with review link', async () => {
    await handler(makeEvent('booking.completed', { hostId: HOST_ID, spotterId: SPOTTER_ID, bookingId: BOOKING_ID, listingAddress: '123 Main St' }), {} as any, () => {});
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(2);
    const bodies = sesMock.commandCalls(SendEmailCommand).map(c => c.args[0].input.Message!.Body!.Html!.Data ?? '');
    expect(bodies.some(b => b.includes(`/review/${BOOKING_ID}`))).toBe(true);
  });

  it('booking.cancelled → subject contains "cancelled", body shows refund amount', async () => {
    await handler(makeEvent('booking.cancelled', { hostId: HOST_ID, spotterId: SPOTTER_ID, bookingId: BOOKING_ID, listingAddress: '123 Main St', refundAmount: 5.00 }), {} as any, () => {});
    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.Message!.Subject!.Data!.toLowerCase()).toContain('cancel');
    expect(input.Message!.Body!.Html!.Data).toContain('5');
  });

  it('user has no email → no send, no throw', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...hostUser, email: undefined } });
    await expect(handler(makeEvent('booking.created', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123', bookingId: BOOKING_ID, startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T12:00:00Z', totalPrice: 7.00 }), {} as any, () => {})).resolves.not.toThrow();
    expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
});
