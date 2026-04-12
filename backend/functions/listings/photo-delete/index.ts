import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, forbidden } from '../../../shared/utils/response';
import { listingMetadataKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const PUBLIC_BUCKET = process.env.PUBLIC_BUCKET ?? 'spotzy-media-public';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('listing-photo-delete', event.requestContext.requestId, claims?.userId);
  if (!claims) return unauthorized();

  const listingId = event.pathParameters?.id;
  const indexStr = event.pathParameters?.index;
  if (!listingId || indexStr === undefined) return badRequest('MISSING_REQUIRED_FIELD', { field: 'listingId, photoIndex' });

  const photoIndex = parseInt(indexStr, 10);
  if (isNaN(photoIndex) || photoIndex < 0) return badRequest('INVALID_PHOTO_INDEX');

  // Fetch listing
  const meta = await ddb.send(new GetCommand({ TableName: TABLE, Key: listingMetadataKey(listingId) }));
  if (!meta.Item) return notFound();
  if (meta.Item.hostId !== claims.userId) return forbidden();

  const photos: string[] = meta.Item.photos ?? [];

  if (photoIndex >= photos.length) {
    return badRequest('PHOTO_INDEX_OUT_OF_RANGE');
  }

  // Minimum 1 photo required
  if (photos.length <= 1) {
    return badRequest('MINIMUM_PHOTO_REQUIRED');
  }

  const photoKey = photos[photoIndex];

  // Remove photo at index, shift remaining
  const newPhotos = [...photos.slice(0, photoIndex), ...photos.slice(photoIndex + 1)];

  // Delete from S3 public bucket
  if (photoKey) {
    const s3Key = photoKey.startsWith('https://') ? photoKey.split('/').slice(3).join('/') : photoKey;
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: PUBLIC_BUCKET, Key: s3Key }));
    } catch (e) {
      log.warn('S3 delete failed (non-fatal)', { s3Key, error: String(e) });
    }
  }

  // Update listing record with new photos array
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: listingMetadataKey(listingId),
    UpdateExpression: 'SET photos = :p, updatedAt = :now',
    ExpressionAttributeValues: { ':p': newPhotos, ':now': new Date().toISOString() },
  }));

  log.info('photo deleted', { listingId, photoIndex, remaining: newPhotos.length });
  return ok({ deleted: true, photos: newPhotos });
};
