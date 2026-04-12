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
  pricePerHourEur: 2.00,
  dailyDiscountPct: 0.60,
  weeklyDiscountPct: 0.60,
  monthlyDiscountPct: 0.60,
  status: 'live',
};

beforeEach(() => {
  ddbMock.reset();
});

describe('booking-quote', () => {
  test('happy path returns the right tier and total', async () => {
    ddbMock.on(GetCommand).resolves({ Item: sampleListing });

    const result = await handler(mockAuthEvent({
      listingId: 'l1',
      startTime: '2026-05-01T10:00:00.000Z',
      endTime: '2026-05-02T11:00:00.000Z',  // 25 hours
    }), {} as any, {} as any);

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.appliedTier).toBe('DAILY');
    expect(body.totalEur).toBe(57.60);
    expect(body.tierUnitsBilled).toBe(2);
    expect(body.tierRateEur).toBe(28.80);
    expect(body.durationHours).toBe(25);
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
