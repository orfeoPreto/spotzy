/**
 * UAT Seed Script — Session 31
 *
 * Idempotent seeder that populates the staging environment with the deterministic
 * dataset every UAT test case in Spotzy-UAT-Plan-v1.docx references.
 *
 * Usage:
 *   ts-node backend/scripts/seed-uat.ts
 *   ts-node backend/scripts/seed-uat.ts --wipe-only
 *   ts-node backend/scripts/seed-uat.ts --skip-stripe
 *   ts-node backend/scripts/seed-uat.ts --quiet
 *   ts-node backend/scripts/seed-uat.ts --manifest ./scripts/uat-manifest.json
 *
 * Safety guards (non-negotiable — no --force flag exists):
 *   1. AWS account ID must be the staging account (034797416555)
 *   2. STRIPE_SECRET_KEY must start with sk_test_
 *   3. USER_POOL_ID must be provided and must contain the staging pool identifier
 *   4. TABLE_NAME must NOT be spotzy-main-prod
 */

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminDeleteUserCommand,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import Stripe from 'stripe';

import {
  computeFullPriceBreakdown,
} from '../shared/pricing/tiered-pricing';
import type { FullPriceBreakdownInput } from '../shared/pricing/types';
import { BELGIAN_STANDARD_VAT_RATE } from '../shared/pricing/vat-constants';

import {
  UAT_PASSWORD,
  UAT_EMAIL_DOMAIN,
  UAT_STAGING_ACCOUNT_ID,
  UAT_STAGING_USER_POOL_ID_PATTERN,
  UAT_TABLE_NAME_FORBIDDEN,
  STRIPE_TEST_IBAN,
  PLACEHOLDER_PHOTO_KEYS,
  MEDIA_PUBLIC_BUCKET,
  ACCOUNT_FIXTURES,
  LISTING_FIXTURES,
  ALL_BAY_FIXTURES,
  BOOKING_FIXTURES,
  BLOCK_REQUEST_FIXTURES,
  type AccountFixture,
  type ListingFixture,
  type BayFixture,
  type BookingFixture,
  type BlockRequestFixture,
  type BlockAllocFixture,
} from './seed-uat.fixtures';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const WIPE_ONLY = args.includes('--wipe-only');
const SKIP_STRIPE = args.includes('--skip-stripe');
const QUIET = args.includes('--quiet');
const manifestFlag = args.indexOf('--manifest');
const MANIFEST_PATH = manifestFlag !== -1 ? args[manifestFlag + 1] : path.join(__dirname, 'uat-manifest.json');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  if (!QUIET) {
    process.stdout.write(`${new Date().toISOString()}  ${msg}\n`);
  }
}

function logStep(step: string, elapsed?: number): void {
  const suffix = elapsed !== undefined ? `  (${elapsed}ms)` : '';
  log(`[STEP] ${step}${suffix}`);
}

