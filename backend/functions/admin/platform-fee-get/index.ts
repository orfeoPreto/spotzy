import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { forbidden } from '../../../shared/utils/admin-response';
import { ok } from '../../../shared/utils/response';
import { readPlatformFeeConfig } from '../../../shared/platform-fee/read';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractAdminClaims(event);
  const log = createLogger('admin-platform-fee-get', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('forbidden'); return forbidden(); }

  const config = await readPlatformFeeConfig(ddb, TABLE);

  log.info('platform fee config fetched');
  return ok(config);
};
