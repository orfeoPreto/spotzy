import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { extractAdminClaims } from '../../../shared/utils/admin-guard';
import { forbidden } from '../../../shared/utils/admin-response';
import { ok } from '../../../shared/utils/response';
import { createLogger } from '../../../shared/utils/logger';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const PAGE_SIZE = 25;

/** Derive display name: pseudo > firstName > 'Unknown' */
const deriveDisplayName = (user: Record<string, unknown>): string => {
  const pseudo = user.pseudo as string | null | undefined;
  if (pseudo?.trim()) return pseudo.trim();
  const firstName = user.firstName as string | undefined;
  if (firstName) return firstName;
  const name = user.name as string | undefined;
  if (name) return name.split(' ')[0];
  return 'Unknown';
};

/** Query reviews targeting this user and compute average rating */
const getRating = async (userId: string): Promise<number | null> => {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `REVIEW#${userId}` },
  }));
  const reviews = result.Items ?? [];
  if (reviews.length === 0) return null;
  const total = reviews.reduce((sum, r) => sum + ((r.avgScore as number) ?? 0), 0);
  return Math.round((total / reviews.length) * 10) / 10;
};

/** Query listing count via HOST#{userId} GSI */
const getListingCount = async (userId: string): Promise<number> => {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `HOST#${userId}` },
    Select: 'COUNT',
  }));
  return result.Count ?? 0;
};

/** Query booking count — as spotter (SPOTTER#{userId}) + as host (via scan or GSI) */
const getBookingCount = async (userId: string): Promise<number> => {
  const [asSpotter, asHost] = await Promise.all([
    ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `SPOTTER#${userId}` },
      Select: 'COUNT',
    })),
    ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `HOST_BOOKING#${userId}` },
      Select: 'COUNT',
    })),
  ]);
  return (asSpotter.Count ?? 0) + (asHost.Count ?? 0);
};

/** Count BLOCKREQ# records for a user (indicates BLOCK_SPOTTER persona) */
const getBlockRequestCount = async (userId: string): Promise<number> => {
  try {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'BLOCKREQ#' },
      Select: 'COUNT',
    }));
    return res.Count ?? 0;
  } catch {
    return 0;
  }
};

/** Build personas array. SPOTTER is always present; HOST, SPOT_MANAGER, BLOCK_SPOTTER
 *  are additive based on profile flags and activity. */
const buildPersonas = (user: Record<string, unknown>, blockRequestCount: number): string[] => {
  const personas: string[] = ['SPOTTER'];
  if (user.stripeConnectAccountId || user.stripeConnectEnabled || user.isHost) {
    personas.push('HOST');
  }
  // Session 26: Spot Manager is active when the commitment gate has been submitted
  // (STAGED = pending RC review) or approved (ACTIVE).
  const smStatus = user.spotManagerStatus as string | undefined;
  if (smStatus === 'STAGED' || smStatus === 'ACTIVE') {
    personas.push('SPOT_MANAGER');
  }
  // Session 27: Block Spotter is active for any user who has submitted at least
  // one block reservation request.
  if (blockRequestCount > 0) {
    personas.push('BLOCK_SPOTTER');
  }
  return personas;
};

export const handler: APIGatewayProxyHandler = async (event) => {
  const admin = extractAdminClaims(event);
  const log = createLogger('admin-customers-list', event.requestContext.requestId, admin?.userId);
  if (!admin) return forbidden();

  const params = event.queryStringParameters ?? {};
  const page = Math.max(1, parseInt(params.page ?? '1', 10));
  const search = params.search?.toLowerCase();
  const sortBy = params.sortBy ?? 'displayName';
  const sortDir = params.sortDir ?? 'asc';
  const filter = params.filter;

  // Scan for USER profiles
  const scanResult = await ddb.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'SK = :sk AND begins_with(PK, :prefix)',
    ExpressionAttributeValues: { ':sk': 'PROFILE', ':prefix': 'USER#' },
  }));

  let users = scanResult.Items ?? [];

  // Apply search filter
  if (search) {
    users = users.filter((u) => {
      const dn = deriveDisplayName(u).toLowerCase();
      const fn = `${u.firstName ?? ''} ${u.lastName ?? ''}`.toLowerCase();
      const em = (u.email as string ?? '').toLowerCase();
      return dn.includes(search) || fn.includes(search) || em.includes(search);
    });
  }

  // Apply type filter
  if (filter === 'hosts') {
    users = users.filter((u) => !!u.stripeConnectAccountId);
  } else if (filter === 'has_disputes') {
    users = users.filter((u) => (u.disputeCount as number ?? 0) > 0);
  }

  // Enrich users with computed fields
  const enrichedCustomers = await Promise.all(
    users.map(async (u) => {
      const userId = (u.userId as string) ?? (u.PK as string).replace('USER#', '');
      const [rating, listingCount, bookingCount, blockRequestCount] = await Promise.all([
        getRating(userId),
        getListingCount(userId),
        getBookingCount(userId),
        getBlockRequestCount(userId),
      ]);
      return {
        userId,
        displayName: deriveDisplayName(u),
        fullName: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || null,
        email: u.email ?? null,
        personas: buildPersonas(u, blockRequestCount),
        isHost: !!(u.stripeConnectAccountId || u.stripeConnectEnabled),
        rating,
        listingCount,
        bookingCount,
        disputeCount: (u.disputeCount as number) ?? 0,
        memberSince: u.createdAt ?? null,
      };
    }),
  );

  // Sort
  enrichedCustomers.sort((a, b) => {
    const aVal = (a as any)[sortBy] ?? '';
    const bVal = (b as any)[sortBy] ?? '';
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
    }
    const cmp = String(aVal).localeCompare(String(bVal));
    return sortDir === 'desc' ? -cmp : cmp;
  });

  const total = enrichedCustomers.length;
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = enrichedCustomers.slice(start, start + PAGE_SIZE);

  log.info('customers listed', { total, page, count: pageItems.length });
  return ok({ customers: pageItems, total, page, pageSize: PAGE_SIZE });
};
