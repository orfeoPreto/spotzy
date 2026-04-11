import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ulid } from 'ulid';
import { extractClaims } from '../../../shared/utils/auth';
import { created, badRequest, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { validateWindow, validateBayCount, validateBelgianVAT, validateGuestEmail, validateGuestPhone } from '../../../shared/block-reservations/validation';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('block-request-create', event.requestContext.requestId, claims?.userId);

  if (!claims) {
    log.warn('unauthorized');
    return unauthorized();
  }

  const body = JSON.parse(event.body ?? '{}');
  const { startsAt, endsAt, bayCount, preferences, pendingGuests, companyName, vatNumber } = body;

  // Validate window
  const windowCheck = validateWindow(startsAt, endsAt, new Date());
  if (!windowCheck.valid) {
    return badRequest(windowCheck.error!);
  }

  // Validate bay count
  const bayCheck = validateBayCount(bayCount);
  if (!bayCheck.valid) {
    return badRequest(bayCheck.error!);
  }

  // Load user profile to check for existing company info
  const profileResult = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USER#${claims.userId}`, SK: 'PROFILE' },
  }));
  const profile = profileResult.Item;

  // Resolve company info
  let resolvedCompanyName: string;
  let resolvedVatNumber: string;
  let needProfileUpdate = false;

  if (companyName && vatNumber) {
    // Validate VAT
    const vatCheck = validateBelgianVAT(vatNumber);
    if (!vatCheck.valid) {
      return badRequest(vatCheck.error!);
    }
    resolvedCompanyName = companyName;
    resolvedVatNumber = vatNumber;
    // Check if we need to persist to profile
    if (!profile?.companyName || !profile?.vatNumber) {
      needProfileUpdate = true;
    }
  } else if (profile?.companyName && profile?.vatNumber) {
    resolvedCompanyName = profile.companyName;
    resolvedVatNumber = profile.vatNumber;
  } else {
    return badRequest('SOFT_VERIFICATION_REQUIRED');
  }

  // Validate pending guests if provided
  if (pendingGuests && Array.isArray(pendingGuests)) {
    const emails = new Set<string>();
    for (const guest of pendingGuests) {
      if (!validateGuestEmail(guest.email)) {
        return badRequest('INVALID_GUEST_EMAIL');
      }
      if (!validateGuestPhone(guest.phone)) {
        return badRequest('INVALID_GUEST_PHONE');
      }
      if (!guest.name || guest.name.trim().length === 0) {
        return badRequest('GUEST_NAME_REQUIRED');
      }
      if (emails.has(guest.email.toLowerCase())) {
        return badRequest('DUPLICATE_GUEST_EMAIL');
      }
      emails.add(guest.email.toLowerCase());
    }
  }

  const reqId = ulid();
  const now = new Date().toISOString();

  const blockReqMetadata = {
    PK: `BLOCKREQ#${reqId}`,
    SK: 'METADATA',
    reqId,
    ownerUserId: claims.userId,
    status: 'PENDING_MATCH' as const,
    cancellationReason: null,
    startsAt,
    endsAt,
    bayCount,
    preferences: preferences ?? {
      minPoolRating: null,
      requireVerifiedSpotManager: null,
      noIndividualSpots: true,
      maxCounterparties: null,
      maxWalkingTimeFromPoint: null,
      clusterTogether: null,
    },
    pendingGuests: pendingGuests ?? null,
    companyNameSnapshot: resolvedCompanyName,
    vatNumberSnapshot: resolvedVatNumber,
    validationChargeId: null,
    authorisationId: null,
    authorisationRetryCount: 0,
    proposedPlans: null,
    proposedPlansComputedAt: null,
    acceptedPlanIndex: null,
    settlementBreakdown: null,
    auditLog: [],
    createdAt: now,
    updatedAt: now,
  };

  const reverseProjection = {
    PK: `USER#${claims.userId}`,
    SK: `BLOCKREQ#${reqId}`,
    reqId,
    status: 'PENDING_MATCH',
    startsAt,
    endsAt,
    bayCount,
    lastUpdatedAt: now,
  };

  // Build transact items
  const transactItems: any[] = [
    { Put: { TableName: TABLE, Item: blockReqMetadata } },
    { Put: { TableName: TABLE, Item: reverseProjection } },
  ];

  if (needProfileUpdate) {
    transactItems.push({
      Update: {
        TableName: TABLE,
        Key: { PK: `USER#${claims.userId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET companyName = :cn, vatNumber = :vn, updatedAt = :now',
        ExpressionAttributeValues: {
          ':cn': resolvedCompanyName,
          ':vn': resolvedVatNumber,
          ':now': now,
        },
      },
    });
  }

  await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));

  // Publish EventBridge event
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS,
      Source: 'spotzy',
      DetailType: 'block.request.created',
      Detail: JSON.stringify({ reqId, ownerUserId: claims.userId, bayCount, startsAt, endsAt }),
    }],
  }));

  log.info('block request created', { reqId, bayCount, startsAt, endsAt });
  return created({ reqId, status: 'PENDING_MATCH', startsAt, endsAt, bayCount });
};
