import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { ulid } from 'ulid';
import { extractClaims } from '../../../shared/utils/auth';
import { ok, created, badRequest, unauthorized, notFound, conflict, forbidden } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, ACTIVE_LOCALE_HEADER } from '../../../shared/locales/constants';
import type { SupportedLocale } from '../../../shared/locales/constants';
import {
  validateGuestEmail,
  validateGuestPhone,
  validateGuestRow,
} from '../../../shared/block-reservations/validation';
import type { BlockRequest, BlockAllocation, BlockBooking } from '../../../shared/block-reservations/types';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';

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

interface GuestInput {
  name: string;
  email: string;
  phone: string;
}

/**
 * Simple bay allocator for guest-add: assigns guests to available reserved bays
 * in order of allocation (first alloc first), picking lexicographically lowest available bayId.
 */
function assignGuestsToBays(
  guests: GuestInput[],
  allocations: BlockAllocation[],
  existingBookings: Array<{ bayId: string; allocId: string }>
): Array<{ guest: GuestInput; allocId: string; bayId: string; listingId: string }> | null {
  // Build a map of occupied bays per allocation
  const occupiedByAlloc: Record<string, Set<string>> = {};
  for (const b of existingBookings) {
    if (!occupiedByAlloc[b.allocId]) occupiedByAlloc[b.allocId] = new Set();
    occupiedByAlloc[b.allocId].add(b.bayId);
  }

  // For each allocation, compute available bays
  const availableByAlloc: Array<{ allocId: string; bayIds: string[]; listingId: string }> = [];
  for (const alloc of allocations) {
    const occupied = occupiedByAlloc[alloc.allocId] ?? new Set();
    const available = alloc.assignedBayIds.filter((id) => !occupied.has(id)).sort();
    availableByAlloc.push({
      allocId: alloc.allocId,
      bayIds: available,
      listingId: alloc.poolListingId,
    });
  }

  // Total available
  const totalAvailable = availableByAlloc.reduce((sum, a) => sum + a.bayIds.length, 0);
  if (guests.length > totalAvailable) {
    return null; // Over-allocation
  }

  const assignments: Array<{ guest: GuestInput; allocId: string; bayId: string; listingId: string }> = [];

  for (const guest of guests) {
    let assigned = false;
    for (const pool of availableByAlloc) {
      if (pool.bayIds.length > 0) {
        const bayId = pool.bayIds.shift()!;
        assignments.push({
          guest,
          allocId: pool.allocId,
          bayId,
          listingId: pool.listingId,
        });
        assigned = true;
        break;
      }
    }
    if (!assigned) return null;
  }

  return assignments;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const claims = extractClaims(event);
  const log = createLogger('block-guest-add', event.requestContext.requestId, claims?.userId);

  if (!claims) return unauthorized();

  const reqId = event.pathParameters?.reqId;
  if (!reqId) return notFound();

  let body: { guests: GuestInput[] };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return badRequest('INVALID_JSON');
  }

  if (!body.guests || !Array.isArray(body.guests) || body.guests.length === 0) {
    return badRequest('GUESTS_REQUIRED');
  }

  // Validate each guest row
  for (const guest of body.guests) {
    if (!validateGuestEmail(guest.email)) {
      return badRequest('INVALID_GUEST_EMAIL');
    }
    if (!validateGuestPhone(guest.phone)) {
      return badRequest('INVALID_GUEST_PHONE');
    }
    const rowResult = validateGuestRow(guest);
    if (!rowResult.valid) {
      return badRequest(`INVALID_GUEST: ${rowResult.errors.join(', ')}`);
    }
  }

  // Check for duplicate emails within the submission
  const emailSet = new Set<string>();
  for (const guest of body.guests) {
    const lower = guest.email.toLowerCase();
    if (emailSet.has(lower)) return badRequest('DUPLICATE_GUEST_EMAIL');
    emailSet.add(lower);
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

  // Resolve the block spotter's locale for guest defaults
  const rawLocale = event.headers?.[ACTIVE_LOCALE_HEADER] ?? event.headers?.['spotzy-active-locale'] ?? '';
  const blockSpotterLocale: SupportedLocale =
    (SUPPORTED_LOCALES as readonly string[]).includes(rawLocale) ? rawLocale as SupportedLocale : DEFAULT_LOCALE;

  // Must be CONFIRMED or AUTHORISED to add guests
  if (!['CONFIRMED', 'AUTHORISED'].includes(metadata.status)) {
    return conflict('REQUEST_NOT_CONFIRMED');
  }

  // Check window hasn't started
  const now = new Date();
  if (now >= new Date(metadata.startsAt)) {
    return conflict('WINDOW_CLOSED');
  }

  const allocations = items.filter(
    (i) => typeof i.SK === 'string' && i.SK.startsWith('BLOCKALLOC#')
  ) as unknown as BlockAllocation[];

  const existingBookings = items
    .filter((i) => typeof i.SK === 'string' && i.SK.startsWith('BOOKING#'))
    .map((b) => ({ bayId: b.bayId as string, allocId: b.allocId as string, guestEmail: b.guestEmail as string | null }));

  // Check for duplicate emails against existing bookings
  for (const guest of body.guests) {
    const lower = guest.email.toLowerCase();
    if (existingBookings.some((b) => b.guestEmail?.toLowerCase() === lower)) {
      return badRequest('DUPLICATE_GUEST_EMAIL');
    }
  }

  // Total capacity check
  const totalContributed = allocations.reduce((sum, a) => sum + a.contributedBayCount, 0);
  const existingAllocatedCount = existingBookings.length;
  if (existingAllocatedCount + body.guests.length > totalContributed) {
    return badRequest('OVER_ALLOCATION');
  }

  // Assign guests to bays
  const assignments = assignGuestsToBays(body.guests, allocations, existingBookings);
  if (!assignments) {
    return badRequest('OVER_ALLOCATION');
  }

  const nowIso = now.toISOString();
  const createdBookings: Array<{ bookingId: string; bayId: string; allocId: string }> = [];

  // Write BOOKING# rows atomically (TransactWriteItems, max 100)
  // If > 100 guests, chunk them
  const chunks: typeof assignments[] = [];
  for (let i = 0; i < assignments.length; i += 25) {
    chunks.push(assignments.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    const transactItems: Array<{
      Put?: { TableName: string; Item: Record<string, unknown>; ConditionExpression?: string };
      Update?: { TableName: string; Key: Record<string, unknown>; UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown> };
    }> = [];

    for (const assignment of chunk) {
      const bookingId = ulid();
      createdBookings.push({ bookingId, bayId: assignment.bayId, allocId: assignment.allocId });

      transactItems.push({
        Put: {
          TableName: TABLE,
          Item: {
            PK: `BLOCKREQ#${reqId}`,
            SK: `BOOKING#${bookingId}`,
            bookingId,
            reqId,
            allocId: assignment.allocId,
            bayId: assignment.bayId,
            listingId: assignment.listingId,
            guestName: assignment.guest.name,
            guestEmail: assignment.guest.email,
            guestPhone: assignment.guest.phone,
            guestPreferredLocale: (assignment.guest as any).preferredLocale ?? blockSpotterLocale,
            guestLocaleSource: (assignment.guest as any).preferredLocale ? 'manual_override' : 'block_spotter_default',
            spotterId: null,
            emailStatus: 'PENDING',
            emailSentAt: null,
            emailBouncedAt: null,
            allocationStatus: 'ALLOCATED',
            source: 'BLOCK_RESERVATION',
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        },
      });
    }

    // Also update allocatedBayCount on affected BLOCKALLOC#s
    const countsInChunk: Record<string, number> = {};
    for (const assignment of chunk) {
      countsInChunk[assignment.allocId] = (countsInChunk[assignment.allocId] ?? 0) + 1;
    }

    for (const [allocId, count] of Object.entries(countsInChunk)) {
      transactItems.push({
        Update: {
          TableName: TABLE,
          Key: { PK: `BLOCKREQ#${reqId}`, SK: `BLOCKALLOC#${allocId}` },
          UpdateExpression: 'SET allocatedBayCount = allocatedBayCount + :c, updatedAt = :now',
          ExpressionAttributeValues: { ':c': count, ':now': nowIso },
        },
      });
    }

    await ddb.send(new TransactWriteCommand({ TransactItems: transactItems }));
  }

  // Send magic link emails
  for (let i = 0; i < assignments.length; i++) {
    const assignment = assignments[i];
    const booking = createdBookings[i];
    try {
      // Generate a simple token (in production this would be a signed JWT)
      const tokenPayload = Buffer.from(
        JSON.stringify({
          bookingId: booking.bookingId,
          bayId: assignment.bayId,
          reqId,
          exp: new Date(new Date(metadata.endsAt).getTime() + 48 * 60 * 60 * 1000).toISOString(),
        })
      ).toString('base64url');

      const claimUrl = `${process.env.FRONTEND_URL ?? 'https://spotzy.be'}/claim/${tokenPayload}`;

      await ses.send(
        new SendEmailCommand({
          Source: process.env.SES_FROM_EMAIL ?? 'noreply@spotzy.be',
          Destination: { ToAddresses: [assignment.guest.email] },
          Message: {
            Subject: { Data: 'Your parking reservation is ready' },
            Body: {
              Html: {
                Data: `<p>Hello ${assignment.guest.name},</p><p>You have been assigned a parking bay. <a href="${claimUrl}">Click here to view your reservation</a>.</p>`,
              },
            },
          },
        })
      );

      // Update email status to SENT
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { PK: `BLOCKREQ#${reqId}`, SK: `BOOKING#${booking.bookingId}` },
          UpdateExpression: 'SET emailStatus = :s, emailSentAt = :now, updatedAt = :now',
          ExpressionAttributeValues: { ':s': 'SENT', ':now': nowIso },
        })
      );
    } catch (err) {
      log.warn('failed to send magic link', { bookingId: booking.bookingId, err });
    }
  }

  log.info('guests added', { reqId, count: body.guests.length });

  return created({
    reqId,
    addedCount: body.guests.length,
    bookings: createdBookings.map((b) => ({
      bookingId: b.bookingId,
      bayId: b.bayId,
      allocId: b.allocId,
    })),
  });
};
