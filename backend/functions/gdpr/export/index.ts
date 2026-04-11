import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ok, internalError } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const EXPORTS_BUCKET = process.env.GDPR_EXPORTS_BUCKET ?? 'spotzy-gdpr-exports';

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('gdpr-export', event.requestContext.requestId);
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  log.info('data export requested', { userId });

  try {
    const exportData = await buildExport(userId);

    const key = `gdpr-exports/${userId}/${Date.now()}.json`;
    await s3.send(new PutObjectCommand({
      Bucket: EXPORTS_BUCKET,
      Key: key,
      Body: JSON.stringify(exportData, null, 2),
      ContentType: 'application/json',
      Metadata: { 'user-id': userId },
    }));

    const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: EXPORTS_BUCKET,
      Key: key,
    }), { expiresIn: 86400 }); // 24 hours

    // Audit log
    const now = new Date().toISOString();
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `AUDIT#GDPR#${userId}`,
        SK: `EXPORT#${now}`,
        requestedAt: now,
        exportKey: key,
        ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days
      },
    }));

    log.info('data export complete', { userId, key });
    return ok({ downloadUrl, expiresIn: '24 hours' });
  } catch (err) {
    log.error('data export failed', err);
    return internalError();
  }
};

async function buildExport(userId: string) {
  const [profile, bookings, listings, messages, reviews, disputes, preferences] = await Promise.all([
    getUserProfile(userId),
    getUserBookings(userId),
    getUserListings(userId),
    getUserMessages(userId),
    getUserReviews(userId),
    getUserDisputes(userId),
    getUserPreferences(userId),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile,
    bookings,
    listings,
    messages,
    reviews,
    disputes,
    preferences,
  };
}

async function getUserProfile(userId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND SK = :sk',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': 'PROFILE' },
  }));
  const profile = result.Items?.[0];
  if (!profile) return null;
  // Strip internal fields
  const { PK, SK, GSI1PK, GSI1SK, ...clean } = profile;
  return clean;
}

async function getUserBookings(userId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `SPOTTER#${userId}` },
  }));
  return (result.Items ?? []).map(({ PK, SK, GSI1PK, GSI1SK, ...clean }) => clean);
}

async function getUserListings(userId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `HOST#${userId}` },
  }));
  return (result.Items ?? [])
    .filter(i => i.SK === 'METADATA')
    .map(({ PK, SK, GSI1PK, GSI1SK, geohash, ...clean }) => clean);
}

async function getUserMessages(userId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `SENDER#${userId}` },
  }));
  return (result.Items ?? []).map(({ PK, SK, GSI1PK, GSI1SK, ...clean }) => clean);
}

async function getUserReviews(userId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `REVIEWER#${userId}` },
  }));
  return (result.Items ?? []).map(({ PK, SK, GSI1PK, GSI1SK, ...clean }) => clean);
}

async function getUserDisputes(userId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `DISPUTES#${userId}` },
  }));
  return (result.Items ?? []).map(({ PK, SK, GSI1PK, GSI1SK, ...clean }) => clean);
}

async function getUserPreferences(userId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND SK = :sk',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': 'PREFERENCES' },
  }));
  const prefs = result.Items?.[0];
  if (!prefs) return null;
  const { PK, SK, ...clean } = prefs;
  return clean;
}
