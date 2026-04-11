import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import * as crypto from 'crypto';
import { createLogger } from '../../../shared/utils/logger';
import { MAGIC_LINK_TOKEN_TTL_HOURS } from '../../../shared/block-reservations/constants';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

let _magicLinkSecret: string | undefined;
const getMagicLinkSecret = async (): Promise<string> => {
  if (_magicLinkSecret) return _magicLinkSecret;
  if (process.env.MAGIC_LINK_SECRET) return ((_magicLinkSecret = process.env.MAGIC_LINK_SECRET));
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  const sm = new SecretsManagerClient({});
  const res = await sm.send(new GetSecretValueCommand({ SecretId: 'spotzy/block-reservations/magic-link-signing-key' }));
  _magicLinkSecret = res.SecretString!;
  return _magicLinkSecret;
};

interface TokenPayload {
  bookingId: string;
  bayId: string;
  reqId: string;
  exp: string;
  sig?: string;
}

/**
 * Verify a signed JWT-style token.
 * Token is base64url-encoded JSON with an HMAC-SHA256 signature field.
 */
function verifyToken(tokenStr: string, secret: string): TokenPayload | null {
  try {
    const decoded = Buffer.from(tokenStr, 'base64url').toString('utf-8');
    const payload = JSON.parse(decoded) as TokenPayload;

    if (!payload.bookingId || !payload.reqId || !payload.exp) {
      return null;
    }

    // If the token has a signature, verify it
    if (payload.sig) {
      const { sig, ...dataToVerify } = payload;
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(dataToVerify))
        .digest('base64url');
      if (sig !== expected) {
        return null;
      }
    }

    return payload;
  } catch {
    return null;
  }
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const log = createLogger('magic-link-claim', event.requestContext?.requestId ?? 'unknown');
  const token = event.pathParameters?.token;

  if (!token) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Token required' }) };
  }

  // Validate token signature
  const secret = await getMagicLinkSecret();
  const payload = verifyToken(token, secret);

  if (!payload) {
    log.warn('invalid token signature');
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Invalid token' }) };
  }

  // Check expiry
  const expDate = new Date(payload.exp);
  if (isNaN(expDate.getTime()) || Date.now() > expDate.getTime()) {
    log.info('token expired', { bookingId: payload.bookingId, exp: payload.exp });
    return { statusCode: 410, headers: HEADERS, body: JSON.stringify({ error: 'Token expired' }) };
  }

  // Load the booking
  const bookingResult = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `BLOCKREQ#${payload.reqId}`, SK: `BOOKING#${payload.bookingId}` },
  }));

  const booking = bookingResult.Item;
  if (!booking) {
    log.warn('booking not found', { bookingId: payload.bookingId, reqId: payload.reqId });
    return { statusCode: 410, headers: HEADERS, body: JSON.stringify({ error: 'Booking not found or invalidated' }) };
  }

  // Load the block request metadata
  const reqResult = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `BLOCKREQ#${payload.reqId}`, SK: 'METADATA' },
  }));

  const blockReq = reqResult.Item;
  if (!blockReq) {
    return { statusCode: 410, headers: HEADERS, body: JSON.stringify({ error: 'Reservation not found' }) };
  }

  // Load the pool listing details for the response
  let poolDetails: Record<string, unknown> | null = null;
  if (booking.listingId) {
    const poolResult = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `POOL#${booking.listingId}`, SK: 'METADATA' },
    }));
    if (poolResult.Item) {
      poolDetails = {
        poolListingId: poolResult.Item.poolListingId ?? poolResult.Item.listingId,
        name: poolResult.Item.name,
        address: poolResult.Item.address,
        latitude: poolResult.Item.lat ?? poolResult.Item.latitude,
        longitude: poolResult.Item.lng ?? poolResult.Item.longitude,
        spotType: poolResult.Item.spotType,
        instructions: poolResult.Item.accessInstructions ?? poolResult.Item.instructions ?? null,
      };
    }
  }

  // Provision stub Spotter user on first click (if no spotterId set yet)
  const now = new Date().toISOString();
  let spotterId = booking.spotterId;

  if (!spotterId && booking.guestEmail) {
    // Check if a user with this email already exists
    const existingUserResult = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :email',
      ExpressionAttributeValues: { ':email': `EMAIL#${booking.guestEmail.toLowerCase()}` },
      Limit: 1,
    }));

    if (existingUserResult.Items && existingUserResult.Items.length > 0) {
      spotterId = existingUserResult.Items[0].userId;
    } else {
      // Create stub user
      spotterId = ulid();
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `USER#${spotterId}`,
          SK: 'PROFILE',
          GSI1PK: `EMAIL#${booking.guestEmail.toLowerCase()}`,
          GSI1SK: 'PROFILE',
          userId: spotterId,
          email: booking.guestEmail,
          displayName: booking.guestName ?? 'Guest',
          phone: booking.guestPhone ?? null,
          spotterStatus: 'STUB',
          createdAt: now,
          updatedAt: now,
        },
      }));
    }

    // Link the spotter to the booking
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `BLOCKREQ#${payload.reqId}`, SK: `BOOKING#${payload.bookingId}` },
      UpdateExpression: 'SET spotterId = :sid, updatedAt = :now',
      ExpressionAttributeValues: { ':sid': spotterId, ':now': now },
    }));
  }

  log.info('magic link claimed', { bookingId: payload.bookingId, spotterId });

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      bookingId: booking.bookingId,
      reqId: payload.reqId,
      bayId: booking.bayId,
      guestName: booking.guestName,
      startsAt: blockReq.startsAt,
      endsAt: blockReq.endsAt,
      spotterId,
      pool: poolDetails,
    }),
  };
};
