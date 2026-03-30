import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/bookings/status-transition/index';
import { buildBooking } from '../factories/booking.factory';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  ddbMock.on(UpdateCommand).resolves({});
  ebMock.on(PutEventsCommand).resolves({});
});

describe('booking-status-transition', () => {
  it('transitions CONFIRMED → ACTIVE', async () => {
    const booking = { ...buildBooking({ status: 'CONFIRMED' }), PK: 'BOOKING#b1', SK: 'METADATA' };
    ddbMock.on(GetCommand).resolves({ Item: booking });

    const result = await handler({ bookingId: booking.bookingId, targetStatus: 'ACTIVE' }, {} as any, () => {});
    expect(result).toEqual({ statusCode: 200 });
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input.ExpressionAttributeValues).toEqual(
      expect.objectContaining({ ':s': 'ACTIVE' })
    );
  });

  it('transitions ACTIVE → COMPLETED and emits booking.completed', async () => {
    const booking = { ...buildBooking({ status: 'ACTIVE' }), PK: 'BOOKING#b1', SK: 'METADATA' };
    ddbMock.on(GetCommand).resolves({ Item: booking });

    await handler({ bookingId: booking.bookingId, targetStatus: 'COMPLETED' }, {} as any, () => {});
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    const ebCalls = ebMock.commandCalls(PutEventsCommand);
    expect(ebCalls).toHaveLength(1);
    expect(ebCalls[0].args[0].input.Entries?.[0]?.DetailType).toBe('booking.completed');
  });

  it('idempotent — already at target status returns 200 without update', async () => {
    const booking = { ...buildBooking({ status: 'ACTIVE' }), PK: 'BOOKING#b1', SK: 'METADATA' };
    ddbMock.on(GetCommand).resolves({ Item: booking });

    const result = await handler({ bookingId: booking.bookingId, targetStatus: 'ACTIVE' }, {} as any, () => {});
    expect(result).toEqual({ statusCode: 200 });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('invalid transition returns 409', async () => {
    const booking = { ...buildBooking({ status: 'CANCELLED' }), PK: 'BOOKING#b1', SK: 'METADATA' };
    ddbMock.on(GetCommand).resolves({ Item: booking });

    const result = await handler({ bookingId: booking.bookingId, targetStatus: 'ACTIVE' }, {} as any, () => {});
    expect(result).toEqual({ statusCode: 409 });
  });

  it('booking not found returns 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const result = await handler({ bookingId: 'nonexistent', targetStatus: 'ACTIVE' }, {} as any, () => {});
    expect(result).toEqual({ statusCode: 404 });
  });
});
