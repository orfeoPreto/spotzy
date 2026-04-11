import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, conflict } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { validateWindow, validateBayCount, validateGuestEmail, validateGuestPhone } from '../../../shared/block-reservations/validation';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

const EDITABLE_STATUSES = new Set(['PENDING_MATCH', 'PLANS_PROPOSED']);
const TERMINAL_STATUSES = new Set(['CANCELLED', 'SETTLED']);

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('block-request-update', event.requestContext.requestId, claims?.userId);

  if (!claims) {
    log.warn('unauthorized');
    return unauthorized();
  }

  const reqId = event.pathParameters?.reqId;
  if (!reqId) return badRequest('reqId path parameter required');

  // Load existing request
  const existing = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
  }));

  if (!existing.Item) return notFound();

  // Owner check
  if (existing.Item.ownerUserId !== claims.userId) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // Status check
  if (TERMINAL_STATUSES.has(existing.Item.status)) {
    return conflict('REQUEST_TERMINAL');
  }
  if (!EDITABLE_STATUSES.has(existing.Item.status)) {
    return conflict('REQUEST_LOCKED');
  }

  const body = JSON.parse(event.body ?? '{}');
  const now = new Date().toISOString();

  // Validate updated fields
  if (body.startsAt || body.endsAt) {
    const startsAt = body.startsAt ?? existing.Item.startsAt;
    const endsAt = body.endsAt ?? existing.Item.endsAt;
    const windowCheck = validateWindow(startsAt, endsAt, new Date());
    if (!windowCheck.valid) return badRequest(windowCheck.error!);
  }

  if (body.bayCount !== undefined) {
    const bayCheck = validateBayCount(body.bayCount);
    if (!bayCheck.valid) return badRequest(bayCheck.error!);
  }

  if (body.pendingGuests && Array.isArray(body.pendingGuests)) {
    const emails = new Set<string>();
    for (const guest of body.pendingGuests) {
      if (!validateGuestEmail(guest.email)) return badRequest('INVALID_GUEST_EMAIL');
      if (!validateGuestPhone(guest.phone)) return badRequest('INVALID_GUEST_PHONE');
      if (emails.has(guest.email.toLowerCase())) return badRequest('DUPLICATE_GUEST_EMAIL');
      emails.add(guest.email.toLowerCase());
    }
  }

  // Build update expression
  const updateParts: string[] = [];
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, any> = {};

  if (body.startsAt) { updateParts.push('startsAt = :sa'); exprValues[':sa'] = body.startsAt; }
  if (body.endsAt) { updateParts.push('endsAt = :ea'); exprValues[':ea'] = body.endsAt; }
  if (body.bayCount !== undefined) { updateParts.push('bayCount = :bc'); exprValues[':bc'] = body.bayCount; }
  if (body.preferences) { updateParts.push('preferences = :prefs'); exprValues[':prefs'] = body.preferences; }
  if (body.pendingGuests !== undefined) { updateParts.push('pendingGuests = :pg'); exprValues[':pg'] = body.pendingGuests; }

  // Always reset status, proposedPlans, acceptedPlanIndex on update
  updateParts.push('#status = :newStatus');
  exprNames['#status'] = 'status';
  exprValues[':newStatus'] = 'PENDING_MATCH';

  updateParts.push('proposedPlans = :nullVal');
  updateParts.push('proposedPlansComputedAt = :nullVal');
  updateParts.push('acceptedPlanIndex = :nullVal');
  exprValues[':nullVal'] = null;

  updateParts.push('updatedAt = :now');
  exprValues[':now'] = now;

  // Append audit log entry
  const auditEntry = {
    timestamp: now,
    actorUserId: claims.userId,
    action: 'REQUEST_UPDATED',
    before: { status: existing.Item.status },
    after: { status: 'PENDING_MATCH', ...body },
  };
  updateParts.push('auditLog = list_append(if_not_exists(auditLog, :emptyList), :auditEntry)');
  exprValues[':emptyList'] = [];
  exprValues[':auditEntry'] = [auditEntry];

  // Conditional update: only allow PENDING_MATCH or PLANS_PROPOSED
  exprValues[':pm'] = 'PENDING_MATCH';
  exprValues[':pp'] = 'PLANS_PROPOSED';

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
    UpdateExpression: `SET ${updateParts.join(', ')}`,
    ConditionExpression: 'attribute_exists(reqId) AND #status IN (:pm, :pp)',
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
  }));

  // Update reverse projection status
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `USER#${claims.userId}`, SK: `BLOCKREQ#${reqId}` },
    UpdateExpression: 'SET #status = :s, lastUpdatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':s': 'PENDING_MATCH', ':now': now },
  }));

  // Publish event to re-trigger matching
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS,
      Source: 'spotzy',
      DetailType: 'block.request.updated',
      Detail: JSON.stringify({ reqId, ownerUserId: claims.userId }),
    }],
  }));

  log.info('block request updated', { reqId });
  return ok({ reqId, status: 'PENDING_MATCH', updatedAt: now });
};
