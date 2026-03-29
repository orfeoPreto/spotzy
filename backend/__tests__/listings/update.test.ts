import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/listings/update/index';
import { mockAuthContext, TEST_USER_ID, TEST_LISTING_ID } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

const existingListing = {
  PK: `LISTING#${TEST_LISTING_ID}`,
  SK: 'METADATA',
  listingId: TEST_LISTING_ID,
  hostId: TEST_USER_ID,
  address: '123 Main St',
  addressLat: 37.7749,
  addressLng: -122.4194,
  spotType: 'COVERED_GARAGE',
  dimensions: 'STANDARD',
  evCharging: false,
  pricePerHour: 5,
  status: 'draft',
  geohash: 'abc12',
};

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: existingListing });
  ddbMock.on(UpdateCommand).resolves({ Attributes: { ...existingListing, address: '456 New St' } });
});

const makeEvent = (body: object, auth = mockAuthContext(), listingId = TEST_LISTING_ID): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify(body), pathParameters: { id: listingId }, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'PUT', isBase64Encoded: false, path: `/listings/${listingId}`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('listing-update', () => {
  it('updates allowed fields → 200 with updated values', async () => {
    const res = await handler(makeEvent({ address: '456 New St' }), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('address change → geohash is recomputed', async () => {
    await handler(makeEvent({ address: '456 New St', addressLat: 34.0522, addressLng: -118.2437 }), {} as any, () => {});
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    const expr = call.args[0].input.ExpressionAttributeValues as Record<string, unknown>;
    // geohash should be present in the update expression values
    const hasGeohash = Object.values(expr).some(v => typeof v === 'string' && v.length === 5);
    expect(hasGeohash).toBe(true);
  });

  it('non-owner → 403', async () => {
    const res = await handler(makeEvent({ address: '456' }, mockAuthContext('other_user')), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });

  it('missing auth → 401', async () => {
    const res = await handler(makeEvent({ address: '456' }, { requestContext: {} } as any), {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  it('listingId in body is ignored', async () => {
    await handler(makeEvent({ listingId: 'other_id', address: '456 New St' }), {} as any, () => {});
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    const expr = call.args[0].input.UpdateExpression as string;
    expect(expr).not.toContain('listingId');
  });

  it('hostId in body is ignored', async () => {
    await handler(makeEvent({ hostId: 'other_host', address: '456 New St' }), {} as any, () => {});
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    const expr = call.args[0].input.UpdateExpression as string;
    expect(expr).not.toContain('hostId');
  });

  it('empty body → 200 (no-op)', async () => {
    const res = await handler(makeEvent({}), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });
});
