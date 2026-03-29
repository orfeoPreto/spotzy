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

export const badRequest = (message: string): APIGatewayProxyResult => ({
  statusCode: 400,
  headers,
  body: JSON.stringify({ error: message }),
});

export const unauthorized = (): APIGatewayProxyResult => ({
  statusCode: 401,
  headers,
  body: JSON.stringify({ error: 'Unauthorized' }),
});

export const notFound = (): APIGatewayProxyResult => ({
  statusCode: 404,
  headers,
  body: JSON.stringify({ error: 'Not found' }),
});

export const conflict = (message: string): APIGatewayProxyResult => ({
  statusCode: 409,
  headers,
  body: JSON.stringify({ error: message }),
});

export const internalError = (): APIGatewayProxyResult => ({
  statusCode: 500,
  headers,
  body: JSON.stringify({ error: 'Internal server error' }),
});
