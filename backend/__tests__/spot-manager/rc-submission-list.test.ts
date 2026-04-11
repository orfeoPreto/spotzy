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

import { handler } from '../../functions/spot-manager/rc-submission-list/index';

function mockEvent(userId: string): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { claims: { sub: userId, email: `${userId}@test.com` } }, requestId: 'test-req' } as any,
    body: null,
    headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false,
    path: '/api/v1/spot-manager/rc-submissions/mine', pathParameters: null,
    queryStringParameters: null, multiValueQueryStringParameters: null,
    stageVariables: null, resource: '',
  };
}

describe('rc-submission-list', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns submissions sorted by createdAt descending', async () => {
    ddbMock.mockResolvedValueOnce({
      Items: [
        { submissionId: 'sub-1', createdAt: '2026-04-08T10:00:00.000Z', status: 'SUPERSEDED' },
        { submissionId: 'sub-2', createdAt: '2026-04-10T10:00:00.000Z', status: 'PENDING_REVIEW' },
        { submissionId: 'sub-3', createdAt: '2026-04-09T10:00:00.000Z', status: 'REJECTED' },
      ],
    });

    const result = await handler(mockEvent('user-1'), {} as any, () => {});

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.submissions).toHaveLength(3);
    expect(body.submissions[0].submissionId).toBe('sub-2');
    expect(body.submissions[1].submissionId).toBe('sub-3');
    expect(body.submissions[2].submissionId).toBe('sub-1');
  });

  test('returns empty array when no submissions', async () => {
    ddbMock.mockResolvedValueOnce({ Items: [] });

    const result = await handler(mockEvent('user-1'), {} as any, () => {});

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.submissions).toEqual([]);
  });

  test('returns 401 for unauthenticated request', async () => {
    const event = {
      requestContext: { authorizer: {}, requestId: 'test-req' } as any,
      body: null,
      headers: {}, multiValueHeaders: {}, httpMethod: 'GET', isBase64Encoded: false,
      path: '/api/v1/spot-manager/rc-submissions/mine', pathParameters: null,
      queryStringParameters: null, multiValueQueryStringParameters: null,
      stageVariables: null, resource: '',
    } as APIGatewayProxyEvent;

    const result = await handler(event, {} as any, () => {});
    expect(result!.statusCode).toBe(401);
  });

  test('handles undefined Items gracefully', async () => {
    ddbMock.mockResolvedValueOnce({});

    const result = await handler(mockEvent('user-1'), {} as any, () => {});

    expect(result!.statusCode).toBe(200);
    const body = JSON.parse(result!.body);
    expect(body.submissions).toEqual([]);
  });
});
