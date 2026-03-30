import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/listings/publish/index';
import { mockAuthContext, TEST_USER_ID, TEST_LISTING_ID } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

const publishableListing = {
  PK: `LISTING#${TEST_LISTING_ID}`, SK: 'METADATA',
  listingId: TEST_LISTING_ID, hostId: TEST_USER_ID,
  description: 'A great spot',
  photos: [
    { key: 'photo1.jpg', validationStatus: 'PASS' },
    { key: 'photo2.jpg', validationStatus: 'PASS' },
  ],
  pricePerHour: 5,
  status: 'draft',
};

const availabilityWindows = [{ Count: 1, Items: [{ PK: `LISTING#${TEST_LISTING_ID}`, SK: 'AVAIL_RULE#r1' }] }];

beforeEach(() => {
  ddbMock.reset();
  ebMock.reset();
  ddbMock.on(GetCommand).resolves({ Item: publishableListing });
  ddbMock.on(QueryCommand).resolves(availabilityWindows[0]);
  ddbMock.on(UpdateCommand).resolves({});
  ebMock.on(PutEventsCommand).resolves({});
});

const makeEvent = (auth = mockAuthContext(), listingId = TEST_LISTING_ID): APIGatewayProxyEvent =>
  ({ ...auth, body: null, pathParameters: { id: listingId }, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: `/listings/${listingId}/publish`, multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('listing-publish', () => {
  it('all checks pass → status LIVE, EventBridge emitted, 200', async () => {
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
    expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(1);
  });

  it('EventBridge event has detail-type listing.published', async () => {
    await handler(makeEvent(), {} as any, () => {});
    const call = ebMock.commandCalls(PutEventsCommand)[0];
    expect(call.args[0].input.Entries![0].DetailType).toBe('listing.published');
  });

  it('no photos with PASS validation → failedChecks includes "photoValidation"', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...publishableListing, photos: [
      { key: 'p1.jpg', validationStatus: 'PENDING' },
    ] } });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).failedChecks).toContain('photoValidation');
  });

  it('no photos with validationStatus=PASS → failedChecks includes "photoValidation"', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...publishableListing, photos: [
      { key: 'p1.jpg', validationStatus: 'PENDING' },
      { key: 'p2.jpg', validationStatus: 'PENDING' },
    ] } });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).failedChecks).toContain('photoValidation');
  });

  it('no availability windows → failedChecks includes "availability"', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).failedChecks).toContain('availability');
  });

  it('no price → failedChecks includes "price"', async () => {
    const { pricePerHour: _p, ...noPrice } = publishableListing;
    ddbMock.on(GetCommand).resolves({ Item: noPrice });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).failedChecks).toContain('price');
  });

  it('multiple missing fields → all in failedChecks in one response', async () => {
    const { pricePerHour: _p, ...stripped } = publishableListing;
    ddbMock.on(GetCommand).resolves({ Item: { ...stripped, photos: [] } });
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(makeEvent(), {} as any, () => {});
    const { failedChecks } = JSON.parse(res!.body);
    expect(failedChecks).toContain('photoValidation');
    expect(failedChecks).toContain('availability');
    expect(failedChecks).toContain('price');
  });

  it('photo with validationStatus=REVIEW but one PASS → 200 (allowed to publish)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { ...publishableListing, photos: [
      { key: 'p1.jpg', validationStatus: 'PASS' },
      { key: 'p2.jpg', validationStatus: 'REVIEW' },
    ] } });
    const res = await handler(makeEvent(), {} as any, () => {});
    expect(res!.statusCode).toBe(200);
  });

  it('not the host → 403', async () => {
    const res = await handler(makeEvent(mockAuthContext('other_user')), {} as any, () => {});
    expect(res!.statusCode).toBe(403);
  });
});
