import { PostConfirmationTriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { emailLookupKey } from '../../../shared/db/keys';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler: PostConfirmationTriggerHandler = async (event) => {
  const { sub, email, name, phone_number, given_name, family_name, 'custom:role': customRole } = event.request.userAttributes;
  const log = createLogger('user-post-confirmation', sub ?? 'unknown');
  log.info('post confirmation trigger', { email, phone_number: phone_number ?? '<missing>', customRole: customRole ?? '<missing>' });
  const now = new Date().toISOString();

  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        ...emailLookupKey(email, sub),
        userId: sub,
        email,
        name: name ?? (given_name && family_name ? `${given_name} ${family_name}` : email.split('@')[0]),
        firstName: given_name ?? '',
        lastName: family_name ?? '',
        phone: phone_number ?? '',
        phone_number: phone_number ?? '',
        role: customRole ?? 'SPOTTER',
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
