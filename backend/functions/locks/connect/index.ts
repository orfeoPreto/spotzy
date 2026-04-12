import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ok, badRequest, notFound, forbidden } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('lock-connect', event.requestContext.requestId);
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) return { statusCode: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Unauthorized' }) };

  const listingId = event.pathParameters?.id;
  if (!listingId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'listingId' });

  const { provider, lockId, deviceName } = JSON.parse(event.body ?? '{}');
  if (!provider || !lockId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'provider, lockId' });

  // Verify listing ownership
  const listing = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `LISTING#${listingId}`, SK: 'METADATA' },
  }));
  if (!listing.Item) return notFound();
  if (listing.Item.hostId !== userId) {
    return forbidden();
  }

  const now = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `LISTING#${listingId}`, SK: 'LOCK',
      lockId, provider, deviceName: deviceName ?? 'Smart Lock',
      connectedAt: now, status: 'CONNECTED',
    },
  }));

  log.info('lock connected', { listingId, lockId, provider });
  return ok({ listingId, lockId, provider, status: 'CONNECTED', connectedAt: now });
};