function bail(reason: string): never {
  process.stderr.write(`\n  FATAL: ${reason}\n\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Safety guards
// ---------------------------------------------------------------------------

async function assertSafetyGuards(): Promise<void> {
  log('Checking safety guards...');

  // Guard 1 — AWS account ID via CLI (no STS SDK dep required)
  let awsAccountId: string;
  try {
    awsAccountId = execSync('aws sts get-caller-identity --query Account --output text', {
      encoding: 'utf-8',
    }).trim();
  } catch {
    bail(
      'Could not call AWS STS. Make sure AWS_PROFILE is set and credentials are valid.\n' +
        '  aws sts get-caller-identity failed.',
    );
  }

  if (awsAccountId !== UAT_STAGING_ACCOUNT_ID) {
    bail(
      `AWS account mismatch!\n` +
        `  Expected staging account: ${UAT_STAGING_ACCOUNT_ID}\n` +
        `  Resolved account:         ${awsAccountId}\n` +
        `  Check your AWS_PROFILE environment variable.`,
    );
  }
  log(`  [OK] AWS account: ${awsAccountId}`);

  // Guard 2 — Stripe key must be test mode
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (!stripeKey.startsWith('sk_test_')) {
    bail(
      `STRIPE_SECRET_KEY does not start with sk_test_.\n` +
        `  Never seed UAT data against a live Stripe key.`,
    );
  }
  log('  [OK] Stripe key is test mode');

  // Guard 3 — Table name must not be production
  const tableName = process.env.TABLE_NAME ?? 'spotzy-main';
  if (tableName === UAT_TABLE_NAME_FORBIDDEN) {
    bail(
      `TABLE_NAME is "${tableName}" which is the production table.\n` +
        `  Set TABLE_NAME to spotzy-main (or any non-prod table name) to proceed.`,
    );
  }
  log(`  [OK] Table name: ${tableName}`);

  // Guard 4 — Cognito pool must be provided and must contain the staging identifier
  const userPoolId = process.env.USER_POOL_ID ?? '';
  if (!userPoolId) {
    bail(
      'USER_POOL_ID is not set.\n' +
        '  Export USER_POOL_ID=eu-west-3_BkzpEu2CA (or whichever staging pool) before running.',
    );
  }
  if (!userPoolId.includes(UAT_STAGING_USER_POOL_ID_PATTERN)) {
    bail(
      `USER_POOL_ID "${userPoolId}" does not contain the staging pool identifier "${UAT_STAGING_USER_POOL_ID_PATTERN}".\n` +
        '  This guard prevents accidental seeding of the production Cognito pool.',
    );
  }
  log(`  [OK] Cognito user pool: ${userPoolId}`);
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const REGION = process.env.AWS_REGION ?? 'eu-west-3';
const TABLE_NAME = process.env.TABLE_NAME ?? 'spotzy-main';
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';

const ddbRaw = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbRaw, {
  marshallOptions: { removeUndefinedValues: true },
});

const cognito = new CognitoIdentityProviderClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

let stripe: Stripe;

function initStripe(): void {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
    apiVersion: '2023-10-16',
  });
}

// ---------------------------------------------------------------------------
// DynamoDB helpers
// ---------------------------------------------------------------------------

async function putItem(item: Record<string, unknown>): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

async function getItem(key: Record<string, string>): Promise<Record<string, unknown> | null> {
  const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
  return (result.Item as Record<string, unknown>) ?? null;
}

async function deleteItem(key: Record<string, string>): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: key }));
}

async function queryItems(
  pk: string,
  skPrefix?: string,
): Promise<Record<string, unknown>[]> {
  const KeyConditionExpression = skPrefix
    ? 'PK = :pk AND begins_with(SK, :skp)'
    : 'PK = :pk';
  const ExpressionAttributeValues: Record<string, string> = skPrefix
    ? { ':pk': pk, ':skp': skPrefix }
    : { ':pk': pk };

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression,
      ExpressionAttributeValues,
    }),
  );
  return (result.Items as Record<string, unknown>[]) ?? [];
}

async function batchDeleteItems(keys: Array<Record<string, string>>): Promise<void> {
  // DynamoDB batch write has a max of 25 items per request
  const chunks: Array<Array<Record<string, string>>> = [];
  for (let i = 0; i < keys.length; i += 25) {
    chunks.push(keys.slice(i, i + 25));
  }
  for (const chunk of chunks) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: chunk.map((Key) => ({ DeleteRequest: { Key } })),
        },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Email → accountId helper
// ---------------------------------------------------------------------------

function emailForAccount(accountId: string): string {
  return `${accountId}@${UAT_EMAIL_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// Date offset helpers
// ---------------------------------------------------------------------------

function dateOffsetFromNow(daysOffset: number, hour = 0, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function isoOffset(daysOffset: number, hour = 0, minute = 0): string {
  return dateOffsetFromNow(daysOffset, hour, minute).toISOString();
}

// ---------------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------------

async function wipeUatData(): Promise<void> {
  const t0 = Date.now();
  logStep('WIPE — scanning for UAT users by email pattern...');

  // Scan DynamoDB for all USER# PROFILE rows matching *@uat.spotzy.test
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  const uatUserIds: string[] = [];

  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'GSI1',
        KeyConditionExpression: 'begins_with(GSI1PK, :prefix)',
        ExpressionAttributeValues: { ':prefix': `EMAIL#` },
        ProjectionExpression: 'GSI1PK, GSI1SK',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
    const items = (result.Items as Array<{ GSI1PK: string; GSI1SK: string }>) ?? [];
    for (const item of items) {
      const email = item.GSI1PK.replace('EMAIL#', '');
      if (email.endsWith(`@${UAT_EMAIL_DOMAIN}`)) {
        const userId = item.GSI1SK.replace('USER#', '');
        uatUserIds.push(userId);
      }
    }
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  log(`  Found ${uatUserIds.length} UAT users to wipe.`);

  for (const userId of uatUserIds) {
    await wipeUserData(userId);
  }

  // Also wipe known listing and block request IDs by deterministic IDs in case
  // user profile rows were already deleted in a partial previous wipe
  for (const lf of LISTING_FIXTURES) {
    await wipeListing(lf.listingId);
  }
  for (const bf of BLOCK_REQUEST_FIXTURES) {
    await wipeBlockRequest(bf.reqId);
  }
  for (const bkf of BOOKING_FIXTURES) {
    await wipeBooking(bkf.bookingId);
  }

  // Wipe Cognito users by email pattern
  log('  Wiping Cognito users...');
  await wipeCognitoUsers();

  // Wipe Stripe test Connect accounts by email pattern
  if (!SKIP_STRIPE) {
    log('  Wiping Stripe test Connect accounts...');
    await wipeStripeConnectAccounts();
  }

  logStep('WIPE complete', Date.now() - t0);
}

async function wipeUserData(userId: string): Promise<void> {
  log(`    Wiping DDB data for userId=${userId}`);
  // USER# partition
  const userItems = await queryItems(`USER#${userId}`);
  const userKeys = userItems.map((i) => ({ PK: i.PK as string, SK: i.SK as string }));
  if (userKeys.length > 0) await batchDeleteItems(userKeys);
}

async function wipeListing(listingId: string): Promise<void> {
  const items = await queryItems(`LISTING#${listingId}`);
  const keys = items.map((i) => ({ PK: i.PK as string, SK: i.SK as string }));
  if (keys.length > 0) await batchDeleteItems(keys);
}

async function wipeBlockRequest(reqId: string): Promise<void> {
  const items = await queryItems(`BLOCKREQ#${reqId}`);
  const keys = items.map((i) => ({ PK: i.PK as string, SK: i.SK as string }));
  if (keys.length > 0) await batchDeleteItems(keys);
}

async function wipeBooking(bookingId: string): Promise<void> {
  const items = await queryItems(`BOOKING#${bookingId}`);
  const keys = items.map((i) => ({ PK: i.PK as string, SK: i.SK as string }));
  if (keys.length > 0) await batchDeleteItems(keys);
  // Also wipe review by bookingId
  const reviewItems = await queryItems(`REVIEW#${bookingId}`);
  const reviewKeys = reviewItems.map((i) => ({ PK: i.PK as string, SK: i.SK as string }));
  if (reviewKeys.length > 0) await batchDeleteItems(reviewKeys);
}

async function wipeCognitoUsers(): Promise<void> {
  let paginationToken: string | undefined;
  const toDelete: string[] = [];

  do {
    const result = await cognito.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Filter: `email ^= "${UAT_EMAIL_DOMAIN}"`,
        PaginationToken: paginationToken,
      }),
    );
    const users: UserType[] = result.Users ?? [];
    for (const u of users) {
      const emailAttr = u.Attributes?.find((a) => a.Name === 'email');
      if (emailAttr?.Value?.endsWith(`@${UAT_EMAIL_DOMAIN}`) && u.Username) {
        toDelete.push(u.Username);
      }
    }
    paginationToken = result.PaginationToken;
  } while (paginationToken);

  for (const username of toDelete) {
    await cognito.send(
      new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }),
    );
    log(`    Deleted Cognito user: ${username}`);
  }
}

