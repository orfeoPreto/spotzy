import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import ngeohash from 'ngeohash';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, forbidden } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { listingMetadataKey } from '../../../shared/db/keys';
import { LISTING_TRANSLATION_EVENT_TYPE } from '../../../shared/locales/constants';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? 'default';

// Fields that cannot be updated
const IMMUTABLE = new Set(['listingId', 'hostId', 'PK', 'SK', 'GSI1PK', 'GSI1SK', 'createdAt']);

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('listing-update', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const listingId = event.pathParameters?.id;
  if (!listingId) { log.warn('validation failed', { reason: 'missing listingId' }); return badRequest('MISSING_REQUIRED_FIELD', { field: 'listingId' }); }

  log.info('update attempt', { listingId });

  const key = listingMetadataKey(listingId);
  const existing = await client.send(new GetCommand({ TableName: TABLE, Key: key }));
  if (!existing.Item) return notFound();

  const listing = existing.Item;
  if (listing.hostId !== claims.userId) {
    return forbidden();
  }

  const updates = JSON.parse(event.body ?? '{}');

  // Strip immutable fields
  const allowed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (!IMMUTABLE.has(k)) allowed[k] = v;
  }

  // Recompute geohash if address coords changed
  if (allowed.addressLat !== undefined || allowed.addressLng !== undefined) {
    const lat = (allowed.addressLat ?? listing.addressLat) as number;
    const lng = (allowed.addressLng ?? listing.addressLng) as number;
    allowed.geohash = ngeohash.encode(lat, lng, 5);
  }

  if (Object.keys(allowed).length === 0) return ok(listing);

  allowed.updatedAt = new Date().toISOString();

  const setExpressions = Object.keys(allowed).map((k) => `#${k} = :${k}`).join(', ');
  const names = Object.fromEntries(Object.keys(allowed).map((k) => [`#${k}`, k]));
  const values = Object.fromEntries(Object.entries(allowed).map(([k, v]) => [`:${k}`, v]));

  const result = await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: key,
    UpdateExpression: `SET ${setExpressions}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW',
  }));

  // Emit translation event if translatable fields changed
  const TRANSLATABLE_FIELDS = ['title', 'description', 'accessInstructions'];
  const changedTranslatableFields = TRANSLATABLE_FIELDS.filter(f => allowed[f] !== undefined);
  if (changedTranslatableFields.length > 0) {
    // Update *Translations maps for the changed fields with the new source text
    const originalLocale = listing.originalLocale ?? 'en';
    for (const field of changedTranslatableFields) {
      const translationsField = `${field}Translations`;
      const existingTranslations = (result.Attributes?.[translationsField] as Record<string, string>) ?? {};
      existingTranslations[originalLocale] = allowed[field] as string;
      // The translation Lambda will fill in the other locales async
    }

    eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'spotzy.listings',
        DetailType: LISTING_TRANSLATION_EVENT_TYPE,
        Detail: JSON.stringify({
          listingId,
          originalLocale,
          fieldsChanged: changedTranslatableFields,
          isPool: listing.isPool === true,
        }),
        EventBusName: EVENT_BUS_NAME,
      }],
    })).catch(err => log.error('EventBridge publish failed', err));
  }

  log.info('listing updated', { listingId, updatedFields: Object.keys(allowed) });
  return ok(result.Attributes ?? { ...listing, ...allowed });
};
