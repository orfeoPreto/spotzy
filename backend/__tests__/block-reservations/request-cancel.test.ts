import { handler } from '../../functions/block-reservations/request-cancel/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: jest.fn(), QueryCommand: jest.fn(), UpdateCommand: jest.fn(),
    __mockSend: mockSend,
  };
});
jest.mock('@aws-sdk/client-scheduler', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    SchedulerClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    DeleteScheduleCommand: jest.fn(),
  };
});
jest.mock('@aws-sdk/client-ses', () => {
  const mockSend = jest.fn().mockResolvedValue({});
  return {
    SESClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    SendEmailCommand: jest.fn(),
  };
});
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: { cancel: jest.fn().mockResolvedValue({}) },
    refunds: { create: jest.fn().mockResolvedValue({ id: 're_123' }) },
  }));
});

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;

function mockEvent(userId: string, reqId: string): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { claims: { sub: userId, email: 'test@example.com' } }, requestId: 'test' } as any,
    body: null,
    headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false,
    path: `/api/v1/block-requests/${reqId}/cancel`, pathParameters: { reqId },
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

describe('block-request-cancel', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('cancels a PENDING_MATCH request (free cancel)', async () => {
    ddbMock.mockResolvedValueOnce({
      Items: [
        {
          SK: 'METADATA', reqId: 'req-1', ownerUserId: 'user-1', status: 'PENDING_MATCH',
          startsAt: new Date(Date.now() + 14 * 86400_000).toISOString(),
          endsAt: new Date(Date.now() + 15 * 86400_000).toISOString(),
          auditLog: [],
        },
      ],
    });
    ddbMock.mockResolvedValue({});

    const result = await handler(mockEvent('user-1', 'req-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.status).toBe('CANCELLED');
  });

  test('returns 401 without auth', async () => {
    const event = mockEvent('user-1', 'req-1');
    (event.requestContext as any).authorizer = null;
    const result = await handler(event, {} as any, () => {});
    expect(result!.statusCode).toBe(401);
  });

  test('returns 404 for non-existent request', async () => {
    ddbMock.mockResolvedValueOnce({ Items: [] });
    const result = await handler(mockEvent('user-1', 'req-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(404);
  });

  test('returns 403 for non-owner', async () => {
    ddbMock.mockResolvedValueOnce({
      Items: [{ SK: 'METADATA', reqId: 'req-1', ownerUserId: 'user-2', status: 'PENDING_MATCH' }],
    });
    const result = await handler(mockEvent('user-1', 'req-1'), {} as any, () => {});
    expect(result!.statusCode).toBe(403);
  });
});
