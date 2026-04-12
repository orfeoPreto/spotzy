import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { forbidden } from '../../../shared/utils/admin-response';
import { created, badRequest, unauthorized } from '../../../shared/utils/response';
import { disputeMessageKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractAdminClaims(event);
  const log = createLogger('admin-dispute-message', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('forbidden'); return forbidden(); }

  const disputeId = event.pathParameters?.id;
  if (!disputeId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'disputeId' });

  const body = JSON.parse(event.body ?? '{}');
  const content = body.text ?? body.content;
  if (!content) return badRequest('MISSING_REQUIRED_FIELD', { field: 'text' });

  const now = new Date().toISOString();
  const messageId = ulid();

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      ...disputeMessageKey(disputeId, now),
      messageId,
      disputeId,
      authorId: claims.userId,
      authorRole: 'ADMIN',
      content,
      createdAt: now,
    },
  }));

  log.info('admin message added', { disputeId, messageId });
  return created({ messageId, disputeId, content, createdAt: now });
};