async function wipeStripeConnectAccounts(): Promise<void> {
  // List connected accounts and delete those whose email matches UAT domain
  let startingAfter: string | undefined;
  const toDelete: string[] = [];

  do {
    const page = await stripe.accounts.list({ limit: 100, starting_after: startingAfter });
    for (const acct of page.data) {
      if (acct.email?.endsWith(`@${UAT_EMAIL_DOMAIN}`)) {
        toDelete.push(acct.id);
      }
    }
    startingAfter = page.has_more ? page.data[page.data.length - 1]?.id : undefined;
  } while (startingAfter);

  for (const acctId of toDelete) {
    await stripe.accounts.del(acctId);
    log(`    Deleted Stripe Connect account: ${acctId}`);
  }
}

// ---------------------------------------------------------------------------
// CONFIG records
// ---------------------------------------------------------------------------

async function ensureConfigRecords(): Promise<void> {
  const t0 = Date.now();
  logStep('Ensuring CONFIG records...');

  const feeKey = { PK: 'CONFIG#PLATFORM_FEE', SK: 'METADATA' };
  const existingFee = await getItem(feeKey);
  if (existingFee) {
    log('  CONFIG#PLATFORM_FEE already present, skipping.');
  } else {
    await putItem({
      ...feeKey,
      singleShotPct: 0.15,
      blockReservationPct: 0.15,
      bounds: [0, 0.3],
      lastModifiedBy: 'seed-uat',
      lastModifiedAt: new Date().toISOString(),
      historyLog: [],
    });
    log('  Created CONFIG#PLATFORM_FEE');
  }

  const vatKey = { PK: 'CONFIG#VAT_RATES', SK: 'METADATA' };
  const existingVat = await getItem(vatKey);
  if (existingVat) {
    log('  CONFIG#VAT_RATES already present, skipping.');
  } else {
    await putItem({
      ...vatKey,
      belgianStandardRate: 0.21,
    });
    log('  Created CONFIG#VAT_RATES');
  }

  logStep('CONFIG records done', Date.now() - t0);
}

// ---------------------------------------------------------------------------
// Cognito user creation
// ---------------------------------------------------------------------------

async function ensureCognitoUser(
  fixture: AccountFixture,
): Promise<string> {
  const email = emailForAccount(fixture.accountId);

  // Check if user already exists by listing users with the email filter
  const existing = await cognito.send(
    new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `email = "${email}"`,
    }),
  );

  if (existing.Users && existing.Users.length > 0) {
    const username = existing.Users[0].Username ?? email;
    log(`    Cognito user already exists: ${email} → ${username}`);
    return username;
  }

  // Create user with permanent password (suppress temp password email)
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: displayName(fixture.accountId) },
      ],
      TemporaryPassword: UAT_PASSWORD,
    }),
  );

  // Set permanent password (bypasses FORCE_CHANGE_PASSWORD challenge)
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: UAT_PASSWORD,
      Permanent: true,
    }),
  );

  // Add to admins group if admin persona
  if (fixture.persona === 'Admin') {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        GroupName: 'admins',
      }),
    );
  }

  log(`    Created Cognito user: ${email}`);
  return email;
}

function displayName(accountId: string): string {
  // Convert e.g. 'spotter-fr-01' → 'UAT Spotter FR 01'
  return `UAT ${accountId
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')}`;
}

// ---------------------------------------------------------------------------
// Stripe Connect helpers
// ---------------------------------------------------------------------------

