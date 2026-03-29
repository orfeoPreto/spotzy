import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/availability/block/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const makeEvent = (detailType: string, detail: object): any =>
  ({ 'detail-type': detailType, detail, source: 'spotzy', id: 'test', version: '0', account: '123', time: '', region: 'us-east-1', resources: [], 'replay-name': '' });

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});
  ddbMock.on(QueryCommand).resolves({ Items: [] });
});

describe('availability-block', () => {
  it('3-day booking.created → 3 DynamoDB records written', async () => {
    const start = '2025-06-01T10:00:00.000Z';
    const end = '2025-06-04T10:00:00.000Z'; // 3 days
    await handler(makeEvent('booking.created', { bookingId: 'b1', listingId: 'l1', startTime: start, endTime: end }), {} as any, () => {});
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(3);
  });

  it('single-day booking → 1 record written', async () => {
    const start = '2025-06-01T10:00:00.000Z';
    const end = '2025-06-01T18:00:00.000Z';
    await handler(makeEvent('booking.created', { bookingId: 'b2', listingId: 'l1', startTime: start, endTime: end }), {} as any, () => {});
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });

  it('records use correct PK/SK pattern: LISTING#{listingId} / AVAIL#{date}#{bookingId}', async () => {
    const start = '2025-06-01T10:00:00.000Z';
    const end = '2025-06-01T18:00:00.000Z';
    await handler(makeEvent('booking.created', { bookingId: 'b3', listingId: 'l1', startTime: start, endTime: end }), {} as any, () => {});
    const put = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(put.PK).toBe('LISTING#l1');
    expect(put.SK).toMatch(/^AVAIL#2025-06-01#b3/);
  });

  it('booking crossing month boundary → records written for each day', async () => {
    const start = '2025-01-30T10:00:00.000Z';
    const end = '2025-02-02T10:00:00.000Z'; // crosses Jan/Feb boundary: 30, 31 Jan + 1 Feb = 3 days
    await handler(makeEvent('booking.created', { bookingId: 'b4', listingId: 'l1', startTime: start, endTime: end }), {} as any, () => {});
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(3);
  });
});
