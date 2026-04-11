import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler, generateBayLabel } from '../../functions/spot-manager/pool-listing-create/index';
import { mockAuthContext, TEST_USER_ID } from '../setup';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

const mockAuthEvent = (userId: string, overrides: any = {}) => ({
  requestContext: { authorizer: { claims: { sub: userId, email: `${userId}@test.com` } }, requestId: 'test-req' },
  body: overrides.body ? JSON.stringify(overrides.body) : null,
  pathParameters: overrides.pathParameters ?? null,
  queryStringParameters: overrides.queryStringParameters ?? null,
} as any);

const validBody = {
  address: '100 Pool Lane, London',
  addressLat: 51.5074,
  addressLng: -0.1278,
  spotType: 'COVERED_GARAGE',
  pricePerHour: 8,
  bayCount: 5,
  photos: ['photo1.jpg', 'photo2.jpg', 'photo3.jpg'],
};

const setupActiveSpotManager = () => {
  ddbMock.on(GetCommand).resolves({
    Item: { PK: `USER#${TEST_USER_ID}`, SK: 'PROFILE', spotManagerStatus: 'ACTIVE' },
  });
  ddbMock.on(TransactWriteCommand).resolves({});
};

describe('pool-listing-create', () => {
  it('creates pool listing with bays -> 201', async () => {
    setupActiveSpotManager();
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: validBody }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
    const body = JSON.parse(res!.body);
    expect(body.listing.isPool).toBe(true);
    expect(body.listing.bayCount).toBe(5);
    expect(body.listing.blockReservationsOptedIn).toBe(false);
    expect(body.bays).toHaveLength(5);
    expect(body.bays[0].status).toBe('ACTIVE');
  });

  it('auto-generates bay labels when not provided', async () => {
    setupActiveSpotManager();
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: validBody }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.bays[0].label).toBe('A1');
    expect(body.bays[1].label).toBe('A2');
  });

  it('uses custom bayLabels when provided', async () => {
    setupActiveSpotManager();
    const bodyWithLabels = { ...validBody, bayLabels: ['P1', 'P2', 'P3', 'P4', 'P5'] };
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: bodyWithLabels }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.bays[0].label).toBe('P1');
    expect(body.bays[4].label).toBe('P5');
  });

  it('stores accessInstructions on bays when provided', async () => {
    setupActiveSpotManager();
    const bodyWithInstructions = {
      ...validBody,
      bayAccessInstructions: ['Go left', 'Go right', 'Straight', 'Up', 'Down'],
    };
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: bodyWithInstructions }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.bays[0].accessInstructions).toBe('Go left');
  });

  it('sets GSI1PK to HOST#{userId}', async () => {
    setupActiveSpotManager();
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: validBody }), {} as any, () => {});
    const body = JSON.parse(res!.body);
    expect(body.listing.GSI1PK).toBe(`HOST#${TEST_USER_ID}`);
  });

  it('missing auth -> 401', async () => {
    const res = await handler({ requestContext: {}, body: JSON.stringify(validBody), pathParameters: null, queryStringParameters: null } as any, {} as any, () => {});
    expect(res!.statusCode).toBe(401);
  });

  it('user without spotManagerStatus -> 400', async () => {
    ddbMock.on(GetCommand).resolves({ Item: { PK: `USER#${TEST_USER_ID}`, SK: 'PROFILE' } });
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: validBody }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('Spot Manager status');
  });

  it('bayCount below 2 -> 400', async () => {
    setupActiveSpotManager();
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { ...validBody, bayCount: 1 } }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('bayCount');
  });

  it('bayCount above 200 -> 400', async () => {
    setupActiveSpotManager();
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { ...validBody, bayCount: 201 } }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
  });

  it('photos are optional at pool creation (can be added later via edit)', async () => {
    setupActiveSpotManager();
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { ...validBody, photos: [] } }), {} as any, () => {});
    expect(res!.statusCode).toBe(201);
  });

  it('missing address -> 400', async () => {
    setupActiveSpotManager();
    const { address, ...body } = validBody;
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('address');
  });

  it('bayLabels length mismatch -> 400', async () => {
    setupActiveSpotManager();
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { ...validBody, bayLabels: ['A', 'B'] } }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('bayLabels');
  });

  it('duplicate bayLabels -> 400', async () => {
    setupActiveSpotManager();
    const res = await handler(mockAuthEvent(TEST_USER_ID, { body: { ...validBody, bayLabels: ['A', 'A', 'B', 'C', 'D'] } }), {} as any, () => {});
    expect(res!.statusCode).toBe(400);
    expect(res!.body).toContain('unique');
  });

  it('TransactWriteCommand is called', async () => {
    setupActiveSpotManager();
    await handler(mockAuthEvent(TEST_USER_ID, { body: validBody }), {} as any, () => {});
    const calls = ddbMock.commandCalls(TransactWriteCommand);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // 1 listing + 5 bays = 6 items, fits in one chunk
    const items = calls[0].args[0].input.TransactItems!;
    expect(items).toHaveLength(6);
  });
});

describe('generateBayLabel', () => {
  it('generates A1..A26 then B1..B26', () => {
    expect(generateBayLabel(0)).toBe('A1');
    expect(generateBayLabel(1)).toBe('A2');
    expect(generateBayLabel(25)).toBe('A26');
    expect(generateBayLabel(26)).toBe('B1');
  });
});