async function ensureStripeConnectAccount(
  fixture: AccountFixture,
): Promise<string | null> {
  if (fixture.stripeConnect === 'none') return null;
  if (SKIP_STRIPE) {
    log(`    --skip-stripe set; skipping Stripe for ${fixture.accountId}`);
    return null;
  }

  const email = emailForAccount(fixture.accountId);

  // Check if an account already exists for this email
  let startingAfter: string | undefined;
  let existingId: string | null = null;

  do {
    const page = await stripe.accounts.list({ limit: 100, starting_after: startingAfter });
    for (const acct of page.data) {
      if (acct.email === email) {
        existingId = acct.id;
        break;
      }
    }
    if (existingId) break;
    startingAfter = page.has_more ? page.data[page.data.length - 1]?.id : undefined;
  } while (startingAfter);

  if (existingId) {
    log(`    Stripe Connect account already exists for ${email}: ${existingId}`);
    return existingId;
  }

  // Create new Express account
  const acct = await stripe.accounts.create({
    type: 'express',
    country: 'BE',
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_type: 'individual',
    business_profile: {
      product_description: 'Parking space rental via Spotzy',
      mcc: '7523', // automobile parking lots and garages
    },
  });

  // For 'onboarded' accounts, add test bank account and mark ready
  if (fixture.stripeConnect === 'onboarded') {
    // Add Belgian IBAN as external account (test mode token)
    await stripe.accounts.createExternalAccount(acct.id, {
      external_account: {
        object: 'bank_account',
        country: 'BE',
        currency: 'eur',
        account_number: STRIPE_TEST_IBAN,
      } as unknown as string,
    });

    // In test mode, use test tokens to complete verification
    await stripe.accounts.update(acct.id, {
      individual: {
        first_name: 'UAT',
        last_name: fixture.accountId,
        dob: { day: 1, month: 1, year: 1990 },
        address: {
          line1: '123 UAT Street',
          city: 'Brussels',
          postal_code: '1000',
          country: 'BE',
        },
        email,
        // Stripe test token for identity verification
        id_number: '000000000',
      },
      tos_acceptance: {
        date: Math.floor(Date.now() / 1000),
        ip: '127.0.0.1',
      },
    });
  }

  log(`    Created Stripe Connect account for ${fixture.accountId}: ${acct.id}`);
  return acct.id;
}

// ---------------------------------------------------------------------------
// RC Submission helper
// ---------------------------------------------------------------------------

async function ensureRcSubmission(
  fixture: AccountFixture,
  userId: string,
): Promise<string | null> {
  if (fixture.rcState === 'none') return null;

  const submissionId = `rcsub-uat-${fixture.accountId}`;

  const existing = await getItem({
    PK: `USER#${userId}`,
    SK: `RCSUBMISSION#${submissionId}`,
  });

  if (existing) {
    log(`    RC submission already exists for ${fixture.accountId}`);
    return submissionId;
  }

  const now = new Date();
  let expiryDate: string;
  let status: string;

  if (fixture.rcState === 'APPROVED') {
    const exp = new Date(now);
    exp.setDate(exp.getDate() + (fixture.rcExpiryDaysFromNow ?? 180));
    expiryDate = exp.toISOString().substring(0, 10);
    status = 'APPROVED';
  } else if (fixture.rcState === 'EXPIRED') {
    const exp = new Date(now);
    exp.setDate(exp.getDate() + (fixture.rcExpiryDaysFromNow ?? -5));
    expiryDate = exp.toISOString().substring(0, 10);
    status = 'EXPIRED';
  } else {
    // PENDING
    const exp = new Date(now);
    exp.setDate(exp.getDate() + 365);
    expiryDate = exp.toISOString().substring(0, 10);
    status = 'PENDING';
  }

  await putItem({
    PK: `USER#${userId}`,
    SK: `RCSUBMISSION#${submissionId}`,
    submissionId,
    userId,
    insurer: 'UAT Test Insurer NV',
    policyNumber: `UAT-POL-${fixture.accountId.toUpperCase()}`,
    expiryDate,
    documentS3Key: 'uat/rc-docs/seed-uat-test-rc.pdf',
    status,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  // Add to review queue if PENDING
  if (status === 'PENDING') {
    await putItem({
      PK: 'RC_REVIEW_QUEUE',
      SK: `PENDING#${now.toISOString()}#${submissionId}`,
      submissionId,
      userId,
      createdAt: now.toISOString(),
    });
  }

  log(`    Created RC submission (${status}) for ${fixture.accountId}`);
  return submissionId;
}

// ---------------------------------------------------------------------------
// User profile (DynamoDB)
// ---------------------------------------------------------------------------

async function ensureUserProfile(
  fixture: AccountFixture,
  userId: string,
  stripeConnectId: string | null,
): Promise<void> {
  const email = emailForAccount(fixture.accountId);

  const existing = await getItem({ PK: `USER#${userId}`, SK: 'PROFILE' });
  if (existing) {
    log(`    User profile already exists for ${fixture.accountId}`);
    return;
  }

  const now = new Date().toISOString();

  const profile: Record<string, unknown> = {
    PK: `USER#${userId}`,
    SK: 'PROFILE',
    GSI1PK: `EMAIL#${email}`,
    GSI1SK: `USER#${userId}`,
    userId,
    email,
    name: displayName(fixture.accountId),
    vatStatus: fixture.vatStatus,
    spotManagerStatus: fixture.spotManagerStatus,
    createdAt: now,
    updatedAt: now,
  };

  if (fixture.locale !== null) {
    profile['preferredLocale'] = fixture.locale;
  }
  if (fixture.vatNumber !== null) {
    profile['vatNumber'] = fixture.vatNumber;
  }
  if (stripeConnectId !== null) {
    profile['stripeConnectAccountId'] = stripeConnectId;
  }
  if (fixture.companyName) {
    profile['companyName'] = fixture.companyName;
  }

  await putItem(profile);
  log(`    Created user profile for ${fixture.accountId}`);
}

// ---------------------------------------------------------------------------
// Placeholder photos
// ---------------------------------------------------------------------------

async function ensurePlaceholderPhotos(): Promise<void> {
  for (const key of PLACEHOLDER_PHOTO_KEYS) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: MEDIA_PUBLIC_BUCKET, Key: key }));
      log(`    Photo already exists: ${key}`);
    } catch {
      // Upload a minimal placeholder JPEG-like bytes (just a 1-pixel image marker)
      const placeholderBytes = Buffer.from(
        'FFFFD8FFE000104A46494600010100000100010000FFDB004300080606070605080707070909080A0C140D0C0B0B0C1912130F141D1A1F1E1D1A1C1C20242E2720222C231C1C2837292C30313434341F27393D38323C2E333432FFDB0043010909090C0B0C180D0D1832211C213232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232323232FFC000110800010001 03012200021101031101FFC4001F0000010501010101010100000000000000000102030405060708090A0BFFC400B5100002010303020403050504040000017D01020300041105122131410613516107227114328191A1082342B1C11552D1F02433627282090A161718191A25262728292A3435363738393A434445464748494A535455565758595A636465666768696A737475767778797A838485868788898A929394959697989 9A A2A3A4A5A6A7A8A9AAB2B3B4B5B6B7B8B9BAC2C3C4C5C6C7C8C9CAD2D3D4D5D6D7D8D9DAE1E2E3E4E5E6E7E8E9EAF1F2F3F4F5F6F7F8F9FAFFDA000C03010002110311003F00',
        'hex',
      );
      await s3.send(
        new PutObjectCommand({
          Bucket: MEDIA_PUBLIC_BUCKET,
          Key: key,
          Body: placeholderBytes,
          ContentType: 'image/jpeg',
        }),
      );
      log(`    Uploaded placeholder photo: ${key}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Listing creation
// ---------------------------------------------------------------------------

function buildAvailRules(
  listingId: string,
  is247: boolean,
): Array<Record<string, unknown>> {
  if (is247) {
    return [
      {
        PK: `LISTING#${listingId}`,
        SK: 'AVAIL_RULE#default',
        ruleId: 'default',
        type: 'RECURRING',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startHour: 0,
        endHour: 24,
        validFrom: new Date().toISOString().substring(0, 10),
        validUntil: dateOffsetFromNow(90).toISOString().substring(0, 10),
      },
    ];
  }

  // Weekdays 07:00–22:00
  return [
    {
      PK: `LISTING#${listingId}`,
      SK: 'AVAIL_RULE#weekdays',
      ruleId: 'weekdays',
      type: 'RECURRING',
      daysOfWeek: [1, 2, 3, 4, 5], // Mon–Fri
      startHour: 7,
      endHour: 22,
      validFrom: new Date().toISOString().substring(0, 10),
      validUntil: dateOffsetFromNow(90).toISOString().substring(0, 10),
    },
  ];
}

