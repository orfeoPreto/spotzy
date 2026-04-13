import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/bookings/quote/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const mockAuthEvent = (body: Record<string, unknown> = {}): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: 'user-1', email: 'user@spotzy.com' } },
      requestId: 'req-1',
    },
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/api/v1/bookings/quote',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

const mockUnauthEvent = (body: Record<string, unknown> = {}): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: {},
      requestId: 'req-2',
    },
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/api/v1/bookings/quote',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

const sampleListing = {
  PK: 'LISTING#l1',
  SK: 'METADATA',
  listingId: 'l1',
  hostNetPricePerHourEur: 2.00,
  hostVatStatusAtCreation: 'EXEMPT_FRANCHISE',
  dailyDiscountPct: 0.60,
  weeklyDiscountPct: 0.60,
  monthlyDiscountPct: 0.60,
  status: 'live',
};

beforeEach(() => {
  ddbMock.reset();
});

describe('booking-quote', () => {
  test('happy path returns full PriceBreakdown', async () => {
    ddbMock.on(GetCommand).resolves({ Item: sampleListing });

    const result = await handler(mockAuthEvent({
      listingId: 'l1',
      startTime: '2026-05-01T10:00:00.000Z',
      endTime: '2026-05-02T11:00:00.000Z',  // 25 hours
    }), {} as any, {} as any);

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    // Now returns a full PriceBreakdown
    expect(body.appliedTier).toBe('DAILY');
    expect(body.hostNetTotalEur).toBe(57.60);
    expect(body.tierUnitsBilled).toBe(2);
    expect(body.tierRateEur).toBe(28.80);
    expect(body.durationHours).toBe(25);
    // Verify breakdown fields
    expect(body.hostVatRate).toBe(0); // EXEMPT_FRANCHISE = no host VAT
    expect(body.hostVatEur).toBe(0);
    expect(body.hostGrossTotalEur).toBe(57.60);
    expect(body.platformFeePct).toBe(0.15);
    expect(body.platformFeeEur).toBeGreaterThan(0);
    expect(body.platformFeeVatEur).toBeGreaterThan(0);
    expect(body.spotterGrossTotalEur).toBeGreaterThan(body.hostNetTotalEur);
    expect(body.currency).toBe('EUR');
    expect(body.breakdownComputedAt).toBeDefined();
  });

  test('VAT_REGISTERED host includes host VAT in breakdown', async () => {
    const vatListing = { ...sampleListing, hostVatStatusAtCreation: 'VAT_REGISTERED' };
    ddbMock.on(GetCommand).resolves({ Item: vatListing });

    const result = await handler(mockAuthEvent({
      listingId: 'l1',
      startTime: '2026-05-01T10:00:00.000Z',
      endTime: '2026-05-02T11:00:00.000Z',
    }), {} as any, {} as any);

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.hostVatRate).toBe(0.21);
    expect(body.hostVatEur).toBeGreaterThan(0);
    expect(body.spotterGrossTotalEur).toBeGreaterThan(body.hostGrossTotalEur);
  });

  test('includes cheaperAlternatives when applicable', async () => {
    ddbMock.on(GetCommand).resolves({ Item: sampleListing });

    const result = await handler(mockAuthEvent({
      listingId: 'l1',
      startTime: '2026-05-01T10:00:00.000Z',
      endTime: '2026-05-02T11:00:00.000Z',  // 25 hours
    }), {} as any, {} as any);

    const response = result as { statusCode: number; body: string };
    const body = JSON.parse(response.body);
    expect(body.cheaperAlternatives.length).toBeGreaterThan(0);
    const shorter = body.cheaperAlternatives.find((a: any) => a.type === 'SHORTER');
    expect(shorter).toBeDefined();
    expect(shorter.durationHours).toBe(24);
  });

  test('returns 404 if listing does not exist', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await handler(mockAuthEvent({
      listingId: 'nonexistent',
      startTime: '2026-05-01T10:00:00.000Z',
      endTime: '2026-05-02T10:00:00.000Z',
    }), {} as any, {} as any);

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(404);
  });

  test('returns 400 if endTime <= startTime', async () => {
    const result = await handler(mockAuthEvent({
      listingId: 'l1',
      startTime: '2026-05-02T10:00:00.000Z',
      endTime: '2026-05-01T10:00:00.000Z',
    }), {} as any, {} as any);

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('INVALID_TIME_RANGE');
  });

  test('returns 401 for unauthenticated request', async () => {
    const result = await handler(mockUnauthEvent({
      listingId: 'l1',
      startTime: '2026-05-01T10:00:00.000Z',
      endTime: '2026-05-02T10:00:00.000Z',
    }), {} as any, {} as any);

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(401);
  });

  test('returns 400 if missing listingId', async () => {
    const result = await handler(mockAuthEvent({
      startTime: '2026-05-01T10:00:00.000Z',
      endTime: '2026-05-02T10:00:00.000Z',
    }), {} as any, {} as any);

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
  });
});
