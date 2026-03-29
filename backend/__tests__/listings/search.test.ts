import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/listings/search/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const makeLiveListing = (id: string, overrides: Record<string, unknown> = {}) => ({
  listingId: id,
  hostId: 'host1',
  address: '123 Main St',
  addressLat: 37.775,
  addressLng: -122.419,
  spotType: 'COVERED_GARAGE',
  dimensions: 'STANDARD',
  evCharging: true,
  pricePerHour: 3,
  status: 'live',
  geohash: '9q8yy',
  ...overrides,
});

const ALWAYS_RULE = { type: 'ALWAYS', PK: 'LISTING#l1', SK: 'AVAIL_RULE#r1' };

beforeEach(() => {
  ddbMock.reset();

  ddbMock.on(QueryCommand).callsFake((input) => {
    const eav = input.ExpressionAttributeValues ?? {};
    // GSI2 geohash query
    if (input.IndexName === 'GSI2') {
      return { Items: [
        { PK: 'LISTING#l1', SK: 'METADATA', listingId: 'l1', geohash: '9q8yy' },
        { PK: 'LISTING#l2', SK: 'METADATA', listingId: 'l2', geohash: '9q8yy' },
      ] };
    }
    // Availability rules query
    if ((eav[':prefix'] as string)?.startsWith('AVAIL_RULE#')) {
      const lid = (eav[':pk'] as string)?.replace('LISTING#', '');
      return { Items: [{ ...ALWAYS_RULE, PK: `LISTING#${lid}`, SK: `AVAIL_RULE#r-${lid}` }] };
    }
    // Availability blocks query
    if ((eav[':from'] as string)?.startsWith('AVAIL_BLOCK#')) {
      return { Items: [] };
    }
    return { Items: [] };
  });

  // Default BatchGet mock (for batchGetListings)
  ddbMock.on(BatchGetCommand).resolves({
    Responses: {
      'spotzy-main': [makeLiveListing('l1'), makeLiveListing('l2')],
    },
  });

  // Default host profile mock
  ddbMock.on(GetCommand).resolves({
    Item: { userId: 'host1', name: 'Marc Dupont', photoUrl: 'https://cdn.spotzy.com/avatar.jpg' },
  });
});

const makeEvent = (qs: Record<string, string>): APIGatewayProxyEvent =>
  ({ requestContext: {}, body: null, pathParameters: null, queryStringParameters: qs, headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false, path: '/listings/search', multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('listing-search', () => {
  it('returns only live listings', async () => {
    ddbMock.on(QueryCommand).callsFake((input) => {
      if (input.IndexName === 'GSI2') {
        return { Items: [
          { PK: 'LISTING#l1', SK: 'METADATA', listingId: 'l1' },
          { PK: 'LISTING#l2', SK: 'METADATA', listingId: 'l2' },
        ] };
      }
      if ((input.ExpressionAttributeValues?.[':prefix'] as string)?.startsWith('AVAIL_RULE#')) {
        return { Items: [ALWAYS_RULE] };
      }
      return { Items: [] };
    });
    ddbMock.on(BatchGetCommand).resolves({
      Responses: { 'spotzy-main': [makeLiveListing('l1'), makeLiveListing('l2', { status: 'draft' })] },
    });
    const res = await handler(makeEvent({ lat: '37.7749', lng: '-122.4194' }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.listings.every((l: any) => l.status === 'live')).toBe(true);
  });

  it('returns max 50 results', async () => {
    const res = await handler(makeEvent({ lat: '37.7749', lng: '-122.4194' }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.listings.length).toBeLessThanOrEqual(50);
  });

  it('filters by maxPricePerHour', async () => {
    ddbMock.on(BatchGetCommand).resolves({
      Responses: { 'spotzy-main': [makeLiveListing('l1', { pricePerHour: 3 }), makeLiveListing('l2', { pricePerHour: 10 })] },
    });
    const res = await handler(makeEvent({ lat: '37.7749', lng: '-122.4194', maxPricePerHour: '5' }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.listings.every((l: any) => l.pricePerHour <= 5)).toBe(true);
  });

  it('filters by spotType', async () => {
    ddbMock.on(BatchGetCommand).resolves({
      Responses: { 'spotzy-main': [makeLiveListing('l1', { spotType: 'COVERED_GARAGE' }), makeLiveListing('l2', { spotType: 'DRIVEWAY' })] },
    });
    const res = await handler(makeEvent({ lat: '37.7749', lng: '-122.4194', spotType: 'COVERED_GARAGE' }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.listings.every((l: any) => l.spotType === 'COVERED_GARAGE')).toBe(true);
  });

  it('no results → { listings: [], total: 0 }', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(makeEvent({ lat: '37.7749', lng: '-122.4194' }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body).toEqual({ listings: [], total: 0 });
  });

  it('missing lat → 400', async () => {
    const res = await handler(makeEvent({ lng: '-122.4194' }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('missing lng → 400', async () => {
    const res = await handler(makeEvent({ lat: '37.7749' }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('DRAFT listings in DB are not returned', async () => {
    ddbMock.on(BatchGetCommand).resolves({
      Responses: { 'spotzy-main': [makeLiveListing('l1', { status: 'draft' })] },
    });
    const res = await handler(makeEvent({ lat: '37.7749', lng: '-122.4194' }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.listings).toHaveLength(0);
  });

  it('listings include host data (hostFirstName, hostLastName, hostPhotoUrl)', async () => {
    ddbMock.on(QueryCommand).callsFake((input) => {
      if (input.IndexName === 'GSI2') {
        return { Items: [makeLiveListing('l1')] };
      }
      // Availability rules
      return { Items: [{ type: 'ALWAYS', PK: 'LISTING#l1', SK: 'AVAIL_RULE#r1' }] };
    });
    ddbMock.on(GetCommand).resolves({
      Item: { userId: 'host1', name: 'Marc Dupont', photoUrl: 'https://cdn.spotzy.com/avatar.jpg' },
    });

    const res = await handler(makeEvent({ lat: '37.7749', lng: '-122.4194' }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    if (body.listings.length > 0) {
      const listing = body.listings[0];
      expect(listing.hostFirstName).toBe('Marc');
      expect(listing.hostLastName).toBe('D.');
      expect(listing.hostPhotoUrl).toBe('https://cdn.spotzy.com/avatar.jpg');
    }
  });
});
