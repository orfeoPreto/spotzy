import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { ok, notFound, badRequest } from '../../../shared/utils/response';
import { disputeMetadataKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const BUS = process.env.EVENT_BUS_NAME ?? 'spotzy-events';

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('dispute-escalate', event.requestContext.requestId);

  const disputeId = event.pathParameters?.id;
  if (!disputeId) return badRequest('Missing dispute id');
  log.info('escalate attempt', { disputeId });

  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: disputeMetadataKey(disputeId) }));
  if (!result.Item) return notFound();
  const dispute = result.Item;

  if (dispute.status === 'ESCALATED') return ok({ disputeId, status: 'ESCALATED', message: 'Already escalated' });

  const now = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: disputeMetadataKey(disputeId),
    UpdateExpression: 'SET #status = :s, escalatedAt = :now, assignedToAgentQueue = :q, updatedAt = :now',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':s': 'ESCALATED', ':now': now, ':q': true },
  }));

  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS, Source: 'spotzy', DetailType: 'dispute.escalated',
      Detail: JSON.stringify({ disputeId, bookingId: dispute.bookingId, hostId: dispute.hostId, spotterId: dispute.spotterId }),
    }],
  }));

  log.info('dispute escalated', { disputeId });
  return ok({ disputeId, status: 'ESCALATED', escalatedAt: now });
};
