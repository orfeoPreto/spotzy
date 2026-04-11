import { APIGatewayProxyEvent } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../../functions/admin/platform-fee-update/index';

const ddbMock = mockClient(DynamoDBDocumentClient);

const mockAdminEvent = (body: Record<string, unknown> = {}): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: 'admin-1', email: 'admin@spotzy.com', 'cognito:groups': 'admin' } },
      requestId: 'req-1',
    },
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/api/v1/admin/config/platform-fee',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

const mockNonAdminEvent = (): APIGatewayProxyEvent =>
  ({
    requestContext: {
      authorizer: { claims: { sub: 'user-1', email: 'user@spotzy.com', 'cognito:groups': 'users' } },
      requestId: 'req-2',
    },
    body: JSON.stringify({ singleShotPct: 0.10, blockReservationPct: 0.10 }),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/api/v1/admin/config/platform-fee',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    resource: '',
    stageVariables: null,
  } as unknown as APIGatewayProxyEvent);

beforeEach(() => {
  ddbMock.reset();
});

describe('admin-platform-fee-update', () => {
  test('happy path - writes new values and appends to historyLog', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'CONFIG#PLATFORM_FEE',
        SK: 'METADATA',
        singleShotPct: 0.15,
        blockReservationPct: 0.15,
        historyLog: [],
      },
    });
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(mockAdminEvent({ singleShotPct: 0.10, blockReservationPct: 0.20 }), {} as any, {} as any);
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.singleShotPct).toBe(0.10);
    expect(body.blockReservationPct).toBe(0.20);
    expect(body.lastModifiedBy).toBe('admin-1');
    expect(body.lastModifiedAt).toBeDefined();
    expect(body.historyLog).toHaveLength(1);
    expect(body.historyLog[0].singleShotPct).toBe(0.10);
    expect(body.historyLog[0].modifiedBy).toBe('admin-1');
  });

  test('rejects values < 0 with 400 PLATFORM_FEE_OUT_OF_BOUNDS', async () => {
    const result = await handler(mockAdminEvent({ singleShotPct: -0.01, blockReservationPct: 0.15 }), {} as any, {} as any);
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('PLATFORM_FEE_OUT_OF_BOUNDS');
  });

  test('rejects values > 0.30 with 400 PLATFORM_FEE_OUT_OF_BOUNDS', async () => {
    const result = await handler(mockAdminEvent({ singleShotPct: 0.15, blockReservationPct: 0.31 }), {} as any, {} as any);
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('PLATFORM_FEE_OUT_OF_BOUNDS');
  });

  test('rejects non-numeric values', async () => {
    const result = await handler(mockAdminEvent({ singleShotPct: 'foo', blockReservationPct: 0.15 }), {} as any, {} as any);
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('PLATFORM_FEE_OUT_OF_BOUNDS');
  });

  test('returns 403 for non-admin', async () => {
    const result = await handler(mockNonAdminEvent(), {} as any, {} as any);
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(403);
  });

  test('history log retains the 100 most recent entries (older roll off the front)', async () => {
    const existingHistory = Array.from({ length: 100 }, (_, i) => ({
      singleShotPct: 0.15,
      blockReservationPct: 0.15,
      modifiedBy: 'admin-1',
      modifiedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'CONFIG#PLATFORM_FEE',
        SK: 'METADATA',
        singleShotPct: 0.15,
        blockReservationPct: 0.15,
        historyLog: existingHistory,
      },
    });
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(mockAdminEvent({ singleShotPct: 0.20, blockReservationPct: 0.20 }), {} as any, {} as any);
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.historyLog).toHaveLength(100);
    // First entry should be the second original entry (first rolled off)
    expect(body.historyLog[0].modifiedAt).toBe('2026-01-02T00:00:00.000Z');
    // Last entry is the new one
    expect(body.historyLog[99].singleShotPct).toBe(0.20);
  });

  test('idempotent - setting the same values writes a new history entry', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: 'CONFIG#PLATFORM_FEE',
        SK: 'METADATA',
        singleShotPct: 0.15,
        blockReservationPct: 0.15,
        historyLog: [],
      },
    });
    ddbMock.on(PutCommand).resolves({});

    const result = await handler(mockAdminEvent({ singleShotPct: 0.15, blockReservationPct: 0.15 }), {} as any, {} as any);
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.historyLog).toHaveLength(1);
  });
});
