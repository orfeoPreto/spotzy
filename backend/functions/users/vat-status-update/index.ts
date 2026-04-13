import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { userProfileKey } from '../../../shared/db/keys';
import { validateBelgianVATNumber } from '../../../shared/pricing/validation';
import type { VATStatus } from '../../../shared/pricing/vat-constants';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const VALID_VAT_STATUSES: VATStatus[] = ['EXEMPT_FRANCHISE', 'VAT_REGISTERED'];

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('user-vat-status-update', event.requestContext.requestId, claims?.userId);

  if (!claims) {
    log.warn('unauthorized');
    return unauthorized();
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return badRequest('INVALID_JSON_BODY');
  }

  const { vatStatus, vatNumber } = body;

  if (!vatStatus || !VALID_VAT_STATUSES.includes(vatStatus as VATStatus)) {
    return badRequest('INVALID_VAT_STATUS');
  }

  // If VAT_REGISTERED, vatNumber is required and must be valid
  if (vatStatus === 'VAT_REGISTERED') {
    if (!vatNumber || typeof vatNumber !== 'string') {
      return badRequest('VAT_NUMBER_REQUIRED');
    }
    const validation = validateBelgianVATNumber(vatNumber);
    if (!validation.valid) {
      return badRequest(validation.error!);
    }
  }

  // Read current profile to check if this is the first transition to VAT_REGISTERED
  const profileResult = await client.send(new GetCommand({
    TableName: TABLE,
    Key: userProfileKey(claims.userId),
  }));

  const existing = profileResult.Item;
  const now = new Date().toISOString();

  // Determine if we need to set vatRegisteredSince (first transition to REGISTERED)
  const isFirstRegistration =
    vatStatus === 'VAT_REGISTERED' &&
    (!existing?.vatRegisteredSince);

  const updateExprParts = [
    '#vatStatus = :vatStatus',
    '#vatNumber = :vatNumber',
    '#vatStatusLastChangedAt = :now',
    '#vatStatusLastChangedBy = :userId',
    '#updatedAt = :now',
  ];
  const exprNames: Record<string, string> = {
    '#vatStatus': 'vatStatus',
    '#vatNumber': 'vatNumber',
    '#vatStatusLastChangedAt': 'vatStatusLastChangedAt',
    '#vatStatusLastChangedBy': 'vatStatusLastChangedBy',
    '#updatedAt': 'updatedAt',
  };
  const exprValues: Record<string, unknown> = {
    ':vatStatus': vatStatus,
    ':vatNumber': vatStatus === 'VAT_REGISTERED' ? vatNumber : null,
    ':now': now,
    ':userId': claims.userId,
  };

  if (isFirstRegistration) {
    updateExprParts.push('#vatRegisteredSince = :now');
    exprNames['#vatRegisteredSince'] = 'vatRegisteredSince';
  }

  const result = await client.send(new UpdateCommand({
    TableName: TABLE,
    Key: userProfileKey(claims.userId),
    UpdateExpression: `SET ${updateExprParts.join(', ')}`,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
    ReturnValues: 'ALL_NEW',
  }));

  log.info('vat status updated', { vatStatus, vatNumber: vatStatus === 'VAT_REGISTERED' ? vatNumber : undefined });
  return ok(result.Attributes);
};
