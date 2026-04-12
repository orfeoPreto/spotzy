import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, conflict } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const VALID_BAY_STATUSES = ['ACTIVE', 'TEMPORARILY_CLOSED', 'PERMANENTLY_REMOVED'] as const;
const ACTIVE_BOOKING_STATUSES = new Set(['CONFIRMED', 'ACTIVE', 'PENDING_PAYMENT']);
const UPCOMING_BOOKING_STATUSES = new Set(['CONFIRMED', 'ACTIVE', 'PENDING_PAYMENT']);

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('pool-bay-update', event.requestContext.requestId, claims?.userId);

  if (!claims) {
    log.warn('unauthorized');
    return unauthorized();
  }

  const poolId = event.pathParameters?.poolId;
  const bayId = event.pathParameters?.bayId;
  if (!poolId || !bayId) return badRequest('MISSING_REQUIRED_FIELD', { field: 'poolId, bayId' });

  // Verify pool ownership
  const listingResult = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `LISTING#${poolId}`, SK: 'METADATA' },
  }));
  const listing = listingResult.Item;
  if (!listing) return notFound();
  if (listing.hostId !== claims.userId) {
    log.warn('not pool owner', { poolId, userId: claims.userId });
    return unauthorized();
  }
  if (!listing.isPool) return badRequest('NOT_A_POOL_LISTING');

  // Verify bay existence
  const bayResult = await client.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `LISTING#${poolId}`, SK: `BAY#${bayId}` },
  }));
  const bay = bayResult.Item;
  if (!bay) return notFound();

  let body: any;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return badRequest('INVALID_JSON_BODY');
  }

  const { label, accessInstructions, status } = body;

  // Validate status if provided
  if (status !== undefined && !VALID_BAY_STATUSES.includes(status)) {
    return badRequest('INVALID_BAY_STATUS');
  }

  // Label uniqueness check within pool
  if (label !== undefined) {
    const baysResult = await client.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `LISTING#${poolId}`, ':prefix': 'BAY#' },
    }));
    const existingBay = (baysResult.Items ?? []).find(
      (b) => b.label === label && b.bayId !== bayId
    );
    if (existingBay) {
      return conflict('DUPLICATE_BAY_LABEL');
    }
  }

  // Status transition validation
  if (status === 'TEMPORARILY_CLOSED' || status === 'PERMANENTLY_REMOVED') {
    const bookingsResult = await client.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `LISTING#${poolId}`, ':prefix': 'BOOKING#' },
    }));
    const bookings = bookingsResult.Items ?? [];
    const now = new Date().toISOString();

    if (status === 'TEMPORARILY_CLOSED') {
      // Check no active bookings on this bay
      const activeBooking = bookings.find(
        (b) => b.poolSpotId === bayId && ACTIVE_BOOKING_STATUSES.has(b.status) && b.endTime > now
      );
      if (activeBooking) {
        return conflict('BAY_HAS_ACTIVE_BOOKINGS');
      }
    }

    if (status === 'PERMANENTLY_REMOVED') {
      // Check no active or upcoming bookings
      const blockingBooking = bookings.find(
        (b) => b.poolSpotId === bayId && UPCOMING_BOOKING_STATUSES.has(b.status) && b.endTime > now
      );
      if (blockingBooking) {
        return conflict('BAY_HAS_BOOKINGS');
      }
    }
  }

  // Build update expression
  const updateExprParts: string[] = [];
  const exprAttrNames: Record<string, string> = {};
  const exprAttrValues: Record<string, any> = {};

  if (label !== undefined) {
    updateExprParts.push('#label = :label');
    exprAttrNames['#label'] = 'label';
    exprAttrValues[':label'] = label;
  }
  if (accessInstructions !== undefined) {
    updateExprParts.push('#ai = :ai');
    exprAttrNames['#ai'] = 'accessInstructions';
    exprAttrValues[':ai'] = accessInstructions;
  }
  if (status !== undefined) {
    updateExprParts.push('#status = :status');
    exprAttrNames['#status'] = 'status';
    exprAttrValues[':status'] = status;
  }

  if (updateExprParts.length === 0) {
    return badRequest('NO_UPDATE_FIELDS');
  }

  updateExprParts.push('updatedAt = :now');
  exprAttrValues[':now'] = new Date().toISOString();

  const result = await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `LISTING#${poolId}`, SK: `BAY#${bayId}` },
    UpdateExpression: `SET ${updateExprParts.join(', ')}`,
    ExpressionAttributeNames: Object.keys(exprAttrNames).length > 0 ? exprAttrNames : undefined,
    ExpressionAttributeValues: exprAttrValues,
    ReturnValues: 'ALL_NEW',
  }));

  log.info('bay updated', { poolId, bayId, updates: Object.keys(body) });

  return ok(result.Attributes);
};
