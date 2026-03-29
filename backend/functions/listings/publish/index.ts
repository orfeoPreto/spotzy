import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { listingMetadataKey } from '../../../shared/db/keys';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

const forbidden = () => ({ statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) });

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('listing-publish', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const listingId = event.pathParameters?.id;
  if (!listingId) { log.warn('validation failed', { reason: 'missing listingId' }); return badRequest('Missing listing id'); }

  log.info('publish attempt', { listingId });

  const key = listingMetadataKey(listingId);
  const existing = await ddb.send(new GetCommand({ TableName: TABLE, Key: key }));
  if (!existing.Item) return notFound();

  const listing = existing.Item;
  if (listing.hostId !== claims.userId) return forbidden();

  // Completeness checks — collect all failures
  const failedChecks: string[] = [];

  const photos: Array<{ validationStatus: string }> = listing.photos ?? [];
  if (!photos.some((p) => p.validationStatus === 'PASS')) failedChecks.push('photoValidation');

  if (!listing.pricePerHour && !listing.pricePerDay && !listing.pricePerMonth) failedChecks.push('price');

  // Check availability rules exist
  if (!listing.hasAvailability) {
    const rulesRes = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'AVAIL_RULE#' },
      Select: 'COUNT',
    }));
    if ((rulesRes.Count ?? 0) === 0) failedChecks.push('availability');
  }

  if (failedChecks.length > 0) {
    log.warn('publish blocked: incomplete listing', { listingId, failedChecks });
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Listing is incomplete', failedChecks }) };
  }

  const now = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: key,
    UpdateExpression: 'SET #status = :status, publishedAt = :pub, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': 'live', ':pub': now, ':now': now },
  }));

  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS,
      Source: 'spotzy',
      DetailType: 'listing.published',
      Detail: JSON.stringify({ listingId, hostId: claims.userId }),
    }],
  }));

  log.info('listing published', { listingId });
  return ok({ listingId, status: 'live', publishedAt: now });
};
