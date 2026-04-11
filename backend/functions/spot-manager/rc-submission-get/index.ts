import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extractClaims } from '../../../shared/utils/auth';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { ok, unauthorized, notFound } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUCKET = process.env.RC_DOCUMENTS_BUCKET ?? 'spotzy-rc-documents';

const forbidden = () => ({
  statusCode: 403,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ error: 'Forbidden' }),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const adminClaims = extractAdminClaims(event);
  const log = createLogger('rc-submission-get', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const submissionId = event.pathParameters?.submissionId;
  if (!submissionId) return notFound();

  // Try to get by the caller's userId first
  let userId = claims.userId;

  // If admin, allow looking up by query param userId
  const queryUserId = event.queryStringParameters?.userId;
  if (queryUserId && queryUserId !== claims.userId) {
    if (!adminClaims) {
      log.warn('forbidden: non-admin trying to access other user submission');
      return forbidden();
    }
    userId = queryUserId;
    log.info('admin access', { adminId: claims.userId, targetUserId: userId, submissionId });
  }

  const result = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USER#${userId}`, SK: `RCSUBMISSION#${submissionId}` },
  }));

  if (!result.Item) {
    log.warn('not found', { submissionId, userId });
    return notFound();
  }

  const submission = result.Item;

  // Verify ownership if not admin
  if (submission.userId !== claims.userId && !adminClaims) {
    log.warn('forbidden', { submissionId });
    return forbidden();
  }

  // Generate presigned GET URL for the document
  const documentUrl = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: BUCKET,
    Key: submission.documentS3Key,
  }), { expiresIn: 300 });

  log.info('submission fetched', { submissionId, status: submission.status });
  return ok({ ...submission, documentUrl });
};
