import { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const s3 = new S3Client({});
const UPLOADS_BUCKET = process.env.UPLOADS_BUCKET ?? 'spotzy-media-uploads';
const MEDIA_URL = process.env.MEDIA_URL ?? '';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('user-photo-url', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const userId = claims.userId;
  const s3Key = `media/users/${userId}/profile.jpg`;

  const command = new PutObjectCommand({
    Bucket: UPLOADS_BUCKET,
    Key: s3Key,
    ContentType: 'image/jpeg',
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  const publicUrl = MEDIA_URL ? `${MEDIA_URL}/${s3Key}` : `https://${UPLOADS_BUCKET}.s3.amazonaws.com/${s3Key}`;

  log.info('presigned url generated', { userId, s3Key });
  return ok({ uploadUrl, key: s3Key, publicUrl });
};
