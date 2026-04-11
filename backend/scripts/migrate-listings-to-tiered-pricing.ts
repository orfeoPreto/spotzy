/**
 * ONE-TIME migration script: converts existing listings from legacy flat-rate pricing
 * (pricePerHour / pricePerDay / pricePerMonth) to tiered pricing model
 * (pricePerHourEur + three discount percentages).
 *
 * Usage:
 *   ts-node backend/scripts/migrate-listings-to-tiered-pricing.ts --env=staging --dry-run
 *   ts-node backend/scripts/migrate-listings-to-tiered-pricing.ts --env=staging
 *   ts-node backend/scripts/migrate-listings-to-tiered-pricing.ts --env=prod
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import * as fs from 'fs';

const ALLOWED_DISCOUNTS = [0.50, 0.60, 0.70] as const;
const DEFAULT_DISCOUNT = 0.60;

interface MigrationRecord {
  listingId: string;
  oldPricePerHour: number;
  oldPricePerDay: number | null;
  oldPricePerMonth: number | null;
  newPricePerHourEur: number;
  newDailyDiscountPct: number;
  newWeeklyDiscountPct: number;
  newMonthlyDiscountPct: number;
  warning: string | null;
}

function snapToAllowed(computed: number): { value: number; warning: string | null } {
  if (computed < 0.45 || computed > 0.75) {
    return { value: DEFAULT_DISCOUNT, warning: `Computed discount ${computed.toFixed(4)} outside [0.45, 0.75], defaulting to ${DEFAULT_DISCOUNT}` };
  }

  // Find the closest allowed value
  let closest: number = ALLOWED_DISCOUNTS[0];
  let minDist = Math.abs(computed - closest);
  for (const v of ALLOWED_DISCOUNTS) {
    const dist = Math.abs(computed - v);
    if (dist < minDist) {
      minDist = dist;
      closest = v;
    }
  }
  return { value: closest, warning: null };
}

export async function migrateListings(
  client: DynamoDBDocumentClient,
  tableName: string,
  dryRun: boolean
): Promise<{ migrated: number; warnings: number; errors: number; records: MigrationRecord[] }> {
  const records: MigrationRecord[] = [];
  let migrated = 0;
  let warnings = 0;
  let errors = 0;

  // Scan for all LISTING# METADATA rows
  let lastKey: Record<string, unknown> | undefined;

  do {
    const scanResult = await client.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :pk) AND SK = :sk AND attribute_exists(pricePerHour) AND attribute_not_exists(pricePerHourEur)',
      ExpressionAttributeValues: {
        ':pk': 'LISTING#',
        ':sk': 'METADATA',
      },
      ExclusiveStartKey: lastKey,
    }));

    for (const item of scanResult.Items ?? []) {
      const listingId = (item.PK as string).replace('LISTING#', '');
      const oldHourly = item.pricePerHour as number;
      const oldDaily = (item.pricePerDay as number) ?? null;
      const oldMonthly = (item.pricePerMonth as number) ?? null;

      // Derive daily discount
      let dailySnap = { value: DEFAULT_DISCOUNT, warning: null as string | null };
      if (oldDaily !== null && oldHourly > 0) {
        const computed = oldDaily / (oldHourly * 24);
        dailySnap = snapToAllowed(computed);
      }

      // Weekly and monthly default to 0.60 (legacy model had no weekly/monthly derivation chain)
      const weeklyDiscount = DEFAULT_DISCOUNT;
      const monthlyDiscount = DEFAULT_DISCOUNT;

      const warning = dailySnap.warning;
      if (warning) warnings++;

      const record: MigrationRecord = {
        listingId,
        oldPricePerHour: oldHourly,
        oldPricePerDay: oldDaily,
        oldPricePerMonth: oldMonthly,
        newPricePerHourEur: oldHourly,
        newDailyDiscountPct: dailySnap.value,
        newWeeklyDiscountPct: weeklyDiscount,
        newMonthlyDiscountPct: monthlyDiscount,
        warning,
      };
      records.push(record);

      if (!dryRun) {
        try {
          await client.send(new UpdateCommand({
            TableName: tableName,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'SET pricePerHourEur = :hourEur, dailyDiscountPct = :daily, weeklyDiscountPct = :weekly, monthlyDiscountPct = :monthly REMOVE pricePerHour, pricePerDay, pricePerMonth',
            ExpressionAttributeValues: {
              ':hourEur': oldHourly,
              ':daily': dailySnap.value,
              ':weekly': weeklyDiscount,
              ':monthly': monthlyDiscount,
            },
          }));
          migrated++;
        } catch (err) {
          errors++;
          console.error(`Failed to migrate listing ${listingId}:`, err);
        }
      } else {
        migrated++;
      }
    }

    lastKey = scanResult.LastEvaluatedKey;
  } while (lastKey);

  return { migrated, warnings, errors, records };
}

function writeCsvReport(records: MigrationRecord[], outputPath: string): void {
  const header = 'listingId,oldPricePerHour,oldPricePerDay,oldPricePerMonth,newPricePerHourEur,newDailyDiscountPct,newWeeklyDiscountPct,newMonthlyDiscountPct,warning';
  const rows = records.map((r) =>
    [
      r.listingId,
      r.oldPricePerHour,
      r.oldPricePerDay ?? '',
      r.oldPricePerMonth ?? '',
      r.newPricePerHourEur,
      r.newDailyDiscountPct,
      r.newWeeklyDiscountPct,
      r.newMonthlyDiscountPct,
      r.warning ?? '',
    ].join(',')
  );
  fs.writeFileSync(outputPath, [header, ...rows].join('\n'), 'utf-8');
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const envArg = args.find((a) => a.startsWith('--env='));
  const dryRun = args.includes('--dry-run');
  const env = envArg?.split('=')[1] ?? 'dev';

  const tableName = env === 'prod' ? 'spotzy-main' : `spotzy-main-${env}`;

  console.log(`Migration target: ${tableName} (env=${env}, dryRun=${dryRun})`);

  const rawClient = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'eu-west-1' });
  const client = DynamoDBDocumentClient.from(rawClient, { marshallOptions: { removeUndefinedValues: true } });

  const result = await migrateListings(client, tableName, dryRun);

  const reportPath = `migration-report-${env}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  writeCsvReport(result.records, reportPath);

  console.log(`\nMigrated ${result.migrated} listings, ${result.warnings} warnings, ${result.errors} errors.`);
  console.log(`See ${reportPath} for details.`);
  if (dryRun) {
    console.log('(DRY RUN — no writes were made)');
  }
}

// Only run main when executed directly (not imported for testing)
if (require.main === module) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
