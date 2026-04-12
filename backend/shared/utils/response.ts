import { APIGatewayProxyResult } from 'aws-lambda';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export const ok = (body: unknown): APIGatewayProxyResult => ({
  statusCode: 200,
  headers,
  body: JSON.stringify(body),
});

export const created = (body: unknown): APIGatewayProxyResult => ({
  statusCode: 201,
  headers,
  body: JSON.stringify(body),
});

export const badRequest = (errorCode: string, details?: Record<string, unknown>): APIGatewayProxyResult => ({
  statusCode: 400,
  headers,
  body: JSON.stringify({ error: errorCode, ...(details ? { details } : {}) }),
});

export const unauthorized = (): APIGatewayProxyResult => ({
  statusCode: 401,
  headers,
  body: JSON.stringify({ error: 'UNAUTHORIZED' }),
});

export const notFound = (errorCode?: string): APIGatewayProxyResult => ({
  statusCode: 404,
  headers,
  body: JSON.stringify({ error: errorCode ?? 'NOT_FOUND' }),
});

export const conflict = (errorCode: string, details?: Record<string, unknown>): APIGatewayProxyResult => ({
  statusCode: 409,
  headers,
  body: JSON.stringify({ error: errorCode, ...(details ? { details } : {}) }),
});

export const forbidden = (): APIGatewayProxyResult => ({
  statusCode: 403,
  headers,
  body: JSON.stringify({ error: 'FORBIDDEN' }),
});

export const internalError = (): APIGatewayProxyResult => ({
  statusCode: 500,
  headers,
  body: JSON.stringify({ error: 'INTERNAL_ERROR' }),
});
