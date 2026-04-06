import { APIGatewayProxyResult } from 'aws-lambda';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export const forbidden = (code = 'ADMIN_ACCESS_REQUIRED'): APIGatewayProxyResult => ({
  statusCode: 403,
  headers,
  body: JSON.stringify({ error: code }),
});
