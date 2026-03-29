import { PostConfirmationTriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { emailLookupKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: PostConfirmationTriggerHandler = async (event) => {
  const { sub, email, name } = event.request.userAttributes;
  const log = createLogger('user-post-confirmation', sub ?? 'unknown');
  log.info('post confirmation trigger', { email });
  const now = new Date().toISOString();

  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        ...emailLookupKey(email, sub),
        userId: sub,
        email,
        name: name ?? email.split('@')[0],
        role: 'SPOTTER',
        stripeConnectEnabled: false,
        vehicles: [],
        createdAt: now,
        updatedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    log.info('user profile created', { userId: sub });
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      log.info('user profile already exists, skipping', { userId: sub });
    } else {
      log.error('failed to create user profile', err as Error);
      throw err;
    }
  }

  return event;
};
