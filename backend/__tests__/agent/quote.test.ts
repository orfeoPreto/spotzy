import { handler } from '../../functions/agent/quote/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    QueryCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;

function mockEvent(qs: Record<string, string>, pathParams?: Record<string, string>): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { userId: 'user-1' }, requestId: 'test' } as any,
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/api/v1/agent/listings/lst-1/quote',
    pathParameters: pathParams ?? { listingId: 'lst-1' },
    queryStringParameters: qs,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
  };
}

describe('agent-quote', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns exact price for listing and period', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [{ listingId: 'lst-1', pricePerHour: 5, status: 'LIVE' }] }) // listing
      .mockResolvedValueOnce({ Items: [] }); // no blocks

    const result = await handler(mockEvent({
      startTime: '2026-04-11T08:00:00Z',
      endTime: '2026-04-11T18:00:00Z',
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.subtotalEur).toBe(50);
    expect(body.platformFeeEur).toBe(7.5);
    expect(body.totalEur).toBe(57.5);
    expect(body.currency).toBe('EUR');
  });

  test('returns 409 when period is blocked', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [{ listingId: 'lst-1', pricePerHour: 5, status: 'LIVE' }] })
      .mockResolvedValueOnce({ Items: [{ startTime: '2026-04-11T06:00:00Z', endTime: '2026-04-11T20:00:00Z' }] });

    const result = await handler(mockEvent({
      startTime: '2026-04-11T08:00:00Z',
      endTime: '2026-04-11T18:00:00Z',
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(409);
  });

  test('returns 400 if startTime/endTime missing', async () => {
    const result = await handler(mockEvent({}), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
  });

  test('includes cancellation policy', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [{ listingId: 'lst-1', pricePerHour: 5, status: 'LIVE' }] })
      .mockResolvedValueOnce({ Items: [] });

    const futureStart = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 46 * 3600 * 1000).toISOString();

    const result = await handler(mockEvent({ startTime: futureStart, endTime: futureEnd }), {} as any, () => {});
    const body = JSON.parse(result!.body);
    expect(body.cancellationPolicy.rule).toBe('FULL_REFUND');
  });
});
