import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/preferences/learn/index';
import { generateSuggestions } from '../../functions/preferences/shared/suggestions';

const ddbMock = mockClient(DynamoDBDocumentClient);

const makeEvent = (detailType: string, detail: object): EventBridgeEvent<string, object> =>
  ({ 'detail-type': detailType, detail, source: 'spotzy', id: 'test', version: '0', account: '123', time: '', region: 'us-east-1', resources: [], 'replay-name': '' } as unknown as EventBridgeEvent<string, object>);

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: undefined }); // no existing prefs
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
});

describe('preference-learn — booking.completed', () => {
  const baseDetail = {
    spotterId: 'spotter-1',
    listingGeohash: '9q8yy',
    spotType: 'COVERED_GARAGE',
    isCovered: true,
    totalPrice: 7.00,
  };

  it('first booking → creates PREFS record with initial counts', async () => {
    await handler(makeEvent('booking.completed', baseDetail), {} as any, () => {});
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.totalBookings).toBe(1);
  });

  it('second booking → increments existing counts', async () => {
    const existingPrefs = {
      PK: 'USER#spotter-1', SK: 'PREFS',
      totalBookings: 1,
      coveredCount: 1,
      destinationHistory: { '9q8yy': 1 },
      spotTypeHistory: { COVERED_GARAGE: 1 },
      priceHistory: [7.00],
    };
    ddbMock.on(GetCommand).resolves({ Item: existingPrefs });
    await handler(makeEvent('booking.completed', baseDetail), {} as any, () => {});
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    expect(Object.values(vals)).toContain(2); // totalBookings=2
  });

  it('same geohash twice → destinationHistory count = 2', async () => {
    const existingPrefs = {
      PK: 'USER#spotter-1', SK: 'PREFS',
      totalBookings: 1, coveredCount: 0,
      destinationHistory: { '9q8yy': 1 },
      spotTypeHistory: {}, priceHistory: [],
    };
    ddbMock.on(GetCommand).resolves({ Item: existingPrefs });
    await handler(makeEvent('booking.completed', { ...baseDetail, isCovered: false }), {} as any, () => {});
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    // destinationHistory['9q8yy'] should be 2
    const destHistory = Object.values(vals).find(v => typeof v === 'object' && v !== null && '9q8yy' in (v as object)) as Record<string, number> | undefined;
    expect(destHistory?.['9q8yy']).toBe(2);
  });

  it('coveredCount incremented when isCovered=true', async () => {
    await handler(makeEvent('booking.completed', baseDetail), {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.coveredCount).toBe(1);
  });

  it('totalBookings incremented by 1', async () => {
    await handler(makeEvent('booking.completed', baseDetail), {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.totalBookings).toBe(1);
  });
});

describe('preference-learn — search.performed', () => {
  it('adds searchHistory entry for geohash', async () => {
    await handler(makeEvent('search.performed', { spotterId: 'spotter-1', geohash: 'abc12', filters: { spotType: 'COVERED_GARAGE' } }), {} as any, () => {});
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.searchHistory).toBeDefined();
  });

  it('same geohash searched 3 times → count = 3', async () => {
    const existingPrefs = {
      PK: 'USER#spotter-1', SK: 'PREFS',
      totalBookings: 0, coveredCount: 0,
      destinationHistory: {}, spotTypeHistory: {}, priceHistory: [],
      searchHistory: { abc12: 2 },
      filterHistory: {},
    };
    ddbMock.on(GetCommand).resolves({ Item: existingPrefs });
    await handler(makeEvent('search.performed', { spotterId: 'spotter-1', geohash: 'abc12', filters: {} }), {} as any, () => {});
    const vals = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    const searchHistory = Object.values(vals).find(v => typeof v === 'object' && v !== null && 'abc12' in (v as object)) as Record<string, number> | undefined;
    expect(searchHistory?.['abc12']).toBe(3);
  });

  it('filterHistory tracks filters used', async () => {
    await handler(makeEvent('search.performed', { spotterId: 'spotter-1', geohash: 'abc12', filters: { spotType: 'COVERED_GARAGE', maxPricePerHour: '5' } }), {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.filterHistory).toBeDefined();
  });
});

describe('generateSuggestions', () => {
  it('4/5 covered → prefersCovered=true', () => {
    const result = generateSuggestions({ totalBookings: 5, coveredCount: 4 });
    expect(result.prefersCovered).toBe(true);
  });

  it('1/2 covered → prefersCovered=false', () => {
    const result = generateSuggestions({ totalBookings: 2, coveredCount: 1 });
    expect(result.prefersCovered).toBe(false);
  });

  it('prices [3,5,7,4] → suggestedMaxPrice = avg(4.75) * 1.2 = 5.70', () => {
    const result = generateSuggestions({ priceHistory: [3, 5, 7, 4] });
    expect(result.suggestedMaxPrice).toBe(5.70);
  });

  it('top 3 destinations by count', () => {
    const result = generateSuggestions({ destinationHistory: { a: 5, b: 3, c: 7, d: 1 } });
    expect(result.topDestinations).toEqual(['c', 'a', 'b']);
  });
});
