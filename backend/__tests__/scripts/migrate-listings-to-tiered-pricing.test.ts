import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { migrateListings } from '../../scripts/migrate-listings-to-tiered-pricing';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('migrate-listings-to-tiered-pricing', () => {
  test('converts listing with hourly+daily to new model with snapped 0.60 discount', async () => {
    // pricePerHour=2, pricePerDay=28.80 -> derived dailyDiscountPct = 28.80/(2*24) = 0.60 (exact match)
    ddbMock.on(ScanCommand).resolves({
      Items: [{
        PK: 'LISTING#l1',
        SK: 'METADATA',
        pricePerHour: 2,
        pricePerDay: 28.80,
      }],
    });
    ddbMock.on(UpdateCommand).resolves({});

    const result = await migrateListings(ddbMock as unknown as DynamoDBDocumentClient, 'spotzy-main', false);
    expect(result.migrated).toBe(1);
    expect(result.warnings).toBe(0);
    expect(result.records[0].newPricePerHourEur).toBe(2);
    expect(result.records[0].newDailyDiscountPct).toBe(0.60);
    expect(result.records[0].newWeeklyDiscountPct).toBe(0.60);
    expect(result.records[0].newMonthlyDiscountPct).toBe(0.60);
  });

  test('snaps 0.58 to 0.60', async () => {
    // pricePerHour=2, pricePerDay=27.84 -> derived 27.84/(2*24) = 0.58 -> snap to 0.60 (closest allowed)
    ddbMock.on(ScanCommand).resolves({
      Items: [{
        PK: 'LISTING#l2',
        SK: 'METADATA',
        pricePerHour: 2,
        pricePerDay: 27.84,
      }],
    });
    ddbMock.on(UpdateCommand).resolves({});

    const result = await migrateListings(ddbMock as unknown as DynamoDBDocumentClient, 'spotzy-main', false);
    expect(result.records[0].newDailyDiscountPct).toBe(0.60);
    expect(result.warnings).toBe(0);
  });

  test('warns and defaults to 0.60 when discount is outside [0.45, 0.75]', async () => {
    // pricePerHour=2, pricePerDay=14.40 -> derived 14.40/(2*24) = 0.30 -> outside range, default 0.60, log warning
    ddbMock.on(ScanCommand).resolves({
      Items: [{
        PK: 'LISTING#l3',
        SK: 'METADATA',
        pricePerHour: 2,
        pricePerDay: 14.40,
      }],
    });
    ddbMock.on(UpdateCommand).resolves({});

    const result = await migrateListings(ddbMock as unknown as DynamoDBDocumentClient, 'spotzy-main', false);
    expect(result.records[0].newDailyDiscountPct).toBe(0.60);
    expect(result.warnings).toBe(1);
    expect(result.records[0].warning).toContain('outside [0.45, 0.75]');
  });

  test('removes legacy fields after migration', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [{
        PK: 'LISTING#l4',
        SK: 'METADATA',
        pricePerHour: 5,
        pricePerDay: 60,
        pricePerMonth: 500,
      }],
    });
    ddbMock.on(UpdateCommand).resolves({});

    await migrateListings(ddbMock as unknown as DynamoDBDocumentClient, 'spotzy-main', false);

    // Verify the UpdateCommand was called with REMOVE for legacy fields
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(1);
    const updateInput = updateCalls[0].args[0].input;
    expect(updateInput.UpdateExpression).toContain('REMOVE pricePerHour, pricePerDay, pricePerMonth');
    expect(updateInput.UpdateExpression).toContain('SET pricePerHourEur');
  });

  test('idempotent - running twice on the same listing is a no-op the second time', async () => {
    // First scan returns a legacy listing
    ddbMock.on(ScanCommand).resolvesOnce({
      Items: [{
        PK: 'LISTING#l5',
        SK: 'METADATA',
        pricePerHour: 3,
        pricePerDay: 43.20,
      }],
    });
    ddbMock.on(UpdateCommand).resolves({});

    const first = await migrateListings(ddbMock as unknown as DynamoDBDocumentClient, 'spotzy-main', false);
    expect(first.migrated).toBe(1);

    // Second scan returns no results (already migrated, filter expression excludes it)
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    const second = await migrateListings(ddbMock as unknown as DynamoDBDocumentClient, 'spotzy-main', false);
    expect(second.migrated).toBe(0);
  });
});
