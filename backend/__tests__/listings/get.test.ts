import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/listings/get/index';
import { TEST_USER_ID, TEST_LISTING_ID } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

const liveListing = {
  PK: `LISTING#${TEST_LISTING_ID}`, SK: 'METADATA',
  listingId: TEST_LISTING_ID, hostId: TEST_USER_ID,
  status: 'live', address: '123 Main St',
};

const draftListing = { ...liveListing, status: 'draft' };

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: liveListing });
});

const makeJwt = (sub: string) => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, email: 'test@spotzy.com' })).toString('base64url');
  return `${header}.${payload}.fakesig`;
};

const makeEvent = (id: string, auth?: any): APIGatewayProxyEvent => {
  const headers: Record<string, string> = {};
  if (auth?.userId) {
    headers['Authorization'] = `Bearer ${makeJwt(auth.userId)}`;
  }
  return { requestContext: {}, body: null, pathParameters: { id }, queryStringParameters: null, headers, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false, path: `/listings/${id}`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent;
};

describe('listing-get', () => {
  it('live listing → 200 with full listing', async () => {
    const res = await handler(makeEvent(TEST_LISTING_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(JSON.parse(res!.body).listingId).toBe(TEST_LISTING_ID);
  });

  it('owner requesting draft → 200', async () => {
    ddbMock.on(GetCommand).resolves({ Item: draftListing });
    const res = await handler(makeEvent(TEST_LISTING_ID, { userId: TEST_USER_ID }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('non-existent listing → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(makeEvent('nonexistent'), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  it('draft listing, requester not host → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: draftListing });
    const res = await handler(makeEvent(TEST_LISTING_ID, { userId: 'other_user' }), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  it('draft listing, no auth → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: draftListing });
    const res = await handler(makeEvent(TEST_LISTING_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });
});
