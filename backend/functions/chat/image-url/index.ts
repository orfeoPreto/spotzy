import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound } from '../../../shared/utils/response';
import { bookingMetadataKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET ?? 'spotzy-media-uploads';
const PUBLIC_BUCKET = process.env.PUBLIC_BUCKET ?? 'spotzy-media-public';
const URL_EXPIRY_SECONDS = 300;

const forbidden = () => ({
  statusCode: 403,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ error: 'Forbidden — you are not a party to this booking' }),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('chat-image-url', event.requestContext.requestId, claims?.userId);
  if (!claims) return unauthorized();

  const bookingId = event.pathParameters?.bookingId;
  if (!bookingId) return badRequest('Missing bookingId');

  // Fetch booking to verify the caller is a party (host or spotter)
  const bookingRes = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: bookingMetadataKey(bookingId),
  }));
  if (!bookingRes.Item) return notFound();

  const booking = bookingRes.Item;
  const isParty = booking.spotterId === claims.userId || booking.hostId === claims.userId;
  if (!isParty) {
    log.warn('non-party tried to get chat image URL', { bookingId, userId: claims.userId });
    return forbidden();
  }

  const messageId = ulid();
  const s3Key = `chat/${bookingId}/${messageId}.jpg`;
  const publicUrl = `https://${PUBLIC_BUCKET}.s3.amazonaws.com/${s3Key}`;

  // Generate pre-signed PUT URL (expires in 5 minutes)
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: UPLOADS_BUCKET,
      Key: s3Key,
      ContentType: 'image/jpeg',
    }),
    { expiresIn: URL_EXPIRY_SECONDS },
  );

  log.info('chat image URL generated', { bookingId, messageId });
  return ok({ uploadUrl, key: s3Key, publicUrl });
};