async function ensureListing(
  fixture: ListingFixture,
  ownerId: string,
): Promise<void> {
  const existing = await getItem({
    PK: `LISTING#${fixture.listingId}`,
    SK: 'METADATA',
  });

  if (existing) {
    log(`    Listing already exists: ${fixture.listingId}`);
    return;
  }

  const now = new Date().toISOString();

  const item: Record<string, unknown> = {
    PK: `LISTING#${fixture.listingId}`,
    SK: 'METADATA',
    GSI1PK: `HOST#${ownerId}`,
    GSI1SK: `LISTING#${fixture.listingId}`,
    listingId: fixture.listingId,
    hostId: ownerId,
    address: fixture.address,
    addressLat: fixture.lat,
    addressLng: fixture.lng,
    spotType: fixture.spotType,
    hostNetPricePerHourEur: fixture.hostNetPricePerHourEur,
    dailyDiscountPct: fixture.dailyDiscountPct,
    weeklyDiscountPct: fixture.weeklyDiscountPct,
    monthlyDiscountPct: fixture.monthlyDiscountPct,
    hostVatStatusAtCreation: resolveHostVatStatus(fixture.ownerAccountId),
    status: fixture.status,
    isPool: fixture.isPool,
    originalLocale: fixture.originalLocale,
    // Titles per locale
    title: fixture.title[fixture.originalLocale],
    titleTranslations: {
      en: fixture.title['en'] ?? '',
      'fr-BE': fixture.title['fr-BE'] ?? '',
      'nl-BE': fixture.title['nl-BE'] ?? '',
    },
    // Descriptions per locale
    description: fixture.description[fixture.originalLocale],
    descriptionTranslations: {
      en: fixture.description['en'] ?? '',
      'fr-BE': fixture.description['fr-BE'] ?? '',
      'nl-BE': fixture.description['nl-BE'] ?? '',
    },
    photos: PLACEHOLDER_PHOTO_KEYS.map((key) => ({
      s3Key: key,
      validationStatus: 'PASS',
    })),
    createdAt: now,
    updatedAt: now,
  };

  if (fixture.isPool) {
    item['poolCapacity'] = fixture.poolCapacity;
    item['blockReservationsOptedIn'] = fixture.blockReservationsOptedIn ?? false;
    if (fixture.defaultRiskShareMode) {
      item['defaultRiskShareMode'] = fixture.defaultRiskShareMode;
    }
    if (fixture.defaultRiskShareRate !== undefined) {
      item['defaultRiskShareRate'] = fixture.defaultRiskShareRate;
    }
  }

  if (fixture.status === 'live') {
    item['publishedAt'] = now;
  }

  await putItem(item);

  // Availability rules
  for (const rule of buildAvailRules(fixture.listingId, fixture.availability247 ?? false)) {
    await putItem(rule);
  }

  log(`    Created listing: ${fixture.listingId}`);
}

