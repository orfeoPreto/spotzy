import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/notifications/sms/index';

const ddbMock = mockClient(DynamoDBDocumentClient);
const snsMock = mockClient(SNSClient);

const HOST_ID = 'host-notif-1';
const SPOTTER_ID = 'spotter-notif-1';

const hostUser = { userId: HOST_ID, phone: '+32471000001', name: 'Host Name', PK: `USER#${HOST_ID}`, SK: 'PROFILE' };
const spotterUser = { userId: SPOTTER_ID, phone: '+32471000002', name: 'Spotter Name', PK: `USER#${SPOTTER_ID}`, SK: 'PROFILE' };

const makeEvent = (detailType: string, detail: Record<string, unknown>): EventBridgeEvent<string, Record<string, unknown>> =>
  ({ 'detail-type': detailType, detail, source: 'spotzy', id: 'test', version: '0', account: '123', time: '', region: 'us-east-1', resources: [], 'replay-name': '' } as unknown as EventBridgeEvent<string, Record<string, unknown>>);

beforeEach(() => {
  ddbMock.reset();
  snsMock.reset();
  snsMock.on(PublishCommand).resolves({ MessageId: 'sms-1' });
  ddbMock.on(GetCommand)
    .resolvesOnce({ Item: hostUser })
    .resolvesOnce({ Item: spotterUser });
});

describe('notify-sms', () => {
  it('booking.created → SMS to host, includes address and amount', async () => {
    await handler(makeEvent('booking.created', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123 Main St', startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T12:00:00Z', totalPrice: 7.00 }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
    const msg = snsMock.commandCalls(PublishCommand)[0].args[0].input.Message!;
    expect(msg).toContain('123 Main St');
    expect(msg).toContain('7');
    expect(msg.length).toBeLessThanOrEqual(160);
  });

  it('booking.cancelled → SMS to BOTH host AND spotter', async () => {
    await handler(makeEvent('booking.cancelled', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123 Main St', startTime: '2025-06-01T10:00:00Z', refundAmount: 5.00 }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2);
  });

  it('booking.modified → SMS to host only', async () => {
    await handler(makeEvent('booking.modified', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123 Main St', newStartTime: '2025-06-02T10:00:00Z' }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
    const phone = snsMock.commandCalls(PublishCommand)[0].args[0].input.PhoneNumber;
    expect(phone).toBe(hostUser.phone);
  });

  it('dispute.created → SMS to host with 24h deadline', async () => {
    await handler(makeEvent('dispute.created', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123 Main St', reason: 'scratched car' }), {} as any, () => {});
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
    const msg = snsMock.commandCalls(PublishCommand)[0].args[0].input.Message!;
    expect(msg).toContain('24');
  });

  it('user has no phone → no SMS, no throw', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...hostUser, phone: undefined } });
    await expect(handler(makeEvent('booking.created', { hostId: HOST_ID, spotterId: SPOTTER_ID, listingAddress: '123', startTime: '2025-06-01T10:00:00Z', endTime: '2025-06-01T12:00:00Z', totalPrice: 7.00 }), {} as any, () => {})).resolves.not.toThrow();
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });
});
