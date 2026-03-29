import { DynamoDBDocumentClient, DeleteCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/availability/release/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const makeEvent = (detailType: string, detail: object): any =>
  ({ 'detail-type': detailType, detail, source: 'spotzy', id: 'test', version: '0', account: '123', time: '', region: 'us-east-1', resources: [], 'replay-name': '' });

beforeEach(() => {
  ddbMock.reset();
  // QueryCommand returns existing availability records for the booking
  ddbMock.on(QueryCommand).resolves({ Items: [
    { PK: 'LISTING#l1', SK: 'AVAIL#2025-06-01#b1' },
    { PK: 'LISTING#l1', SK: 'AVAIL#2025-06-02#b1' },
  ] });
  ddbMock.on(DeleteCommand).resolves({});
  ddbMock.on(PutCommand).resolves({});
});

describe('availability-release', () => {
  it('booking.cancelled → deletes all availability records for that booking', async () => {
    const start = '2025-06-01T10:00:00.000Z';
    const end = '2025-06-03T10:00:00.000Z';
    await handler(makeEvent('booking.cancelled', { bookingId: 'b1', listingId: 'l1', startTime: start, endTime: end }), {} as any, () => {});
    expect(ddbMock.commandCalls(DeleteCommand).length).toBeGreaterThanOrEqual(1);
  });

  it('release called twice → second call is no-op (records already gone)', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] }); // already deleted
    const start = '2025-06-01T10:00:00.000Z';
    const end = '2025-06-03T10:00:00.000Z';
    await handler(makeEvent('booking.cancelled', { bookingId: 'b1', listingId: 'l1', startTime: start, endTime: end }), {} as any, () => {});
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });
});