function resolveHostVatStatus(ownerAccountId: string): string {
  const fixture = ACCOUNT_FIXTURES.find((a) => a.accountId === ownerAccountId);
  return fixture?.vatStatus ?? 'EXEMPT_FRANCHISE';
}

// ---------------------------------------------------------------------------
// Bay creation
// ---------------------------------------------------------------------------

async function ensureBay(bay: BayFixture): Promise<void> {
  const existing = await getItem({
    PK: `LISTING#${bay.poolListingId}`,
    SK: `BAY#${bay.bayId}`,
  });

  if (existing) {
    log(`    Bay already exists: ${bay.bayId}`);
    return;
  }

  await putItem({
    PK: `LISTING#${bay.poolListingId}`,
    SK: `BAY#${bay.bayId}`,
    bayId: bay.bayId,
    poolListingId: bay.poolListingId,
    label: bay.label,
    accessInstructions: bay.accessInstructions[Object.keys(bay.accessInstructions)[0]],
    accessInstructionsTranslations: bay.accessInstructions,
    createdAt: new Date().toISOString(),
  });

  log(`    Created bay: ${bay.bayId} (${bay.label})`);
}

// ---------------------------------------------------------------------------
// Booking creation
// ---------------------------------------------------------------------------

async function ensureBooking(
  fixture: BookingFixture,
  userIdMap: Map<string, string>,
): Promise<void> {
  const existing = await getItem({
    PK: `BOOKING#${fixture.bookingId}`,
    SK: 'METADATA',
  });

  if (existing) {
    log(`    Booking already exists: ${fixture.bookingId}`);
    return;
  }

  const spotterId = userIdMap.get(fixture.spotterAccountId) ?? fixture.spotterAccountId;
  const hostId = userIdMap.get(fixture.hostAccountId) ?? fixture.hostAccountId;

  const startTime = isoOffset(
    fixture.startOffset.daysOffset,
    fixture.startOffset.hour,
    fixture.startOffset.minute,
  );
  const endTime = new Date(
    new Date(startTime).getTime() + fixture.durationHours * 3600 * 1000,
  ).toISOString();

  // Compute price breakdown using canonical function
  const listingFixture = LISTING_FIXTURES.find((l) => l.listingId === fixture.listingId);
  if (!listingFixture) {
    throw new Error(`Listing fixture not found: ${fixture.listingId}`);
  }

  const input: FullPriceBreakdownInput = {
    pricing: {
      hostNetPricePerHourEur: listingFixture.hostNetPricePerHourEur,
      dailyDiscountPct: listingFixture.dailyDiscountPct,
      weeklyDiscountPct: listingFixture.weeklyDiscountPct,
      monthlyDiscountPct: listingFixture.monthlyDiscountPct,
    },
    durationHours: fixture.durationHours,
    hostVatStatus: resolveHostVatStatus(fixture.hostAccountId) as
      | 'NONE'
      | 'EXEMPT_FRANCHISE'
      | 'VAT_REGISTERED',
    platformFeePct: 0.15,
    vatRate: BELGIAN_STANDARD_VAT_RATE,
  };
  const priceBreakdown = computeFullPriceBreakdown(input);

  const now = new Date().toISOString();

  const booking: Record<string, unknown> = {
    PK: `BOOKING#${fixture.bookingId}`,
    SK: 'METADATA',
    GSI1PK: `SPOTTER#${spotterId}`,
    GSI1SK: `BOOKING#${fixture.bookingId}`,
    bookingId: fixture.bookingId,
    listingId: fixture.listingId,
    spotterId,
    hostId,
    startTime,
    endTime,
    durationHours: fixture.durationHours,
    status: fixture.status,
    priceBreakdown,
    stripePaymentIntentId: `pi_uat_${fixture.bookingId}`,
    createdAt: now,
    updatedAt: now,
  };

  if (fixture.bayId) {
    booking['bayId'] = fixture.bayId;
  }

  await putItem(booking);

  // Listing → Booking reverse index
  await putItem({
    PK: `LISTING#${fixture.listingId}`,
    SK: `BOOKING#${fixture.bookingId}`,
    bookingId: fixture.bookingId,
    listingId: fixture.listingId,
  });

  // Leave a review for booking-uat-006
  if (fixture.bookingId === 'booking-uat-006') {
    await ensureReview(fixture, spotterId, hostId);
  }

  log(`    Created booking: ${fixture.bookingId} (${fixture.status})`);
}

async function ensureReview(
  fixture: BookingFixture,
  spotterId: string,
  hostId: string,
): Promise<void> {
  const reviewKey = {
    PK: `REVIEW#${hostId}`,
    SK: `REVIEW#${fixture.bookingId}`,
  };
  const existing = await getItem(reviewKey);
  if (existing) {
    log(`    Review already exists for booking ${fixture.bookingId}`);
    return;
  }

  await putItem({
    ...reviewKey,
    bookingId: fixture.bookingId,
    reviewerId: spotterId,
    targetId: hostId,
    rating: 4,
    comment: 'Good parking spot, easy access.',
    createdAt: new Date().toISOString(),
  });
  log(`    Created review for booking: ${fixture.bookingId}`);
}

