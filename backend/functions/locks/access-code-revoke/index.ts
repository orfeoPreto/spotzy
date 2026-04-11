import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getLockProvider } from '../../../shared/lock/LockProvider';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

export const handler = async (event: { detail: { bookingId: string } }) => {
  const { bookingId } = event.detail;

  const accessCode = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `BOOKING#${bookingId}`, SK: 'ACCESS_CODE' },
  }));

  if (!accessCode.Item || accessCode.Item.revokedAt) return; // No code or already revoked

  try {
    const provider = getLockProvider(accessCode.Item.provider);
    await provider.revokeCode({
      lockId: accessCode.Item.lockId,
      codeId: accessCode.Item.codeId,
    });
  } catch (err: any) {
    // Gracefully handle already-expired codes
    if (err?.code !== 'access_code_not_found') {
      console.warn(`Failed to revoke code on provider for booking ${bookingId}:`, err);
    }
  }

  // Mark as revoked in DynamoDB regardless
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `BOOKING#${bookingId}`, SK: 'ACCESS_CODE' },
    UpdateExpression: 'SET revokedAt = :now',
    ExpressionAttributeValues: { ':now': new Date().toISOString() },
  }));

  console.log(`Access code revoked for booking ${bookingId}`);
};
