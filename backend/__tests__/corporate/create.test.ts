import { handler } from '../../functions/corporate/create/index';
import { APIGatewayProxyEvent } from 'aws-lambda';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: jest.fn(), QueryCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

const ddbMock = require('@aws-sdk/lib-dynamodb').__mockSend;

function mockEvent(userId: string, body: any): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: { claims: { sub: userId } }, requestId: 'test' } as any,
    body: JSON.stringify(body),
    headers: {}, multiValueHeaders: {}, httpMethod: 'POST', isBase64Encoded: false,
    path: '/api/v1/corporate', pathParameters: null, queryStringParameters: null,
    multiValueQueryStringParameters: null, stageVariables: null, resource: '',
  };
}

describe('corporate-create', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('creates corporate account with VAT number', async () => {
    ddbMock
      .mockResolvedValueOnce({ Items: [] }) // no existing corp
      .mockResolvedValue({}); // puts

    const result = await handler(mockEvent('user-1', {
      companyName: 'Spotzy Corp SA', vatNumber: 'BE0123456789', billingAddress: 'Rue de la Loi 42',
    }), {} as any, () => {});

    expect(result!.statusCode).toBe(201);
    const body = JSON.parse(result!.body);
    expect(body.corpId).toBeDefined();
    expect(body.adminUserId).toBe('user-1');
  });

  test('validates Belgian VAT format', async () => {
    const result = await handler(mockEvent('user-1', {
      companyName: 'Test', vatNumber: 'INVALID', billingAddress: 'Addr',
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(400);
  });

  test('prevents duplicate admin', async () => {
    ddbMock.mockResolvedValueOnce({ Items: [{ corpId: 'existing' }] });
    const result = await handler(mockEvent('user-1', {
      companyName: 'Test', vatNumber: 'BE0123456789', billingAddress: 'Addr',
    }), {} as any, () => {});
    expect(result!.statusCode).toBe(409);
  });
});