// ---------------------------------------------------------------------------
// Block request creation
// ---------------------------------------------------------------------------

async function ensureBlockRequest(
  fixture: BlockRequestFixture,
  userIdMap: Map<string, string>,
): Promise<void> {
  const existing = await getItem({
    PK: `BLOCKREQ#${fixture.reqId}`,
    SK: 'METADATA',
  });

  if (existing) {
    log(`    Block request already exists: ${fixture.reqId}`);
    return;
  }

  const blockSpotterUserId = userIdMap.get(fixture.ownerAccountId) ?? fixture.ownerAccountId;
  const windowStart = isoOffset(fixture.windowStartOffset.daysOffset, 8, 0);
  const windowEnd = new Date(
    new Date(windowStart).getTime() + fixture.windowDurationDays * 24 * 3600 * 1000,
  ).toISOString();

  const now = new Date().toISOString();

  await putItem({
    PK: `BLOCKREQ#${fixture.reqId}`,
    SK: 'METADATA',
    GSI1PK: `USER#${blockSpotterUserId}`,
    GSI1SK: `BLOCKREQ#${fixture.reqId}`,
    reqId: fixture.reqId,
    blockSpotterUserId,
    targetBayCount: fixture.targetBayCount,
    windowStart,
    windowEnd,
    status: fixture.status,
    stripePaymentIntentId: `pi_uat_${fixture.reqId}`,
    createdAt: now,
    updatedAt: now,
  });

  // User → BlockRequest reverse index
  await putItem({
    PK: `USER#${blockSpotterUserId}`,
    SK: `BLOCKREQ#${fixture.reqId}`,
    reqId: fixture.reqId,
    blockSpotterUserId,
  });

  // Block allocations
  for (const alloc of fixture.allocs) {
    await ensureBlockAlloc(fixture.reqId, alloc, userIdMap);
  }

  log(`    Created block request: ${fixture.reqId} (${fixture.status})`);
}

async function ensureBlockAlloc(
  reqId: string,
  alloc: BlockAllocFixture,
  userIdMap: Map<string, string>,
): Promise<void> {
  const spotManagerUserId = userIdMap.get(alloc.spotManagerAccountId) ?? alloc.spotManagerAccountId;

  const existing = await getItem({
    PK: `BLOCKREQ#${reqId}`,
    SK: `BLOCKALLOC#${alloc.allocId}`,
  });

  if (existing) {
    log(`    Block alloc already exists: ${alloc.allocId}`);
    return;
  }

  const now = new Date().toISOString();

  // Compute price breakdown for the allocation
  const listingFixture = LISTING_FIXTURES.find((l) => l.listingId === alloc.poolListingId);
  if (!listingFixture) {
    throw new Error(`Listing fixture not found for alloc: ${alloc.poolListingId}`);
  }

  // For a block alloc, duration is the window duration × contributedBayCount
  // We compute per-bay per-hour then aggregate
  const blockReq = BLOCK_REQUEST_FIXTURES.find((b) => b.reqId === reqId);
  if (!blockReq) throw new Error(`Block request fixture not found: ${reqId}`);
  const windowHours = blockReq.windowDurationDays * 24;

  const input: FullPriceBreakdownInput = {
    pricing: {
      hostNetPricePerHourEur: listingFixture.hostNetPricePerHourEur * alloc.contributedBayCount,
      dailyDiscountPct: listingFixture.dailyDiscountPct,
      weeklyDiscountPct: listingFixture.weeklyDiscountPct,
      monthlyDiscountPct: listingFixture.monthlyDiscountPct,
    },
    durationHours: windowHours,
    hostVatStatus: resolveHostVatStatus(alloc.spotManagerAccountId) as
      | 'NONE'
      | 'EXEMPT_FRANCHISE'
      | 'VAT_REGISTERED',
    platformFeePct: 0.15,
    vatRate: BELGIAN_STANDARD_VAT_RATE,
  };
  const priceBreakdown = computeFullPriceBreakdown(input);

  await putItem({
    PK: `BLOCKREQ#${reqId}`,
    SK: `BLOCKALLOC#${alloc.allocId}`,
    allocId: alloc.allocId,
    reqId,
    poolListingId: alloc.poolListingId,
    spotManagerUserId,
    contributedBayCount: alloc.contributedBayCount,
    riskShareMode: alloc.riskShareMode,
    riskShareRate: alloc.riskShareRate,
    priceBreakdown,
    createdAt: now,
    updatedAt: now,
  });

  // Listing → BlockAlloc reverse index
  await putItem({
    PK: `LISTING#${alloc.poolListingId}`,
    SK: `BLOCKALLOC#${alloc.allocId}`,
    allocId: alloc.allocId,
    reqId,
    poolListingId: alloc.poolListingId,
  });

  log(`    Created block alloc: ${alloc.allocId}`);
}

// ---------------------------------------------------------------------------
// Manifest output
// ---------------------------------------------------------------------------

interface ManifestAccount {
  accountId: string;
  userId: string;
  email: string;
  persona: string;
  locale: string | null;
  stripeConnectId: string | null;
  notes: string;
}

interface ManifestListing {
  listingId: string;
  owner: string;
  isPool: boolean;
  title: string;
  status: string;
}

interface ManifestBooking {
  bookingId: string;
  spotter: string;
  listingId: string;
  status: string;
}

