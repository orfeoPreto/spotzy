import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import ngeohash from 'ngeohash';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { extractClaims } from '../../../shared/utils/auth';
import { created, badRequest, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { listingByHostKey, userProfileKey } from '../../../shared/db/keys';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, ACTIVE_LOCALE_HEADER, LISTING_TRANSLATION_EVENT_TYPE } from '../../../shared/locales/constants';
import type { SupportedLocale } from '../../../shared/locales/constants';
import type { VATStatus } from '../../../shared/pricing/vat-constants';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? 'default';

const SPOT_TYPES = ['COVERED_GARAGE', 'CARPORT', 'DRIVEWAY', 'OPEN_SPACE'] as const;
type SpotType = typeof SPOT_TYPES[number];

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('listing-create', event.requestContext.requestId, claims?.userId);

  if (!claims) {
    log.warn('unauthorized');
    return unauthorized();
  }

  const body = JSON.parse(event.body ?? '{}');

  // Reject legacy pricing field — clients must use hostNetPricePerHourEur
  if (body.pricePerHourEur !== undefined) {
    log.warn('legacy pricing field rejected', { field: 'pricePerHourEur' });
    return badRequest('LEGACY_PRICING_FIELD_REJECTED', { field: 'pricePerHourEur' });
  }

  // Validate required fields
  if (!body.address) {
    log.warn('validation failed', { reason: 'missing address' });
    return badRequest('MISSING_REQUIRED_FIELD', { field: 'address' });
  }
  if (body.addressLat === undefined || body.addressLat === null) return badRequest('MISSING_REQUIRED_FIELD', { field: 'addressLat' });
  if (body.addressLng === undefined || body.addressLng === null) return badRequest('MISSING_REQUIRED_FIELD', { field: 'addressLng' });
  if (!body.spotType) { log.warn('validation failed', { reason: 'missing spotType' }); return badRequest('MISSING_REQUIRED_FIELD', { field: 'spotType' }); }
  if (!SPOT_TYPES.includes(body.spotType as SpotType)) { log.warn('validation failed', { reason: 'invalid spotType', spotType: body.spotType }); return badRequest('INVALID_SPOT_TYPE'); }
  if (body.pricePerHour === undefined && body.pricePerDay === undefined && body.pricePerMonth === undefined) {
    log.warn('validation failed', { reason: 'no price configured' });
    return badRequest('PRICE_REQUIRED');
  }
  if (body.description && body.description.length > 500) { log.warn('validation failed', { reason: 'description too long' }); return badRequest('FIELD_TOO_LONG', { field: 'description', maxLength: 500 }); }

  log.info('creating listing', { address: body.address, spotType: body.spotType });

  // Read user profile to get vatStatus; auto-set EXEMPT_FRANCHISE if NONE
  const profileResult = await client.send(new GetCommand({
    TableName: TABLE,
    Key: userProfileKey(claims.userId),
  }));
  let hostVatStatus: VATStatus = (profileResult.Item?.vatStatus as VATStatus) ?? 'NONE';

  if (hostVatStatus === 'NONE') {
    hostVatStatus = 'EXEMPT_FRANCHISE';
    await client.send(new UpdateCommand({
      TableName: TABLE,
      Key: userProfileKey(claims.userId),
      UpdateExpression: 'SET #vs = :vs, #updatedAt = :now',
      ExpressionAttributeNames: { '#vs': 'vatStatus', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':vs': 'EXEMPT_FRANCHISE', ':now': new Date().toISOString() },
    }));
    log.info('auto-set vatStatus to EXEMPT_FRANCHISE', { userId: claims.userId });
  }

  const listingId = ulid();
  const geohash = ngeohash.encode(body.addressLat, body.addressLng, 5);
  const now = new Date().toISOString();

  // Capture original locale from the active-locale header
  const rawLocale = event.headers?.[ACTIVE_LOCALE_HEADER] ?? event.headers?.['spotzy-active-locale'] ?? '';
  const originalLocale: SupportedLocale =
    (SUPPORTED_LOCALES as readonly string[]).includes(rawLocale) ? rawLocale as SupportedLocale : DEFAULT_LOCALE;

  const listing = {
    ...listingByHostKey(claims.userId, listingId),
    listingId,
    hostId: claims.userId,
    address: body.address,
    addressLat: body.addressLat,
    addressLng: body.addressLng,
    spotType: body.spotType,
    dimensions: body.dimensions,
    evCharging: body.evCharging ?? false,
    description: body.description,
    hostNetPricePerHourEur: body.hostNetPricePerHourEur ?? body.pricePerHour,
    hostVatStatusAtCreation: hostVatStatus,
    pricePerHour: body.pricePerHour,
    pricePerDay: body.pricePerDay,
    pricePerMonth: body.pricePerMonth,
    minDurationHours: body.minDurationHours,
    maxDurationHours: body.maxDurationHours,
    reclaimNoticeHours: body.reclaimNoticeHours,
    photos: [{ validationStatus: 'pending' }, { validationStatus: 'pending' }],
    status: 'draft',
    geohash,
    geohashPrecision: 5,
    originalLocale,
    titleTranslations: body.title ? { [originalLocale]: body.title } : undefined,
    descriptionTranslations: body.description ? { [originalLocale]: body.description } : undefined,
    accessInstructionsTranslations: body.accessInstructions ? { [originalLocale]: body.accessInstructions } : undefined,
    translationsLastComputedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await client.send(new PutCommand({ TableName: TABLE, Item: listing }));

  // Emit translation event (fire-and-forget — listing is already persisted)
  const translationFields = ['title', 'description', 'accessInstructions'].filter(f => body[f]);
  if (translationFields.length > 0) {
    eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'spotzy.listings',
        DetailType: LISTING_TRANSLATION_EVENT_TYPE,
        Detail: JSON.stringify({
          listingId,
          originalLocale,
          fieldsChanged: translationFields,
          isPool: body.isPool === true,
        }),
        EventBusName: EVENT_BUS_NAME,
      }],
    })).catch(err => log.error('EventBridge publish failed', err));
  }

  log.info('listing created', { listingId, spotType: body.spotType });
  return created(listing);
};
