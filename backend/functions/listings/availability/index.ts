import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, QueryCommand,
  BatchWriteCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, forbidden } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { listingMetadataKey, availRuleKey } from '../../../shared/db/keys';
import { AvailabilityRule } from '../../../shared/types/availability';
import { isWithinAvailabilityRules } from '../../../shared/availability/resolver';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';


// ---------------------------------------------------------------------------
// GET /api/v1/listings/{id}/availability  (public)
// ---------------------------------------------------------------------------
export const getHandler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('listing-availability-get', event.requestContext.requestId);
  const listingId = event.pathParameters?.id;
  if (!listingId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'listingId' });

  // Verify listing exists
  const meta = await ddb.send(new GetCommand({ TableName: TABLE, Key: listingMetadataKey(listingId) }));
  if (!meta.Item) { log.warn('listing not found', { listingId }); return notFound(); }

  const rules = await fetchRules(listingId);

  const type = rules.length === 0 ? 'NONE'
    : rules.some((r) => r.type === 'ALWAYS') ? 'ALWAYS'
    : 'WEEKLY';

  log.info('availability fetched', { listingId, ruleCount: rules.length, type });
  return ok({ listingId, type, rules });
};

// ---------------------------------------------------------------------------
// PUT /api/v1/listings/{id}/availability  (auth required)
// ---------------------------------------------------------------------------
export const putHandler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('listing-availability-put', event.requestContext.requestId, claims?.userId);
  if (!claims) return unauthorized();

  const listingId = event.pathParameters?.id;
  if (!listingId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'listingId' });

  const body = JSON.parse(event.body ?? '{}') as {
    type?: string;
    rules?: Array<{ daysOfWeek: number[]; startTime: string; endTime: string }>;
  };

  // Verify ownership
  const meta = await ddb.send(new GetCommand({ TableName: TABLE, Key: listingMetadataKey(listingId) }));
  if (!meta.Item) return notFound();
  if (meta.Item.hostId !== claims.userId) return forbidden();

  const inputType = body.type ?? 'WEEKLY';

  if (inputType === 'ALWAYS') {
    // Single ALWAYS rule — no time validation needed
    await replaceRules(listingId, [{ type: 'ALWAYS', daysOfWeek: [], startTime: '', endTime: '' }]);
    await markHasAvailability(listingId);
    log.info('always rule saved', { listingId });
    return ok({ listingId, type: 'ALWAYS', rules: await fetchRules(listingId) });
  }

  // WEEKLY validation
  const inputRules = body.rules ?? [];
  if (inputRules.length === 0) {
    return badRequest('NO_RULES_PROVIDED');
  }
  if (inputRules.length > 14) {
    return badRequest('TOO_MANY_RULES', { maxRules: 14 });
  }

  // Validate each rule
  for (const r of inputRules) {
    const start = parseTime(r.startTime);
    const end = parseTime(r.endTime);
    if (isNaN(start) || isNaN(end)) {
      return badRequest('INVALID_TIME_RANGE');
    }
    if (end <= start) {
      return badRequest('INVALID_TIME_RANGE');
    }
  }

  // Check for overlapping rules on the same day
  for (let i = 0; i < inputRules.length; i++) {
    for (let j = i + 1; j < inputRules.length; j++) {
      const a = inputRules[i];
      const b = inputRules[j];
      const sharedDays = a.daysOfWeek.filter((d) => b.daysOfWeek.includes(d));
      if (sharedDays.length === 0) continue;
      const aStart = parseTime(a.startTime); const aEnd = parseTime(a.endTime);
      const bStart = parseTime(b.startTime); const bEnd = parseTime(b.endTime);
      if (aStart < bEnd && aEnd > bStart) {
        return badRequest('OVERLAPPING_RULES');
      }
    }
  }

  // Booking conflict check for LIVE listings
  if (meta.Item.status === 'live') {
    const newRules: AvailabilityRule[] = inputRules.map((r) => ({
      ruleId: 'tmp', listingId, type: 'WEEKLY' as const,
      daysOfWeek: r.daysOfWeek, startTime: r.startTime, endTime: r.endTime,
      createdAt: '', updatedAt: '',
    }));

    const ninetyDaysOut = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const bookingQuery = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: '#status IN (:c, :a)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':pk': `LISTING#${listingId}`,
        ':prefix': 'BOOKING#',
        ':c': 'CONFIRMED',
        ':a': 'ACTIVE',
      },
    }));

    const conflicting = (bookingQuery.Items ?? []).filter((b) => {
      if (b.startTime > ninetyDaysOut) return false;
      const { covered } = isWithinAvailabilityRules(newRules, new Date(b.startTime), new Date(b.endTime));
      return !covered;
    });

    if (conflicting.length > 0) {
      log.warn('booking conflict', { listingId, conflictCount: conflicting.length });
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          code: 'BOOKING_CONFLICT',
          message: 'New availability rules would remove coverage for confirmed bookings',
          conflictingBookings: conflicting.map((b) => ({
            bookingId: b.bookingId, startTime: b.startTime, endTime: b.endTime,
          })),
        }),
      };
    }
  }

  const rulesPayload = inputRules.map((r) => ({
    type: 'WEEKLY' as const, daysOfWeek: r.daysOfWeek,
    startTime: r.startTime, endTime: r.endTime,
  }));
  await replaceRules(listingId, rulesPayload);
  await markHasAvailability(listingId);

  log.info('weekly rules saved', { listingId, count: rulesPayload.length });
  return ok({ listingId, type: 'WEEKLY', rules: await fetchRules(listingId) });
};

// Default export for CDK handler resolution (GET)
export const handler = getHandler;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTime(hhmm: string): number {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

async function fetchRules(listingId: string): Promise<AvailabilityRule[]> {
  const res = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'AVAIL_RULE#' },
  }));
  return (res.Items ?? []) as AvailabilityRule[];
}

async function replaceRules(
  listingId: string,
  rules: Array<{ type: 'ALWAYS' | 'WEEKLY'; daysOfWeek: number[]; startTime: string; endTime: string }>,
): Promise<void> {
  const now = new Date().toISOString();

  // Delete existing rules
  const existing = await fetchRules(listingId);
  if (existing.length > 0) {
    // BatchWrite can handle 25 items at a time
    for (let i = 0; i < existing.length; i += 25) {
      const chunk = existing.slice(i, i + 25);
      await ddb.send(new BatchWriteCommand({
        RequestItems: {
          [TABLE]: chunk.map((r) => ({
            DeleteRequest: { Key: availRuleKey(listingId, r.ruleId) },
          })),
        },
      }));
    }
  }

  // Write new rules
  const newRules = rules.map((r) => ({
    ...availRuleKey(listingId, ulid()),
    ruleId: ulid(),
    listingId,
    type: r.type,
    daysOfWeek: r.daysOfWeek,
    startTime: r.startTime,
    endTime: r.endTime,
    createdAt: now,
    updatedAt: now,
  }));

  for (let i = 0; i < newRules.length; i += 25) {
    const chunk = newRules.slice(i, i + 25);
    await ddb.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE]: chunk.map((item) => ({ PutRequest: { Item: item } })),
      },
    }));
  }
}

async function markHasAvailability(listingId: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: listingMetadataKey(listingId),
    UpdateExpression: 'SET hasAvailability = :t, availabilityUpdatedAt = :now',
    ExpressionAttributeValues: { ':t': true, ':now': new Date().toISOString() },
  }));
}
