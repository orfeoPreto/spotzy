import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ok, badRequest, notFound, conflict } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const round2 = (n: number) => Math.round(n * 100) / 100;

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('agent-quote', event.requestContext.requestId);
  const listingId = event.pathParameters?.listingId ?? event.pathParameters?.id;
  const { startTime, endTime } = event.queryStringParameters ?? {};

  if (!startTime || !endTime) return badRequest('startTime and endTime are required');
  if (new Date(endTime) <= new Date(startTime)) return badRequest('endTime must be after startTime');

  // Fetch listing
  const listingResult = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND SK = :sk',
    ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':sk': 'METADATA' },
  }));
  const listing = listingResult.Items?.[0];
  if (!listing) return notFound();

  // Check availability
  const blocks = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'AVAIL_BLOCK#' },
  }));

  const reqStart = new Date(startTime).getTime();
  const reqEnd = new Date(endTime).getTime();
  const isBlocked = (blocks.Items ?? []).some(b => {
    const bStart = new Date(b.startTime).getTime();
    const bEnd = new Date(b.endTime).getTime();
    return bStart < reqEnd && bEnd > reqStart;
  });

  if (isBlocked) return conflict('LISTING_UNAVAILABLE');

  const durationHours = (reqEnd - reqStart) / 3_600_000;
  const pricePerHour = listing.pricePerHour ?? (listing.pricePerDay ? listing.pricePerDay / 24 : 0);
  const subtotalEur = round2(pricePerHour * durationHours);
  const platformFeeEur = round2(subtotalEur * 0.15);
  const totalEur = round2(subtotalEur + platformFeeEur);

  const hoursUntilStart = (reqStart - Date.now()) / 3_600_000;
  let cancellationPolicy;
  if (hoursUntilStart > 24) {
    cancellationPolicy = { rule: 'FULL_REFUND', refundPercent: 100, refundEur: totalEur };
  } else if (hoursUntilStart > 12) {
    cancellationPolicy = { rule: 'PARTIAL_REFUND', refundPercent: 50, refundEur: round2(totalEur * 0.5) };
  } else {
    cancellationPolicy = { rule: 'NO_REFUND', refundPercent: 0, refundEur: 0 };
  }

  log.info('quote generated', { listingId, totalEur });
  return ok({
    listingId, startTime, endTime, durationHours,
    subtotalEur, platformFeeEur, totalEur, currency: 'EUR',
    cancellationPolicy,
  });
};
