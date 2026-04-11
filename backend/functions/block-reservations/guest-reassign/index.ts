import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, badRequest, unauthorized, notFound, conflict } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { validateGuestEmail, validateGuestPhone } from '../../../shared/block-reservations/validation';
import type { BlockRequest, BlockAllocation, BlockBooking } from '../../../shared/block-reservations/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

const forbidden = () => ({
  statusCode: 403,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ error: 'Forbidden' }),
});

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('block-guest-reassign', event.requestContext.requestId, claims?.userId);

  if (!claims) return unauthorized();

  const reqId = event.pathParameters?.reqId;
  const bookingId = event.pathParameters?.bookingId;
  if (!reqId || !bookingId) return notFound();

  let body: { targetBayId?: string; guestEmail?: string; guestName?: string; guestPhone?: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return badRequest('INVALID_JSON');
  }

  // Load the BLOCKREQ# partition
  const queryResult = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `BLOCKREQ#${reqId}` },
    })
  );

  const items = queryResult.Items ?? [];
  const metadata = items.find((i) => i.SK === 'METADATA') as unknown as BlockRequest | undefined;
  if (!metadata) return notFound();

  if (metadata.ownerUserId !== claims.userId) return forbidden();

  if (!['CONFIRMED', 'AUTHORISED'].includes(metadata.status)) {
    return conflict('REQUEST_NOT_CONFIRMED');
  }

  // Find the booking
  const bookingItem = items.find(
    (i) => i.SK === `BOOKING#${bookingId}`
  ) as unknown as BlockBooking | undefined;
  if (!bookingItem) return notFound();

  const allocations = items.filter(
    (i) => typeof i.SK === 'string' && i.SK.startsWith('BLOCKALLOC#')
  ) as unknown as BlockAllocation[];

  const allBookings = items.filter(
    (i) => typeof i.SK === 'string' && i.SK.startsWith('BOOKING#')
  ) as unknown as BlockBooking[];

  const nowIso = new Date().toISOString();

  // Bay swap
  if (body.targetBayId) {
    const targetBayId = body.targetBayId;

    // Check target bay is part of this BLOCKREQ#'s assigned bays
    const targetAlloc = allocations.find((a) =>
      a.assignedBayIds.includes(targetBayId)
    );
    if (!targetAlloc) return badRequest('BAY_NOT_IN_RESERVATION');

    // Check target bay is not occupied
    const occupied = allBookings.some(
      (b) => b.bayId === targetBayId && b.allocationStatus === 'ALLOCATED' && b.bookingId !== bookingId
    );
    if (occupied) return badRequest('BAY_OCCUPIED');

    const currentAlloc = allocations.find((a) => a.allocId === bookingItem.allocId);
    const isCrossPool = targetAlloc.allocId !== bookingItem.allocId;

    const auditEntry = {
      timestamp: nowIso,
      actorUserId: claims.userId,
      action: 'GUEST_BAY_SWAP',
      before: { bookingId, bayId: bookingItem.bayId, allocId: bookingItem.allocId },
      after: { bookingId, bayId: targetBayId, allocId: targetAlloc.allocId },
    };

    if (isCrossPool) {
      // Cross-pool swap — update both BLOCKALLOC# counts + the BOOKING#
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: TABLE,
                Key: { PK: `BLOCKREQ#${reqId}`, SK: `BOOKING#${bookingId}` },
                UpdateExpression: 'SET bayId = :bay, allocId = :alloc, listingId = :listing, updatedAt = :now',
                ExpressionAttributeValues: {
                  ':bay': targetBayId,
                  ':alloc': targetAlloc.allocId,
                  ':listing': targetAlloc.poolListingId,
                  ':now': nowIso,
                },
              },
            },
            {
              Update: {
                TableName: TABLE,
                Key: { PK: `BLOCKREQ#${reqId}`, SK: `BLOCKALLOC#${bookingItem.allocId}` },
                UpdateExpression: 'SET allocatedBayCount = allocatedBayCount - :one, updatedAt = :now',
                ExpressionAttributeValues: { ':one': 1, ':now': nowIso },
              },
            },
            {
              Update: {
                TableName: TABLE,
                Key: { PK: `BLOCKREQ#${reqId}`, SK: `BLOCKALLOC#${targetAlloc.allocId}` },
                UpdateExpression: 'SET allocatedBayCount = allocatedBayCount + :one, updatedAt = :now',
                ExpressionAttributeValues: { ':one': 1, ':now': nowIso },
              },
            },
          ],
        })
      );
    } else {
      // Same pool swap — just update the BOOKING#
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `BLOCKREQ#${reqId}`, SK: `BOOKING#${bookingId}` },
          UpdateExpression: 'SET bayId = :bay, updatedAt = :now',
          ExpressionAttributeValues: { ':bay': targetBayId, ':now': nowIso },
        })
      );
    }

    // Append audit log to BLOCKREQ#
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
        UpdateExpression:
          'SET auditLog = list_append(if_not_exists(auditLog, :empty), :entry), updatedAt = :now',
        ExpressionAttributeValues: { ':entry': [auditEntry], ':empty': [], ':now': nowIso },
      })
    );

    // Send fresh magic link
    if (bookingItem.guestEmail) {
      try {
        const tokenPayload = Buffer.from(
          JSON.stringify({
            bookingId,
            bayId: targetBayId,
            reqId,
            exp: new Date(new Date(metadata.endsAt).getTime() + 48 * 60 * 60 * 1000).toISOString(),
          })
        ).toString('base64url');

        const claimUrl = `${process.env.FRONTEND_URL ?? 'https://spotzy.be'}/claim/${tokenPayload}`;

        await ses.send(
          new SendEmailCommand({
            Source: process.env.SES_FROM_EMAIL ?? 'noreply@spotzy.be',
            Destination: { ToAddresses: [bookingItem.guestEmail] },
            Message: {
              Subject: { Data: 'Your parking bay has been updated' },
              Body: {
                Html: {
                  Data: `<p>Your bay assignment has been updated. <a href="${claimUrl}">View your updated reservation</a>.</p>`,
                },
              },
            },
          })
        );
      } catch (err) {
        log.warn('failed to send updated magic link', { bookingId, err });
      }
    }

    log.info('bay swapped', { bookingId, from: bookingItem.bayId, to: targetBayId, crossPool: isCrossPool });
    return ok({ bookingId, bayId: targetBayId, allocId: targetAlloc.allocId });
  }

  // Guest details update
  if (body.guestEmail || body.guestName || body.guestPhone) {
    if (body.guestEmail && !validateGuestEmail(body.guestEmail)) {
      return badRequest('INVALID_GUEST_EMAIL');
    }
    if (body.guestPhone && !validateGuestPhone(body.guestPhone)) {
      return badRequest('INVALID_GUEST_PHONE');
    }

    const updateParts: string[] = ['updatedAt = :now'];
    const exprValues: Record<string, unknown> = { ':now': nowIso };

    if (body.guestName) {
      updateParts.push('guestName = :name');
      exprValues[':name'] = body.guestName;
    }
    if (body.guestEmail) {
      updateParts.push('guestEmail = :email, emailStatus = :pending');
      exprValues[':email'] = body.guestEmail;
      exprValues[':pending'] = 'PENDING';
    }
    if (body.guestPhone) {
      updateParts.push('guestPhone = :phone');
      exprValues[':phone'] = body.guestPhone;
    }

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `BLOCKREQ#${reqId}`, SK: `BOOKING#${bookingId}` },
        UpdateExpression: `SET ${updateParts.join(', ')}`,
        ExpressionAttributeValues: exprValues,
      })
    );

    const auditEntry = {
      timestamp: nowIso,
      actorUserId: claims.userId,
      action: 'GUEST_DETAILS_UPDATED',
      before: {
        guestName: bookingItem.guestName,
        guestEmail: bookingItem.guestEmail,
        guestPhone: bookingItem.guestPhone,
      },
      after: {
        guestName: body.guestName ?? bookingItem.guestName,
        guestEmail: body.guestEmail ?? bookingItem.guestEmail,
        guestPhone: body.guestPhone ?? bookingItem.guestPhone,
      },
    };

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `BLOCKREQ#${reqId}`, SK: 'METADATA' },
        UpdateExpression:
          'SET auditLog = list_append(if_not_exists(auditLog, :empty), :entry), updatedAt = :now',
        ExpressionAttributeValues: { ':entry': [auditEntry], ':empty': [], ':now': nowIso },
      })
    );

    // Send fresh magic link to new email
    const targetEmail = body.guestEmail ?? bookingItem.guestEmail;
    if (targetEmail) {
      try {
        const tokenPayload = Buffer.from(
          JSON.stringify({
            bookingId,
            bayId: bookingItem.bayId,
            reqId,
            exp: new Date(new Date(metadata.endsAt).getTime() + 48 * 60 * 60 * 1000).toISOString(),
          })
        ).toString('base64url');

        const claimUrl = `${process.env.FRONTEND_URL ?? 'https://spotzy.be'}/claim/${tokenPayload}`;

        await ses.send(
          new SendEmailCommand({
            Source: process.env.SES_FROM_EMAIL ?? 'noreply@spotzy.be',
            Destination: { ToAddresses: [targetEmail] },
            Message: {
              Subject: { Data: 'Your parking reservation details' },
              Body: {
                Html: {
                  Data: `<p>Your reservation details have been updated. <a href="${claimUrl}">View your reservation</a>.</p>`,
                },
              },
            },
          })
        );

        await ddb.send(
          new UpdateCommand({
            TableName: TABLE,
            Key: { PK: `BLOCKREQ#${reqId}`, SK: `BOOKING#${bookingId}` },
            UpdateExpression: 'SET emailStatus = :s, emailSentAt = :now',
            ExpressionAttributeValues: { ':s': 'SENT', ':now': nowIso },
          })
        );
      } catch (err) {
        log.warn('failed to send magic link', { bookingId, err });
      }
    }

    log.info('guest details updated', { bookingId });
    return ok({ bookingId, updated: true });
  }

  return badRequest('NO_UPDATE_PROVIDED');
};
