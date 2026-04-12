import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, notFound, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { generatePriceQuote } from '../../../shared/pricing/tiered-pricing';
import { listingMetadataKey } from '../../../shared/db/keys';
import type { TieredPricing } from '../../../shared/pricing/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('booking-quote', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return badRequest('INVALID_JSON_BODY');
  }

  const { listingId, startTime, endTime } = body;

  if (!listingId || typeof listingId !== 'string') {
    return badRequest('MISSING_REQUIRED_FIELD', { field: 'listingId' });
  }
  if (!startTime || typeof startTime !== 'string') {
    return badRequest('MISSING_REQUIRED_FIELD', { field: 'startTime' });
  }
  if (!endTime || typeof endTime !== 'string') {
    return badRequest('MISSING_REQUIRED_FIELD', { field: 'endTime' });
  }

  const start = new Date(startTime as string);
  const end = new Date(endTime as string);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return badRequest('INVALID_DATE_FORMAT');
  }

  if (end.getTime() <= start.getTime()) {
    return badRequest('INVALID_TIME_RANGE');
  }

  // Load listing
  const listingResult = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: listingMetadataKey(listingId as string),
  }));

  if (!listingResult.Item) {
    return notFound();
  }

  const listing = listingResult.Item;

  // Build pricing from listing
  const pricing: TieredPricing = {
    pricePerHourEur: listing.pricePerHourEur,
    dailyDiscountPct: listing.dailyDiscountPct,
    weeklyDiscountPct: listing.weeklyDiscountPct,
    monthlyDiscountPct: listing.monthlyDiscountPct,
  };

  const durationMs = end.getTime() - start.getTime();
  const durationHours = durationMs / (1000 * 60 * 60);

  const quote = generatePriceQuote(durationHours, pricing);

  log.info('quote generated', { listingId, durationHours, tier: quote.appliedTier });

  return ok(quote);
};
