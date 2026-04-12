import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/listings/create/index';
import { mockAuthContext, TEST_USER_ID } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(PutCommand).resolves({});
});

const validBody = {
  address: '123 Main St, San Francisco, CA',
  addressLat: 37.7749,
  addressLng: -122.4194,
  spotType: 'COVERED_GARAGE',
  dimensions: 'STANDARD',
  evCharging: false,
  pricePerHour: 5,
};

const makeEvent = (body: object, auth = mockAuthContext()): APIGatewayProxyEvent =>
  ({ ...auth, body: JSON.stringify(body), pathParameters: null, queryStringParameters: null, headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false, path: '/listings', multiValueQueryStringParameters: null, resource: '', stageVariables: null } as unknown as APIGatewayProxyEvent);

describe('listing-create', () => {
  it('creates listing with all required fields → 201, status=draft', async () => {
    const res = await handler(makeEvent(validBody), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
    const body = JSON.parse(res!.body);
    expect(body.listingId).toBeDefined();
    expect(body.status).toBe('draft');
  });

  it('computes geohash from lat/lng and stores it', async () => {
    await handler(makeEvent(validBody), {} as any, () => {});
    const call = ddbMock.commandCalls(PutCommand)[0];
    const item = call.args[0].input.Item!;
    expect(item.geohash).toBeDefined();
    expect(typeof item.geohash).toBe('string');
    expect(item.geohash.length).toBe(5);
  });

  it('sets hostId from JWT sub claim', async () => {
    await handler(makeEvent(validBody), {} as any, () => {});
    const call = ddbMock.commandCalls(PutCommand)[0];
    const item = call.args[0].input.Item!;
    expect(item.hostId).toBe(TEST_USER_ID);
  });

  it('pricePerHour only is sufficient', async () => {
    const res = await handler(makeEvent({ ...validBody }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
  });

  it('missing address → 400 with field name in error', async () => {
    const { address: _a, ...body } = validBody;
    const res = await handler(makeEvent(body), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).error).toBe('MISSING_REQUIRED_FIELD');
  });

  it('missing addressLat → 400', async () => {
    const { addressLat: _l, ...body } = validBody;
    const res = await handler(makeEvent(body), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('missing addressLng → 400', async () => {
    const { addressLng: _l, ...body } = validBody;
    const res = await handler(makeEvent(body), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('missing spotType → 400', async () => {
    const { spotType: _s, ...body } = validBody;
    const res = await handler(makeEvent(body), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).error).toBe('MISSING_REQUIRED_FIELD');
  });

  it('invalid spotType value → 400', async () => {
    const res = await handler(makeEvent({ ...validBody, spotType: 'INVALID' }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('no price provided → 400 with "At least one price is required"', async () => {
    const { pricePerHour: _p, ...body } = validBody;
    const res = await handler(makeEvent(body), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(JSON.parse(res!.body).error).toBe('PRICE_REQUIRED');
  });

  it('description exceeds 500 chars → 400', async () => {
    const res = await handler(makeEvent({ ...validBody, description: 'x'.repeat(501) }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('missing auth context → 401', async () => {
    const res = await handler(makeEvent(validBody, { requestContext: {} } as any), {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  it('DynamoDB PutItem called exactly once with correct PK/SK', async () => {
    await handler(makeEvent(validBody), {} as any, () => {});
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.PK).toMatch(/^LISTING#/);
    expect(item.SK).toBe('METADATA');
  });

  it('GSI1PK is set to HOST#{userId}', async () => {
    await handler(makeEvent(validBody), {} as any, () => {});
    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.GSI1PK).toBe(`HOST#${TEST_USER_ID}`);
  });
});
