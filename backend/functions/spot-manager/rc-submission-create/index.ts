import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ulid } from 'ulid';
import { extractClaims } from '../../../shared/utils/auth';
import { created, badRequest, unauthorized, forbidden } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { validateInsurer, validatePolicyNumber, validateExpiryDate, validateRCDocument, validateChecklistAcceptance } from '../../../shared/spot-manager/validation';
import { SPOT_MANAGER_TCS_VERSION } from '../../../shared/spot-manager/constants';
import type { RCSubmission } from '../../../shared/spot-manager/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('rc-submission-create', event.requestContext.requestId, claims?.userId);

  if (!claims) { log.warn('unauthorized'); return unauthorized(); }

  const body = JSON.parse(event.body ?? '{}');
  const { insurer, policyNumber, expiryDate } = body;

  // Accept both the flat shape used by the frontend/specs
  // ({ documentS3Key, documentMimeType, documentSizeBytes, checklistAcceptance, tcsVersionAccepted })
  // and the legacy nested shape used by earlier tests
  // ({ document: { s3Key, mimeType, size }, checklist, tcsVersion }).
  const document = body.document ?? {
    s3Key: body.documentS3Key,
    mimeType: body.documentMimeType,
    size: body.documentSizeBytes,
  };
  const checklist = body.checklist ?? body.checklistAcceptance;
  const tcsVersion = body.tcsVersion ?? body.tcsVersionAccepted;

  const warnings: string[] = [];

  // Validate insurer
  if (!insurer || !validateInsurer(insurer)) {
    return badRequest('INVALID_INSURER');
  }

  // Validate policy number
  const policyResult = validatePolicyNumber(policyNumber);
  if (!policyResult.valid) {
    return badRequest(policyResult.error!);
  }

  // Validate expiry date
  const expiryResult = validateExpiryDate(expiryDate, new Date());
  if (!expiryResult.valid) {
    return badRequest(expiryResult.error!);
  }
  if (expiryResult.warning) {
    warnings.push(expiryResult.warning);
  }

  // Validate document
  if (!document?.mimeType || document?.size === undefined) {
    return badRequest('DOCUMENT_REQUIRED');
  }
  const docResult = validateRCDocument(document.mimeType, document.size);
  if (!docResult.valid) {
    return badRequest(docResult.error!);
  }

  // Validate checklist
  if (!checklist) {
    return badRequest('CHECKLIST_REQUIRED');
  }
  const checklistResult = validateChecklistAcceptance(checklist);
  if (!checklistResult.valid) {
    return badRequest(checklistResult.error!);
  }

  // Validate T&Cs version
  if (!tcsVersion) {
    return badRequest('TCS_VERSION_REQUIRED');
  }

  // Check user profile has stripeConnectEnabled
  const userResult = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `USER#${claims.userId}`, SK: 'PROFILE' },
  }));
  if (!userResult.Item?.stripeConnectEnabled) {
    log.warn('stripe connect required', { userId: claims.userId });
    return forbidden();
  }

  const submissionId = ulid();
  const now = new Date().toISOString();

  const submission: RCSubmission = {
    submissionId,
    userId: claims.userId,
    insurer,
    policyNumber,
    expiryDate,
    documentS3Key: document.s3Key,
    documentMimeType: document.mimeType,
    documentSizeBytes: document.size,
    checklistAcceptance: {
      ...checklist,
      acceptedAt: now,
    },
    tcsVersionAccepted: tcsVersion,
    status: 'PENDING_REVIEW',
    reviewedBy: null,
    reviewedAt: null,
    reviewerNote: null,
    rejectionReason: null,
    supersededBy: null,
    createdAt: now,
    updatedAt: now,
  };

  log.info('creating rc submission', { submissionId, insurer, expiryDate });

  // Atomic transaction: create submission + update profile + write review queue
  await ddb.send(new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: `USER#${claims.userId}`,
            SK: `RCSUBMISSION#${submissionId}`,
            ...submission,
          },
        },
      },
      {
        Update: {
          TableName: TABLE,
          Key: { PK: `USER#${claims.userId}`, SK: 'PROFILE' },
          UpdateExpression: 'SET spotManagerStatus = :staged, rcInsuranceStatus = :pending, currentRCSubmissionId = :subId, updatedAt = :now',
          ExpressionAttributeValues: {
            ':staged': 'STAGED',
            ':pending': 'PENDING_REVIEW',
            ':subId': submissionId,
            ':now': now,
          },
        },
      },
      {
        Put: {
          TableName: TABLE,
          Item: {
            PK: 'RC_REVIEW_QUEUE',
            SK: `PENDING#${now}#${submissionId}`,
            submissionId,
            userId: claims.userId,
            insurer,
            expiryDate,
            createdAt: now,
          },
        },
      },
    ],
  }));

  // Publish EventBridge event
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS,
      Source: 'spotzy',
      DetailType: 'rc.submission.created',
      Detail: JSON.stringify({ submissionId, userId: claims.userId, insurer, expiryDate }),
    }],
  }));

  log.info('rc submission created', { submissionId });

  const responseBody: Record<string, unknown> = { ...submission };
  if (warnings.length > 0) {
    responseBody.warnings = warnings;
  }

  return created(responseBody);
};
