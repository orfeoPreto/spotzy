import { APIGatewayProxyHandler } from 'aws-lambda';
import * as fs from 'fs';
import * as path from 'path';

let OPENAPI_SPEC: string;
try {
  OPENAPI_SPEC = fs.readFileSync(path.join(__dirname, 'spec.yaml'), 'utf-8');
} catch {
  OPENAPI_SPEC = 'openapi: 3.1.0\ninfo:\n  title: Spotzy Agent API\n  version: 1.0.0\n';
}

export const handler: APIGatewayProxyHandler = async () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/yaml',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  },
  body: OPENAPI_SPEC,
});
