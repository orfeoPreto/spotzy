/**
 * Seed script for the test environment.
 *
 * Usage:
 *   npx ts-node scripts/seed-test-data.ts --environment test
 *   npx ts-node scripts/seed-test-data.ts --environment test --cleanup
 */

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const environment = args[args.indexOf('--environment') + 1] ?? 'test';
const cleanup = args.includes('--cleanup');

if (!['test', 'staging'].includes(environment)) {
  console.error('--environment must be "test" or "staging"');
  process.exit(1);
}

const REGION = process.env.AWS_REGION ?? 'eu-west-1';
const USER_POOL_ID = process.env[`${environment.toUpperCase()}_COGNITO_USER_POOL_ID`]
  ?? process.env.COGNITO_USER_POOL_ID;
const TABLE_NAME = process.env[`${environment.toUpperCase()}_TABLE_NAME`]
  ?? `spotzy-main-${environment}`;

if (!USER_POOL_ID) {
  console.error('Missing COGNITO_USER_POOL_ID environment variable');
  process.exit(1);
}

const cognito = new CognitoIdentityProviderClient({ region: REGION });
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// ---------------------------------------------------------------------------
// Test users
// ---------------------------------------------------------------------------

const TEST_USERS = [
  {
    email: 'host@test.spotzy.be',
    password: process.env.TEST_HOST_PASSWORD ?? 'TestPassword123!',
    role: 'HOST',
    stripeAccountId: 'acct_test_host',
  },
  {
    email: 'spotter@test.spotzy.be',
    password: process.env.TEST_SPOTTER_PASSWORD ?? 'TestPassword123!',
    role: 'SPOTTER',
    stripeCustomerId: 'cus_test_spotter',
  },
  {
    email: 'spotter2@test.spotzy.be',
    password: process.env.TEST_SPOTTER_2_PASSWORD ?? 'TestPassword123!',
    role: 'SPOTTER',
  },
];

// ---------------------------------------------------------------------------
// Listing definitions (Brussels)
// ---------------------------------------------------------------------------

const HOST_ID = 'usr-seed-host';

const LISTINGS = [
  {
    id: 'lst-seed-ixelles',
    hostId: HOST_ID,
    address: 'Chaussée de Vleurgat 65, 1050 Ixelles, Brussels',
    lat: 50.8288,
    lng: 4.3713,
    spotType: 'COVERED_GARAGE',
    pricePerHour: 3.5,
    pricePerDay: null,
    availability: 'WEEKDAYS_8_20',
    status: 'LIVE',
  },
  {
    id: 'lst-seed-uccle',
    hostId: HOST_ID,
    address: 'Avenue Brugmann 120, 1190 Uccle, Brussels',
    lat: 50.8102,
    lng: 4.3548,
    spotType: 'DRIVEWAY',
    pricePerHour: 2.0,
    pricePerDay: null,
    availability: 'ALWAYS',
    status: 'LIVE',
  },
  {
    id: 'lst-seed-schaerbeek',
    hostId: HOST_ID,
    address: 'Rue Josaphat 48, 1030 Schaerbeek, Brussels',
    lat: 50.8638,
    lng: 4.3748,
    spotType: 'CARPORT',
    pricePerHour: null,
    pricePerDay: 15.0,
    availability: 'WEEKENDS',
    status: 'LIVE',
  },
];

// Precision-5 geohash for each listing (computed at seed time)
function geohashEncode(lat: number, lng: number, precision: number): string {
  // Minimal geohash encoder (base32)
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let minLat = -90, maxLat = 90;
  let minLng = -180, maxLng = 180;
  let hash = '';
  let isLng = true;
  let bits = 0;
  let bitsTotal = 0;
  let hashValue = 0;

  while (hash.length < precision) {
    if (isLng) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { hashValue = (hashValue << 1) + 1; minLng = mid; }
      else { hashValue = hashValue << 1; maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { hashValue = (hashValue << 1) + 1; minLat = mid; }
      else { hashValue = hashValue << 1; maxLat = mid; }
    }
    isLng = !isLng;
    bits++;
    bitsTotal++;
    if (bits === 5) {
      hash += BASE32[hashValue];
      bits = 0;
      hashValue = 0;
    }
  }
  return hash;
}

// ---------------------------------------------------------------------------
// Completed booking (for review/dispute tests)
// ---------------------------------------------------------------------------

const SPOTTER_ID = 'usr-seed-spotter';
const COMPLETED_BOOKING_ID = process.env.COMPLETED_BOOKING_ID ?? 'bk-seed-completed';

const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const twoHoursBeforeYesterday = new Date(yesterday);
twoHoursBeforeYesterday.setHours(twoHoursBeforeYesterday.getHours() - 2);

