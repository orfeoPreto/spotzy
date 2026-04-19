import { APIGatewayProxyHandler } from 'aws-lambda';
import { createHash } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { ok, conflict, internalError } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognitoClient = new CognitoIdentityProviderClient({});
const s3 = new S3Client({});
const ses = new SESClient({});

const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? '';
const MEDIA_BUCKET = process.env.MEDIA_PUBLIC_BUCKET ?? '';
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'noreply@spotzy.be';

const ANON_PREFIX = 'ANONYMISED_USER_';
const getAnonId = (userId: string) =>
  ANON_PREFIX + createHash('sha256').update(userId).digest('hex').slice(0, 8);

const BLOCKING_STATUSES = ['PENDING', 'PENDING_PAYMENT', 'CONFIRMED', 'ACTIVE'];

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('gdpr-delete', event.requestContext.requestId);
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  log.info('account deletion requested', { userId });

  try {
    // 1. Pre-flight: check for active bookings (as spotter or host)
    const blockingBookings = await getBlockingBookings(userId);
    if (blockingBookings.length > 0) {
      return conflict('ACTIVE_BOOKINGS_EXIST', {
        blockingBookings: blockingBookings.map(b => ({
          bookingId: b.PK.replace('BOOKING#', ''),
          status: b.status,
          role: b.spotterId === userId ? 'SPOTTER' : 'HOST',
        })),
      });
    }

    // 2. Check for open disputes
    const openDisputes = await getOpenDisputes(userId);
    if (openDisputes.length > 0) {
      return conflict('OPEN_DISPUTES_EXIST', {
        disputeCount: openDisputes.length,
      });
    }

    const anonId = getAnonId(userId);
    const user = await getUser(userId);
    if (!user) return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'User not found' }) };

    // 3. Send confirmation email BEFORE anonymising
    try {
      await ses.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [user.email] },
        Message: {
          Subject: { Data: 'Your Spotzy account has been deleted' },
          Body: {
            Text: {
              Data: `Your account and personal data have been removed from Spotzy.\n\nPayment and booking records are retained for 7 years as required by Belgian accounting law (Code des sociétés). Your personal information has been replaced with an anonymous identifier — you cannot be identified from these records.\n\nIf you have questions, contact our Data Protection Officer at dpo@spotzy.be.`,
            },
          },
        },
      }));
    } catch (emailErr) {
      log.warn('failed to send deletion confirmation email', { error: emailErr });
      // Continue with deletion even if email fails
    }

    // 4. Run anonymisation pipeline
    await Promise.all([
      anonymiseUserRecord(userId, anonId),
      archiveUserListings(userId),
      anonymiseBookings(userId, anonId),
      anonymiseMessages(userId),
      anonymiseReviews(userId, anonId),
      deleteProfilePhoto(userId),
      revokeApiKeys(userId),
    ]);

    // 5. Cognito: disable then delete (order matters)
    try {
      await cognitoClient.send(new AdminDisableUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      }));
      await cognitoClient.send(new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      }));
    } catch (cognitoErr) {
      log.warn('cognito deletion failed', { error: cognitoErr });
    }

    // 6. Audit log
    await writeAuditLog(userId);

    log.info('account deletion complete', { userId, anonId });
    return ok({ message: 'Account deleted successfully' });
  } catch (err) {
    log.error('account deletion failed', err);
    return internalError();
  }
};

async function getBlockingBookings(userId: string) {
  const results: any[] = [];

  // As spotter
  const spotterBookings = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: '#s IN (:s1, :s2, :s3, :s4)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':pk': `SPOTTER#${userId}`,
      ':s1': 'PENDING', ':s2': 'PENDING_PAYMENT', ':s3': 'CONFIRMED', ':s4': 'ACTIVE',
    },
  }));
  if (spotterBookings.Items) results.push(...spotterBookings.Items.map(i => ({ ...i, spotterId: userId })));

  // As host
  const hostBookings = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: '#s IN (:s1, :s2, :s3, :s4)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':pk': `HOST#${userId}`,
      ':s1': 'PENDING', ':s2': 'PENDING_PAYMENT', ':s3': 'CONFIRMED', ':s4': 'ACTIVE',
    },
  }));
  if (hostBookings.Items) results.push(...hostBookings.Items);

  return results;
}

