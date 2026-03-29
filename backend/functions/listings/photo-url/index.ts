import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { listingMetadataKey } from '../../../shared/db/keys';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET ?? 'spotzy-media-uploads';
const VALID_CONTENT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const forbidden = () => ({ statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) });

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('listing-photo-url', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const listingId = event.pathParameters?.id;
  if (!listingId) return badRequest('Missing listing id');

  const body = JSON.parse(event.body ?? '{}');
  const photoIndex = parseInt(String(body.photoIndex), 10);
  const contentType: string = body.contentType ?? '';

  if (isNaN(photoIndex) || photoIndex < 0 || photoIndex > 1) {
    return badRequest('photoIndex must be 0 or 1 (max 2 photos per listing in MVP)');
  }
  if (!VALID_CONTENT_TYPES.has(contentType)) {
    return badRequest(`Invalid contentType. Must be one of: ${[...VALID_CONTENT_TYPES].join(', ')}`);
  }

  const key = listingMetadataKey(listingId);
  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: key }));
  if (!result.Item) return notFound();
  if (result.Item.hostId !== claims.userId) return forbidden();

  const s3Key = `listings/${listingId}/photos/${photoIndex}.jpg`;
  const command = new PutObjectCommand({
    Bucket: UPLOADS_BUCKET,
    Key: s3Key,
    ContentType: contentType,
    Tagging: 'validated=pending',
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  log.info('presigned url generated', { listingId, photoIndex, s3Key });
  return ok({ uploadUrl, key: s3Key });
};
