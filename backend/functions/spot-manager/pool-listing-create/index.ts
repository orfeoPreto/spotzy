import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import ngeohash from 'ngeohash';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { extractClaims } from '../../../shared/utils/auth';
import { created, badRequest, unauthorized, internalError } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, ACTIVE_LOCALE_HEADER, LISTING_TRANSLATION_EVENT_TYPE } from '../../../shared/locales/constants';
import type { SupportedLocale } from '../../../shared/locales/constants';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? 'default';

const SPOT_TYPES = ['COVERED_GARAGE', 'CARPORT', 'DRIVEWAY', 'OPEN_SPACE'] as const;
const MIN_BAY_COUNT = 2;
const MAX_BAY_COUNT = 200;
const MIN_PHOTOS = 2;
const TRANSACT_CHUNK_SIZE = 100;

/**
 * Generates a bay label like "A1", "A2", ..., "B1", "B2", etc.
 */
export function generateBayLabel(index: number): string {
  const letter = String.fromCharCode(65 + Math.floor(index / 26));
  const number = (index % 26) + 1;
  return `${letter}${number}`;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('pool-listing-create', event.requestContext.requestId, claims?.userId);

  if (!claims) {
    log.warn('unauthorized');
    return unauthorized();
  }

  // Check spotManagerStatus
  const userResult = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USER#${claims.userId}`, SK: 'PROFILE' },
  }));
  const user = userResult.Item;
  if (!user || !['STAGED', 'ACTIVE'].includes(user.spotManagerStatus)) {
    log.warn('spot manager status invalid', { status: user?.spotManagerStatus });
    return badRequest('SPOT_MANAGER_STATUS_REQUIRED');
  }

  let body: any;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return badRequest('INVALID_JSON_BODY');
  }

  // Validate required fields
  if (!body.address) return badRequest('MISSING_REQUIRED_FIELD', { field: 'address' });
  if (body.addressLat === undefined || body.addressLat === null) return badRequest('MISSING_REQUIRED_FIELD', { field: 'addressLat' });
  if (body.addressLng === undefined || body.addressLng === null) return badRequest('MISSING_REQUIRED_FIELD', { field: 'addressLng' });
  if (!body.spotType) return badRequest('MISSING_REQUIRED_FIELD', { field: 'spotType' });
  if (!SPOT_TYPES.includes(body.spotType)) return badRequest('INVALID_SPOT_TYPE');
  // Accept both legacy (pricePerHour) and tiered (pricePerHourEur + discount pcts)
  const pricePerHourEur = body.pricePerHourEur ?? body.pricePerHour;
  if (pricePerHourEur === undefined || pricePerHourEur === null) {
    return badRequest('MISSING_REQUIRED_FIELD', { field: 'pricePerHourEur' });
  }
  if (typeof pricePerHourEur !== 'number' || pricePerHourEur <= 0 || pricePerHourEur >= 1000) {
    return badRequest('INVALID_PRICE_PER_HOUR');
  }
  const ALLOWED_DISCOUNTS = [0.50, 0.60, 0.70];
  const dailyDiscountPct = body.dailyDiscountPct ?? 0.60;
  const weeklyDiscountPct = body.weeklyDiscountPct ?? 0.60;
  const monthlyDiscountPct = body.monthlyDiscountPct ?? 0.60;
  for (const [name, val] of [['dailyDiscountPct', dailyDiscountPct], ['weeklyDiscountPct', weeklyDiscountPct], ['monthlyDiscountPct', monthlyDiscountPct]] as const) {
    if (!ALLOWED_DISCOUNTS.includes(val)) {
      return badRequest('INVALID_DISCOUNT_VALUE', { field: name as string });
    }
  }

  // Validate bayCount
  const bayCount = body.bayCount;
  if (bayCount === undefined || bayCount === null) return badRequest('MISSING_REQUIRED_FIELD', { field: 'bayCount' });
  if (!Number.isInteger(bayCount) || bayCount < MIN_BAY_COUNT || bayCount > MAX_BAY_COUNT) {
    return badRequest('INVALID_BAY_COUNT');
  }

  // Photos are optional at pool creation — Spot Manager can add them afterward
  // via the "Manage photos" modal in the portfolio. Initialize two pending
  // slots so the Rekognition-backed photo validation pipeline can fill them
  // in after the Spot Manager uploads images to the listing.
  const photos: unknown[] = Array.isArray(body.photos) && body.photos.length > 0
    ? body.photos
    : [{ validationStatus: 'pending' }, { validationStatus: 'pending' }];

  // Validate bayLabels if provided
  if (body.bayLabels) {
    if (!Array.isArray(body.bayLabels) || body.bayLabels.length !== bayCount) {
      return badRequest('BAY_LABELS_COUNT_MISMATCH');
    }
    const uniqueLabels = new Set(body.bayLabels);
    if (uniqueLabels.size !== body.bayLabels.length) {
      return badRequest('DUPLICATE_BAY_LABELS');
    }
  }

  // Validate bayAccessInstructions if provided
  if (body.bayAccessInstructions) {
    if (!Array.isArray(body.bayAccessInstructions) || body.bayAccessInstructions.length !== bayCount) {
      return badRequest('BAY_ACCESS_INSTRUCTIONS_COUNT_MISMATCH');
    }
  }

  log.info('creating pool listing', { address: body.address, bayCount });

  const poolListingId = ulid();
  const now = new Date().toISOString();

  // Capture original locale from header
  const rawLocale = event.headers?.[ACTIVE_LOCALE_HEADER] ?? event.headers?.['spotzy-active-locale'] ?? '';
  const originalLocale: SupportedLocale =
    (SUPPORTED_LOCALES as readonly string[]).includes(rawLocale) ? rawLocale as SupportedLocale : DEFAULT_LOCALE;
  // geohash is required by GSI2 for geographic search. Precision 5 matches the
  // single-spot listings/create Lambda.
  const geohash = ngeohash.encode(body.addressLat, body.addressLng, 5);

  const listing: Record<string, any> = {
    PK: `LISTING#${poolListingId}`,
    SK: 'METADATA',
    GSI1PK: `HOST#${claims.userId}`,
    GSI1SK: `LISTING#${poolListingId}`,
    listingId: poolListingId,
    hostId: claims.userId,
    address: body.address,
    addressLat: body.addressLat,
    addressLng: body.addressLng,
    geohash,
    geohashPrecision: 5,
    spotType: body.spotType,
    photos,
    pricePerHour: pricePerHourEur,                // legacy alias for search/display
    pricePerHourEur,                               // Session 28 tiered
    dailyDiscountPct,
    weeklyDiscountPct,
    monthlyDiscountPct,
    description: body.description,
    dimensions: body.dimensions,
    evCharging: body.evCharging ?? false,
    isPool: true,
    bayCount,
    blockReservationsOptedIn: false,
    originalLocale,
    titleTranslations: body.title ? { [originalLocale]: body.title } : undefined,
    descriptionTranslations: body.description ? { [originalLocale]: body.description } : undefined,
    accessInstructionsTranslations: body.accessInstructions ? { [originalLocale]: body.accessInstructions } : undefined,
    translationsLastComputedAt: null,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };

  // Generate bays
  const bays: Record<string, any>[] = [];
  for (let i = 0; i < bayCount; i++) {
    const bayId = ulid();
    const label = body.bayLabels ? body.bayLabels[i] : generateBayLabel(i);
    const accessInstructions = body.bayAccessInstructions ? body.bayAccessInstructions[i] : undefined;

    const bay: Record<string, any> = {
      PK: `LISTING#${poolListingId}`,
      SK: `BAY#${bayId}`,
      bayId,
      poolListingId,
      label,
      originalLocale,
      labelTranslations: { [originalLocale]: label },
      accessInstructionsTranslations: null,
      translationsLastComputedAt: null,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    if (accessInstructions) {
      bay.accessInstructions = accessInstructions;
      bay.accessInstructionsTranslations = { [originalLocale]: accessInstructions };
    }
    bays.push(bay);
  }

  // Build TransactWriteItems, chunking if > 100 items
  const allItems = [listing, ...bays];
  try {
    for (let i = 0; i < allItems.length; i += TRANSACT_CHUNK_SIZE) {
      const chunk = allItems.slice(i, i + TRANSACT_CHUNK_SIZE);
      await client.send(new TransactWriteCommand({
        TransactItems: chunk.map((item) => ({
          Put: { TableName: TABLE, Item: item },
        })),
      }));
    }
  } catch (err) {
    log.error('failed to create pool listing', err);
    return internalError();
  }

  // Emit translation event (fire-and-forget)
  const translationFields = ['title', 'description', 'accessInstructions'].filter(f => body[f]);
  if (translationFields.length > 0) {
    eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'spotzy.listings',
        DetailType: LISTING_TRANSLATION_EVENT_TYPE,
        Detail: JSON.stringify({
          listingId: poolListingId,
          originalLocale,
          fieldsChanged: translationFields,
          isPool: true,
        }),
        EventBusName: EVENT_BUS_NAME,
      }],
    })).catch(err => log.error('EventBridge publish failed', err));
  }

  log.info('pool listing created', { listingId: poolListingId, bayCount });

  return created({
    listing,
    bays,
  });
};
