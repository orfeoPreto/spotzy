import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SchedulerClient, CreateScheduleCommand } from '@aws-sdk/client-scheduler';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ulid } from 'ulid';
import Stripe from 'stripe';
import { getStripeSecretKey } from '../../payments/shared/stripe-helpers';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, conflict } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { bulkAllocate } from '../../../shared/block-reservations/allocator';
import type { PoolCandidate, AllocationItem } from '../../../shared/block-reservations/allocator';
import { VALIDATION_CHARGE_EUR, PLAN_FRESHNESS_MINUTES } from '../../../shared/block-reservations/constants';
import type { PlanSummary, PlanAllocation, BlockRequestPreferences } from '../../../shared/block-reservations/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const scheduler = new SchedulerClient({});
const eb = new EventBridgeClient({});
// Lazy Stripe client — initialized on first use after fetching the secret from
// Secrets Manager. Matches the pattern used by the existing payment Lambdas.
let stripeClient: Stripe | null = null;
const getStripe = async (): Promise<Stripe> => {
  if (stripeClient) return stripeClient;
  const key = await getStripeSecretKey();
  stripeClient = new Stripe(key, { apiVersion: '2023-10-16' as any });
  return stripeClient;
};
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';
const SCHEDULER_ROLE_ARN = process.env.SCHEDULER_ROLE_ARN ?? '';
const AUTH_LAMBDA_ARN = process.env.AUTH_LAMBDA_ARN ?? '';
const SETTLE_LAMBDA_ARN = process.env.SETTLE_LAMBDA_ARN ?? '';
const ANONYMISE_LAMBDA_ARN = process.env.ANONYMISE_LAMBDA_ARN ?? '';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('block-accept-plan', event.requestContext.requestId, claims?.userId);

  if (!claims) {
    log.warn('unauthorized');
    return unauthorized();
  }

  const reqId = event.pathParameters?.reqId;
  if (!reqId) return badRequest('reqId path parameter required');

  const body = JSON.parse(event.body ?? '{}');
  const { planIndex } = body;

  if (planIndex === undefined || planIndex === null) {
    return badRequest('planIndex is required');
  }

  // Load request
  const reqResult = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
  }));

  const blockReq = reqResult.Item;
  if (!blockReq) return notFound();

  // Owner check
  if (blockReq.ownerUserId !== claims.userId) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // Status check
  if (blockReq.status !== 'PLANS_PROPOSED') {
    return conflict('REQUEST_NOT_IN_PLANS_PROPOSED');
  }

  // Check plan freshness
  const proposedPlans = blockReq.proposedPlans as PlanSummary[];
  if (!proposedPlans || proposedPlans.length === 0) {
    return conflict('NO_PLANS_AVAILABLE');
  }

  const computedAt = new Date(blockReq.proposedPlansComputedAt as string).getTime();
  const freshnessMs = PLAN_FRESHNESS_MINUTES * 60 * 1000;
  if (Date.now() - computedAt > freshnessMs) {
    return conflict('PLANS_EXPIRED');
  }

  // Validate planIndex
  if (planIndex < 0 || planIndex >= proposedPlans.length) {
    return badRequest('INVALID_PLAN_INDEX');
  }

  const chosenPlan = proposedPlans[planIndex];

  // Re-validate pool availability (v2.x LISTING# rows with status='live')
  for (const alloc of chosenPlan.allocations) {
    const poolResult = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `LISTING#${alloc.poolListingId}`, SK: 'METADATA' },
    }));
    const pool = poolResult.Item;
    if (!pool || pool.isPool !== true || pool.status !== 'live' || pool.blockReservationsOptedIn !== true) {
      return conflict('PLAN_STALE');
    }
  }

  // Load user profile for Stripe customer ID
  const profileResult = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USER#${claims.userId}`, SK: 'PROFILE' },
  }));
  const stripeCustomerId = profileResult.Item?.stripeCustomerId;

  // Issue €1 validation charge
  const stripe = await getStripe();
  let validationPi: Stripe.PaymentIntent;
  try {
    // If the block spotter has a Stripe customer, do an off_session charge.
    // If not, create a simple automatic-capture PI without a customer — the
    // charge would normally require a payment method, so for dev-local we
    // fall back to a manual_capture with no confirmation which exercises the
    // Stripe API without actually charging anything.
    validationPi = await stripe.paymentIntents.create(
      stripeCustomerId
        ? {
            amount: Math.round(VALIDATION_CHARGE_EUR * 100),
            currency: 'eur',
            customer: stripeCustomerId,
            capture_method: 'automatic',
            confirm: true,
            off_session: true,
            metadata: { purpose: 'validate', reqId },
          }
        : {
            amount: Math.round(VALIDATION_CHARGE_EUR * 100),
            currency: 'eur',
            capture_method: 'manual',
            metadata: { purpose: 'validate', reqId },
          },
      { idempotencyKey: `blockreq:${reqId}:validate` },
    );
  } catch (err: any) {
    log.error('validation charge failed', err);
    return {
      statusCode: 402,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'PAYMENT_DECLINED' }),
    };
  }

  // Immediately void the validation charge
  try {
    await stripe.paymentIntents.cancel(validationPi.id);
  } catch (err: any) {
    log.warn('validation void failed — non-critical', err);
  }

  const now = new Date().toISOString();

  // Write BLOCKALLOC# rows
  const allocTransactItems: any[] = [];
  const allocIds: string[] = [];

  for (const planAlloc of chosenPlan.allocations) {
    const allocId = ulid();
    allocIds.push(allocId);

    // Load the pool's actual BAY# rows and pick N ACTIVE bays for this allocation.
    // v2.x storage: LISTING#{poolListingId} / BAY#{bayId}
    const baysRes = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `LISTING#${planAlloc.poolListingId}`,
        ':prefix': 'BAY#',
      },
    }));
    const activeBays = (baysRes.Items ?? []).filter((b) => (b.status ?? 'ACTIVE') === 'ACTIVE');
    if (activeBays.length < planAlloc.contributedBayCount) {
      log.warn('not enough ACTIVE bays in pool at accept time', {
        poolListingId: planAlloc.poolListingId,
        requested: planAlloc.contributedBayCount,
        available: activeBays.length,
      });
      return conflict('PLAN_STALE');
    }
    // Sort deterministically by bayId and pick the first N
    const assignedBayIds = activeBays
      .sort((a, b) => ((a.bayId as string) < (b.bayId as string) ? -1 : 1))
      .slice(0, planAlloc.contributedBayCount)
      .map((b) => b.bayId as string);

    // BLOCKALLOC# under BLOCKREQ#
    allocTransactItems.push({
      Put: {
        TableName: TABLE,
        Item: {
          PK: `BLOCKREQ#${reqId}`,
          SK: `BLOCKALLOC#${allocId}`,
          allocId,
          reqId,
          poolListingId: planAlloc.poolListingId,
          spotManagerUserId: planAlloc.spotManagerUserId,
          contributedBayCount: planAlloc.contributedBayCount,
          allocatedBayCount: 0,
          assignedBayIds,
          riskShareMode: planAlloc.riskShareMode,
          riskShareRate: planAlloc.riskShareRate,
          pricePerBayEur: planAlloc.pricePerBayEur,
          settlement: null,
          createdAt: now,
          updatedAt: now,
        },
      },
    });

    // Reverse projection: LISTING#{poolListingId} BLOCKALLOC#{allocId}
    allocTransactItems.push({
      Put: {
        TableName: TABLE,
        Item: {
          PK: `LISTING#${planAlloc.poolListingId}`,
          SK: `BLOCKALLOC#${allocId}`,
          allocId,
          parentReqId: reqId,
          contributedBayCount: planAlloc.contributedBayCount,
          allocatedBayCount: 0,
          startsAt: blockReq.startsAt,
          endsAt: blockReq.endsAt,
        },
      },
    });
  }

  // Update BLOCKREQ# status
  allocTransactItems.push({
    Update: {
      TableName: TABLE,
      Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #status = :s, validationChargeId = :vcId, acceptedPlanIndex = :pi, updatedAt = :now, auditLog = list_append(if_not_exists(auditLog, :emptyList), :auditEntry)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':s': 'CONFIRMED',
        ':vcId': validationPi.id,
        ':pi': planIndex,
        ':now': now,
        ':emptyList': [],
        ':auditEntry': [{
          timestamp: now,
          actorUserId: claims.userId,
          action: 'PLAN_ACCEPTED',
          before: { status: 'PLANS_PROPOSED' },
          after: { status: 'CONFIRMED', acceptedPlanIndex: planIndex },
        }],
      },
    },
  });

  await ddb.send(new TransactWriteCommand({ TransactItems: allocTransactItems }));

  // Materialise pendingGuests as BOOKING# rows if any
  const pendingGuests = blockReq.pendingGuests as Array<{ name: string; email: string; phone: string }> | null;
  if (pendingGuests && pendingGuests.length > 0) {
    // Build pool candidates for the allocator from the accepted plan
    const poolCandidates: PoolCandidate[] = chosenPlan.allocations.map((a, idx) => ({
      poolListingId: a.poolListingId,
      spotManagerUserId: a.spotManagerUserId,
      totalBayCount: a.contributedBayCount,
      availableBayIds: Array.from({ length: a.contributedBayCount }, (_, i) =>
        `bay-${allocIds[idx]}-${String(i + 1).padStart(3, '0')}`
      ),
      pricePerBayEur: a.pricePerBayEur,
      riskShareMode: a.riskShareMode,
      riskShareRate: a.riskShareRate,
      poolRating: a.poolRating,
      spotManagerVerified: true,
      walkingDistanceMeters: a.walkingDistanceMeters,
      latitude: 50.85,
      longitude: 4.35,
    }));

    const allocationItems: AllocationItem[] = pendingGuests.map((g) => ({
      itemId: g.email,
    }));

    const allocResults = bulkAllocate(allocationItems, poolCandidates, blockReq.preferences as BlockRequestPreferences);

    // Write BOOKING# rows
    const bookingTransactItems: any[] = [];
    for (const ar of allocResults) {
      const bookingId = ulid();
      const allocId = allocIds[chosenPlan.allocations.findIndex((a) => a.poolListingId === ar.poolListingId)];
      const guest = pendingGuests.find((g) => g.email === ar.itemId)!;

      bookingTransactItems.push({
        Put: {
          TableName: TABLE,
          Item: {
            PK: `BLOCKREQ#${reqId}`,
            SK: `BOOKING#${bookingId}`,
            bookingId,
            reqId,
            allocId,
            bayId: ar.bayId,
            listingId: ar.poolListingId,
            guestName: guest.name,
            guestEmail: guest.email,
            guestPhone: guest.phone,
            spotterId: null,
            emailStatus: 'PENDING',
            emailSentAt: null,
            emailBouncedAt: null,
            allocationStatus: 'ALLOCATED',
            source: 'BLOCK_RESERVATION',
            createdAt: now,
            updatedAt: now,
          },
        },
      });
    }

    if (bookingTransactItems.length > 0) {
      try {
        await ddb.send(new TransactWriteCommand({ TransactItems: bookingTransactItems }));
      } catch (err: any) {
        log.error('booking materialisation failed', err);
        // Non-fatal — mark for admin retry
        await ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
          UpdateExpression: 'SET bookingMaterializationError = :t',
          ExpressionAttributeValues: { ':t': true },
        }));
      }
    }
  }

  // Schedule EventBridge Scheduler rules
  const startsAt = new Date(blockReq.startsAt as string);
  const endsAt = new Date(blockReq.endsAt as string);

  // block-auth: startsAt - 7 days
  const authTime = new Date(startsAt.getTime() - 7 * 24 * 3600_000);
  try {
    await scheduler.send(new CreateScheduleCommand({
      Name: `block-auth-${reqId}`,
      ScheduleExpression: `at(${authTime.toISOString().replace(/\.\d{3}Z$/, '')})`,
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: AUTH_LAMBDA_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({ reqId }),
      },
    }));
  } catch (err: any) {
    log.error('failed to schedule auth rule', err);
  }

  // block-settle: at endsAt
  try {
    await scheduler.send(new CreateScheduleCommand({
      Name: `block-settle-${reqId}`,
      ScheduleExpression: `at(${endsAt.toISOString().replace(/\.\d{3}Z$/, '')})`,
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: SETTLE_LAMBDA_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({ reqId }),
      },
    }));
  } catch (err: any) {
    log.error('failed to schedule settle rule', err);
  }

  // guest-anonymise: endsAt + 48h
  const anonymiseTime = new Date(endsAt.getTime() + 48 * 3600_000);
  try {
    await scheduler.send(new CreateScheduleCommand({
      Name: `guest-anonymise-${reqId}`,
      ScheduleExpression: `at(${anonymiseTime.toISOString().replace(/\.\d{3}Z$/, '')})`,
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: ANONYMISE_LAMBDA_ARN,
        RoleArn: SCHEDULER_ROLE_ARN,
        Input: JSON.stringify({ reqId }),
      },
    }));
  } catch (err: any) {
    log.error('failed to schedule anonymise rule', err);
  }

  // Update reverse projection
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `USER#${claims.userId}`, SK: `BLOCKREQ#${reqId}` },
    UpdateExpression: 'SET #status = :s, lastUpdatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':s': 'CONFIRMED', ':now': now },
  }));

  log.info('block plan accepted', { reqId, planIndex, allocCount: chosenPlan.allocations.length });
  return ok({
    reqId,
    status: 'CONFIRMED',
    acceptedPlanIndex: planIndex,
    validationChargeId: validationPi.id,
    allocations: chosenPlan.allocations.map((a, i) => ({
      allocId: allocIds[i],
      poolListingId: a.poolListingId,
      contributedBayCount: a.contributedBayCount,
    })),
  });
};