async function getOpenDisputes(userId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    FilterExpression: '#s IN (:s1, :s2)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':pk': `DISPUTES#${userId}`,
      ':s1': 'OPEN', ':s2': 'ESCALATED',
    },
  }));
  return result.Items ?? [];
}

async function getUser(userId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND SK = :sk',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': 'PROFILE' },
  }));
  return result.Items?.[0];
}

async function anonymiseUserRecord(userId: string, anonId: string) {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
    UpdateExpression: 'SET firstName = :a, lastName = :a, #n = :a, email = :a, phone = :a, pseudo = :a, profilePhotoUrl = :null, #s = :deleted, GSI1PK = :anonGsi, updatedAt = :now',
    ExpressionAttributeNames: { '#n': 'name', '#s': 'status' },
    ExpressionAttributeValues: {
      ':a': anonId,
      ':null': null,
      ':deleted': 'DELETED',
      ':anonGsi': `EMAIL#${anonId}`,
      ':now': new Date().toISOString(),
    },
  }));
}

async function archiveUserListings(userId: string) {
  const listings = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `HOST#${userId}` },
  }));

  const listingItems = (listings.Items ?? []).filter(i => i.SK === 'METADATA');
  for (const listing of listingItems) {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: listing.PK, SK: 'METADATA' },
      UpdateExpression: 'SET #s = :archived',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':archived': 'ARCHIVED' },
    }));
  }
}

async function anonymiseBookings(userId: string, anonId: string) {
  // As spotter
  const spotterBookings = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `SPOTTER#${userId}` },
  }));

  for (const booking of spotterBookings.Items ?? []) {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: booking.PK, SK: booking.SK },
      UpdateExpression: 'SET spotterName = :a',
      ExpressionAttributeValues: { ':a': anonId },
    }));
  }

  // As host
  const hostBookings = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `HOST#${userId}` },
  }));

  for (const booking of hostBookings.Items ?? []) {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: booking.PK, SK: booking.SK },
      UpdateExpression: 'SET hostName = :a',
      ExpressionAttributeValues: { ':a': anonId },
    }));
  }
}

async function anonymiseMessages(userId: string) {
  const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

  // Query messages sent by this user across all chats
  const messages = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `SENDER#${userId}` },
  }));

  for (const msg of messages.Items ?? []) {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: msg.PK, SK: msg.SK },
      UpdateExpression: 'SET senderName = :name, #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':name': 'Former user', ':ttl': oneYearFromNow },
    }));
  }
}

async function anonymiseReviews(userId: string, anonId: string) {
  const reviews = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `REVIEWER#${userId}` },
  }));

  for (const review of reviews.Items ?? []) {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: review.PK, SK: review.SK },
      UpdateExpression: 'SET authorName = :name',
      ExpressionAttributeValues: { ':name': 'Former user' },
    }));
  }
}

async function deleteProfilePhoto(userId: string) {
  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: `media/users/${userId}/profile.jpg`,
    }));
  } catch {
    // Ignore — photo may not exist
  }
}

async function revokeApiKeys(userId: string) {
  const keys = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'APIKEY#' },
  }));

  const now = new Date().toISOString();
  for (const key of keys.Items ?? []) {
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: key.PK, SK: key.SK },
      UpdateExpression: 'SET active = :f, revokedAt = :now',
      ExpressionAttributeValues: { ':f': false, ':now': now },
    }));
  }
}

async function writeAuditLog(userId: string) {
  const now = new Date().toISOString();
  const thirtyDaysTTL = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `AUDIT#GDPR#${userId}`, SK: now },
    UpdateExpression: 'SET #op = :op, deletedAt = :now, #ttl = :ttl',
    ExpressionAttributeNames: { '#op': 'operator', '#ttl': 'ttl' },
    ExpressionAttributeValues: { ':op': 'user', ':now': now, ':ttl': thirtyDaysTTL },
  }));
}
