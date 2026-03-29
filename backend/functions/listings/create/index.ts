import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import ngeohash from 'ngeohash';
import { extractClaims } from '../../../shared/utils/auth';
import { created, badRequest, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { listingByHostKey } from '../../../shared/db/keys';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

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

  // Validate required fields
  if (!body.address) {
    log.warn('validation failed', { reason: 'missing address' });
    return badRequest('Missing required field: address');
  }
  if (body.addressLat === undefined || body.addressLat === null) return badRequest('Missing required field: addressLat');
  if (body.addressLng === undefined || body.addressLng === null) return badRequest('Missing required field: addressLng');
  if (!body.spotType) { log.warn('validation failed', { reason: 'missing spotType' }); return badRequest('Missing required field: spotType'); }
  if (!SPOT_TYPES.includes(body.spotType as SpotType)) { log.warn('validation failed', { reason: 'invalid spotType', spotType: body.spotType }); return badRequest(`Invalid spotType. Must be one of: ${SPOT_TYPES.join(', ')}`); }
  if (body.pricePerHour === undefined && body.pricePerDay === undefined && body.pricePerMonth === undefined) {
    log.warn('validation failed', { reason: 'no price configured' });
    return badRequest('At least one price is required');
  }
  if (body.description && body.description.length > 500) { log.warn('validation failed', { reason: 'description too long' }); return badRequest('Description exceeds 500 characters'); }

  log.info('creating listing', { address: body.address, spotType: body.spotType });

  const listingId = ulid();
  const geohash = ngeohash.encode(body.addressLat, body.addressLng, 5);
  const now = new Date().toISOString();

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
    createdAt: now,
    updatedAt: now,
  };

  await client.send(new PutCommand({ TableName: TABLE, Item: listing }));

  log.info('listing created', { listingId, spotType: body.spotType });
  return created(listing);
};
