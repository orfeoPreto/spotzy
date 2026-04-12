import { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ulid } from 'ulid';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { validateRCDocument } from '../../../shared/spot-manager/validation';

const s3 = new S3Client({});
const BUCKET = process.env.RC_DOCUMENTS_BUCKET ?? 'spotzy-rc-documents';

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('rc-submission-presign', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const body = JSON.parse(event.body ?? '{}');
  const { fileName, mimeType, sizeBytes } = body;

  if (!fileName || !mimeType || sizeBytes === undefined) {
    return badRequest('MISSING_REQUIRED_FIELD', { field: 'fileName, mimeType, sizeBytes' });
  }

  const docResult = validateRCDocument(mimeType, sizeBytes);
  if (!docResult.valid) {
    return badRequest(docResult.error!);
  }

  const ext = MIME_TO_EXT[mimeType] ?? 'bin';
  const timestamp = Date.now();
  const s3Key = `rc-uploads/${claims.userId}/${timestamp}-${ulid()}.${ext}`;

  // Note: SSE-S3 is enforced by the bucket's default encryption — no need to
  // include ServerSideEncryption in the signed command (doing so would require
  // the client to send an x-amz-server-side-encryption header too, which would
  // break the browser PUT flow).
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    ContentType: mimeType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  log.info('presigned url generated', { s3Key, mimeType, sizeBytes });
  return ok({ uploadUrl, s3Key });
};