// ---------------------------------------------------------------------------
// Cognito helpers
// ---------------------------------------------------------------------------

async function createCognitoUser(email: string, password: string, role: string) {
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID!, Username: email }));
    console.log(`  Cognito user already exists: ${email}`);
    return;
  } catch (e: any) {
    if (e.name !== 'UserNotFoundException') throw e;
  }

  await cognito.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID!,
    Username: email,
    TemporaryPassword: 'TempPass123!',
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'custom:role', Value: role },
    ],
    MessageAction: 'SUPPRESS',
  }));

  await cognito.send(new AdminSetUserPasswordCommand({
    UserPoolId: USER_POOL_ID!,
    Username: email,
    Password: password,
    Permanent: true,
  }));

  console.log(`  Created Cognito user: ${email} (${role})`);
}

async function deleteCognitoUser(email: string) {
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID!, Username: email }));
    console.log(`  Deleted Cognito user: ${email}`);
  } catch (e: any) {
    if (e.name !== 'UserNotFoundException') throw e;
    console.log(`  Cognito user not found (skipping): ${email}`);
  }
}

// ---------------------------------------------------------------------------
// DynamoDB helpers
// ---------------------------------------------------------------------------

async function putListing(listing: typeof LISTINGS[0]) {
  const geohash = geohashEncode(listing.lat, listing.lng, 5);
  await dynamo.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `LISTING#${listing.id}`,
      SK: `LISTING#${listing.id}`,
      GSI1PK: `HOST#${listing.hostId}`,
      GSI1SK: `LISTING#${listing.id}`,
      geohash,
      listingId: listing.id,
      ...listing,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }));
  console.log(`  Seeded listing: ${listing.id} (${listing.spotType}, geohash=${geohash})`);
}

async function putCompletedBooking() {
  await dynamo.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: `BOOKING#${COMPLETED_BOOKING_ID}`,
      SK: `BOOKING#${COMPLETED_BOOKING_ID}`,
      GSI1PK: `SPOTTER#${SPOTTER_ID}`,
      GSI1SK: `BOOKING#${COMPLETED_BOOKING_ID}`,
      bookingId: COMPLETED_BOOKING_ID,
      listingId: LISTINGS[0].id,
      hostId: HOST_ID,
      spotterId: SPOTTER_ID,
      startTime: twoHoursBeforeYesterday.toISOString(),
      endTime: yesterday.toISOString(),
      totalAmount: 7.0,
      status: 'COMPLETED',
      version: 1,
      idempotencyKey: `seed-${COMPLETED_BOOKING_ID}`,
      createdAt: twoHoursBeforeYesterday.toISOString(),
      updatedAt: yesterday.toISOString(),
    },
  }));
  console.log(`  Seeded completed booking: ${COMPLETED_BOOKING_ID}`);
}

async function deleteItem(pk: string, sk: string) {
  await dynamo.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: pk, SK: sk } }));
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed() {
  console.log(`\nSeeding ${environment} environment (table: ${TABLE_NAME})\n`);

  console.log('Creating Cognito users...');
  for (const user of TEST_USERS) {
    await createCognitoUser(user.email, user.password, user.role);
  }

  console.log('\nSeeding DynamoDB listings...');
  for (const listing of LISTINGS) {
    await putListing(listing);
  }

  console.log('\nSeeding completed booking...');
  await putCompletedBooking();

  console.log('\nDone. Test data seeded successfully.');
  console.log(`  COMPLETED_BOOKING_ID=${COMPLETED_BOOKING_ID}`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanupData() {
  console.log(`\nCleaning up ${environment} environment (table: ${TABLE_NAME})\n`);

  console.log('Deleting Cognito users...');
  for (const user of TEST_USERS) {
    await deleteCognitoUser(user.email);
  }

  console.log('\nDeleting DynamoDB listings...');
  for (const listing of LISTINGS) {
    await deleteItem(`LISTING#${listing.id}`, `LISTING#${listing.id}`);
    console.log(`  Deleted listing: ${listing.id}`);
  }

  console.log('\nDeleting completed booking...');
  await deleteItem(`BOOKING#${COMPLETED_BOOKING_ID}`, `BOOKING#${COMPLETED_BOOKING_ID}`);
  console.log(`  Deleted booking: ${COMPLETED_BOOKING_ID}`);

  console.log('\nCleanup complete.');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

(async () => {
  try {
    if (cleanup) {
      await cleanupData();
    } else {
      await seed();
    }
  } catch (err) {
    console.error('\nSeed script failed:', err);
    process.exit(1);
  }
})();
