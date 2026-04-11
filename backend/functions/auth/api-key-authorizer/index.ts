import { createHash } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

interface AuthorizerEvent {
  authorizationToken: string;
  methodArn: string;
}

interface AuthorizerResult {
  principalId: string;
  context?: Record<string, string>;
  policyDocument: {
    Version: string;
    Statement: Array<{ Action: string; Effect: string; Resource: string }>;
  };
}

export const handler = async (event: AuthorizerEvent): Promise<AuthorizerResult> => {
  const raw = event.authorizationToken?.replace(/^ApiKey\s+/i, '').trim();
  if (!raw) return denyPolicy('anonymous');

  const hash = createHash('sha256').update(raw).digest('hex');

  try {
    const result = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `APIKEY#${hash}`, SK: 'METADATA' },
    }));

    if (!result.Item || result.Item.revokedAt) return denyPolicy(hash);

    // Fire-and-forget: update lastUsedAt
    ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `APIKEY#${hash}`, SK: 'METADATA' },
      UpdateExpression: 'SET lastUsedAt = :now',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    })).catch(() => {});

    return allowPolicy(result.Item.userId, { keyId: result.Item.keyId });
  } catch {
    return denyPolicy('error');
  }
};

const allowPolicy = (principalId: string, context: Record<string, string>): AuthorizerResult => ({
  principalId,
  context,
  policyDocument: {
    Version: '2012-10-17',
    Statement: [{ Action: 'execute-api:Invoke', Effect: 'Allow', Resource: '*' }],
  },
});

const denyPolicy = (principalId: string): AuthorizerResult => ({
  principalId,
  policyDocument: {
    Version: '2012-10-17',
    Statement: [{ Action: 'execute-api:Invoke', Effect: 'Deny', Resource: '*' }],
  },
});
