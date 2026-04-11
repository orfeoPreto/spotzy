import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, conflict } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const forbidden = (message: string) => ({
  statusCode: 403,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ error: message }),
});

/**
 * PATCH /api/v1/listings/{poolId}/block-reservations
 *
 * Toggles a Spot Pool's participation in block reservation matching and sets
 * the risk share mode. Writes the LISTING# row update and the sparse
 * POOL_OPTED_IN projection row atomically so the match Lambda can discover
 * eligible pools via a single-PK Query.
 *
 * Body:
 *   { blockReservationsOptedIn: boolean, riskShareMode?: 'PERCENTAGE' | 'MIN_BAYS_FLOOR' }
 */
export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('pool-opt-in', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  // Route is /api/v1/listings/{id}/block-reservations — API Gateway path
  // parameter name is "id" to match the existing listings/{id}/bays route.
  const poolId = event.pathParameters?.id ?? event.pathParameters?.poolId;
  if (!poolId) return badRequest('Missing poolId');

  const body = JSON.parse(event.body ?? '{}');
  const { blockReservationsOptedIn, riskShareMode } = body;

  if (typeof blockReservationsOptedIn !== 'boolean') {
    return badRequest('blockReservationsOptedIn must be a boolean');
  }
  if (blockReservationsOptedIn && !['PERCENTAGE', 'MIN_BAYS_FLOOR'].includes(riskShareMode)) {
    return badRequest('riskShareMode must be PERCENTAGE or MIN_BAYS_FLOOR when opting in');
  }

  // Load the listing to verify ownership and that it's a pool
  const listingRes = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `LISTING#${poolId}`, SK: 'METADATA' },
  }));
  if (!listingRes.Item) return notFound();

  const listing = listingRes.Item;
  if (listing.hostId !== claims.userId) {
    log.warn('forbidden — not the owner', { poolId, ownerCandidate: claims.userId });
    return forbidden('NOT_POOL_OWNER');
  }
  if (listing.isPool !== true) {
    return badRequest('NOT_A_POOL_LISTING');
  }

  // Verify the owner has an ACTIVE Spot Manager status with RC insurance approved
  // before allowing opt-in. (Opt-out is always allowed.)
  if (blockReservationsOptedIn) {
    const profileRes = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `USER#${claims.userId}`, SK: 'PROFILE' },
    }));
    const profile = profileRes.Item;
    if (!profile) return notFound();
    if (profile.spotManagerStatus !== 'ACTIVE') {
      return conflict('SPOT_MANAGER_NOT_ACTIVE');
    }
    if (profile.blockReservationCapable !== true) {
      return conflict('RC_INSURANCE_NOT_APPROVED');
    }
  }

  const now = new Date().toISOString();

  // Update the listing + write/delete the projection row atomically.
  const transactItems: any[] = [
    {
      Update: {
        TableName: TABLE,
        Key: { PK: `LISTING#${poolId}`, SK: 'METADATA' },
        UpdateExpression: blockReservationsOptedIn
          ? 'SET blockReservationsOptedIn = :t, riskShareMode = :mode, updatedAt = :now'
          : 'SET blockReservationsOptedIn = :f, updatedAt = :now',
        ExpressionAttributeValues: blockReservationsOptedIn
          ? { ':t': true, ':mode': riskShareMode, ':now': now }
          : { ':f': false, ':now': now },
      },
    },
  ];

  if (blockReservationsOptedIn) {
    transactItems.push({
      Put: {
        TableName: TABLE,
        Item: {
          PK: 'POOL_OPTED_IN',
          SK: `LISTING#${poolId}`,
          listingId: poolId,
          hostId: claims.userId,
          optedInAt: now,
        },
      },
    });
  } else {
    transactItems.push({
      Delete: {
        TableName: TABLE,
        Key: { PK: 'POOL_OPTED_IN', SK: `LISTING#${poolId}` },
      },
    });
  }

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  log.info('pool opt-in updated', { poolId, blockReservationsOptedIn, riskShareMode: riskShareMode ?? null });
  return ok({
    listingId: poolId,
    blockReservationsOptedIn,
    riskShareMode: blockReservationsOptedIn ? riskShareMode : null,
    updatedAt: now,
  });
};
