import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/listings/get/index';
import { mockAuthContext, TEST_USER_ID, TEST_LISTING_ID } from '../setup';

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

const makeEvent = (id: string, auth?: any): APIGatewayProxyEvent =>
  ({ requestContext: {}, ...(auth || {}), body: null, pathParameters: { id }, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false, path: `/listings/${id}`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('listing-get', () => {
  it('live listing → 200 with full listing', async () => {
    const res = await handler(makeEvent(TEST_LISTING_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(JSON.parse(res!.body).listingId).toBe(TEST_LISTING_ID);
  });

  it('owner requesting draft → 200', async () => {
    ddbMock.on(GetCommand).resolves({ Item: draftListing });
    const res = await handler(makeEvent(TEST_LISTING_ID, mockAuthContext(TEST_USER_ID)), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('non-existent listing → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(makeEvent('nonexistent'), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  it('draft listing, requester not host → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: draftListing });
    const res = await handler(makeEvent(TEST_LISTING_ID, mockAuthContext('other_user')), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });

  it('draft listing, no auth → 404', async () => {
    ddbMock.on(GetCommand).resolves({ Item: draftListing });
    const res = await handler(makeEvent(TEST_LISTING_ID), {} as any, () => {});
    expect(res!.statusCode).toBe(404);
  });
});