interface ManifestBlockRequest {
  reqId: string;
  owner: string;
  status: string;
}

interface Manifest {
  generatedAt: string;
  stripeMode: string;
  tableName: string;
  userPoolId: string;
  region: string;
  passwordForAllAccounts: string;
  accounts: ManifestAccount[];
  listings: ManifestListing[];
  bookings: ManifestBooking[];
  blockRequests: ManifestBlockRequest[];
}

function writeManifest(
  userIdMap: Map<string, string>,
  stripeIdMap: Map<string, string | null>,
): void {
  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    stripeMode: 'test',
    tableName: TABLE_NAME,
    userPoolId: USER_POOL_ID,
    region: REGION,
    passwordForAllAccounts: UAT_PASSWORD,
    accounts: ACCOUNT_FIXTURES.map((f) => ({
      accountId: f.accountId,
      userId: userIdMap.get(f.accountId) ?? f.accountId,
      email: emailForAccount(f.accountId),
      persona: f.persona,
      locale: f.locale,
      stripeConnectId: stripeIdMap.get(f.accountId) ?? null,
      notes: f.notes,
    })),
    listings: LISTING_FIXTURES.map((l) => ({
      listingId: l.listingId,
      owner: l.ownerAccountId,
      isPool: l.isPool,
      title: l.title[l.originalLocale] ?? '',
      status: l.status,
    })),
    bookings: BOOKING_FIXTURES.map((b) => ({
      bookingId: b.bookingId,
      spotter: b.spotterAccountId,
      listingId: b.listingId,
      status: b.status,
    })),
    blockRequests: BLOCK_REQUEST_FIXTURES.map((br) => ({
      reqId: br.reqId,
      owner: br.ownerAccountId,
      status: br.status,
    })),
  };

  const dir = path.dirname(MANIFEST_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  log(`Manifest written to: ${MANIFEST_PATH}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const t0 = Date.now();
  log('=== Spotzy UAT Seed Script ===');

  await assertSafetyGuards();

  if (!SKIP_STRIPE) {
    initStripe();
  }

  if (WIPE_ONLY) {
    await wipeUatData();
    log(`=== Wipe complete in ${Date.now() - t0}ms ===`);
    return;
  }

  // --- CONFIG ---
  await ensureConfigRecords();

  // --- PLACEHOLDER PHOTOS ---
  logStep('Ensuring placeholder photos...');
  const tPhotos = Date.now();
  try {
    await ensurePlaceholderPhotos();
  } catch (err) {
    log(`  WARNING: Could not upload placeholder photos: ${String(err)}`);
    log('  Continuing without photo upload (photos will reference non-existent S3 keys)');
  }
  logStep('Photos done', Date.now() - tPhotos);

  // --- ACCOUNTS ---
  logStep('Creating Cognito users and DDB profiles...');
  const tAccounts = Date.now();

  const userIdMap = new Map<string, string>(); // accountId → userId (Cognito username = email here)
  const stripeIdMap = new Map<string, string | null>(); // accountId → Stripe Connect ID

  for (const fixture of ACCOUNT_FIXTURES) {
    log(`  Processing account: ${fixture.accountId}`);
    const cognitoUsername = await ensureCognitoUser(fixture);
    // We use the email as userId since Cognito username IS the email in this pool
    const userId = cognitoUsername;
    userIdMap.set(fixture.accountId, userId);

    const stripeId = await ensureStripeConnectAccount(fixture);
    stripeIdMap.set(fixture.accountId, stripeId);

    await ensureUserProfile(fixture, userId, stripeId);
    await ensureRcSubmission(fixture, userId);
  }

  logStep('Accounts done', Date.now() - tAccounts);

  // --- LISTINGS ---
  logStep('Creating listings...');
  const tListings = Date.now();

  for (const fixture of LISTING_FIXTURES) {
    const ownerId = userIdMap.get(fixture.ownerAccountId) ?? fixture.ownerAccountId;
    await ensureListing(fixture, ownerId);
  }

  logStep('Listings done', Date.now() - tListings);

  // --- BAYS ---
  logStep('Creating pool bays...');
  const tBays = Date.now();

  for (const bay of ALL_BAY_FIXTURES) {
    await ensureBay(bay);
  }

  logStep('Bays done', Date.now() - tBays);

  // --- BOOKINGS ---
  logStep('Creating in-flight bookings...');
  const tBookings = Date.now();

  for (const fixture of BOOKING_FIXTURES) {
    await ensureBooking(fixture, userIdMap);
  }

  logStep('Bookings done', Date.now() - tBookings);

  // --- BLOCK REQUESTS ---
  logStep('Creating in-flight block requests...');
  const tBlocks = Date.now();

  for (const fixture of BLOCK_REQUEST_FIXTURES) {
    await ensureBlockRequest(fixture, userIdMap);
  }

  logStep('Block requests done', Date.now() - tBlocks);

  // --- MANIFEST ---
  logStep('Writing manifest...');
  writeManifest(userIdMap, stripeIdMap);

  const totalMs = Date.now() - t0;
  log(`\n=== Seed complete in ${totalMs}ms ===`);
  log(`Manifest: ${MANIFEST_PATH}`);

  if (totalMs > 90_000) {
    log('WARNING: Seeder took more than 90 seconds. Check for throttling or network issues.');
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\nUnhandled error: ${String(err)}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  process.exit(1);
});
