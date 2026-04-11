/**
 * Hosted MCP server Lambda — uses AWS Lambda Response Streaming.
 * Endpoints:
 *   GET  /health  → 200 "ok"
 *   POST /mcp     → Bearer token auth, SSE streaming MCP protocol
 */
import { createHash } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'spotzy-main';
const AGENT_API_BASE_URL = process.env.AGENT_API_BASE_URL ?? '';

// ── Auth helper ──────────────────────────────────────────────────────────
interface AuthResult {
  valid: boolean;
  userId?: string;
  keyId?: string;
  error?: string;
}

async function authenticateRequest(authHeader?: string): Promise<AuthResult> {
  if (!authHeader) return { valid: false, error: 'Missing Authorization header' };

  const raw = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!raw) return { valid: false, error: 'Empty token' };

  const hash = createHash('sha256').update(raw).digest('hex');

  try {
    const result = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { PK: `APIKEY#${hash}`, SK: 'METADATA' },
    }));

    if (!result.Item || result.Item.revokedAt) {
      return { valid: false, error: 'Invalid or revoked API key' };
    }

    return { valid: true, userId: result.Item.userId, keyId: result.Item.keyId };
  } catch {
    return { valid: false, error: 'Authentication service error' };
  }
}

// ── MCP protocol types ──────────────────────────────────────────────────
interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  id?: number | string;
  params?: any;
}

interface McpTransport {
  writeEvent: (name: string, data: any) => void;
  writeData: (data: any) => void;
  end: () => void;
}

// ── MCP tool definitions ────────────────────────────────────────────────
const MCP_TOOLS = [
  {
    name: 'search_listings',
    description: 'Search for available parking spots by location, date/time range, and optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City, address, or coordinates' },
        startTime: { type: 'string', description: 'ISO 8601 start time' },
        endTime: { type: 'string', description: 'ISO 8601 end time' },
      },
      required: ['location'],
    },
  },
  {
    name: 'get_quote',
    description: 'Get a price quote for a specific listing and time period',
    inputSchema: {
      type: 'object',
      properties: {
        listingId: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
      },
      required: ['listingId', 'startTime', 'endTime'],
    },
  },
  {
    name: 'create_booking',
    description: 'Book a parking spot',
    inputSchema: {
      type: 'object',
      properties: {
        listingId: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
      },
      required: ['listingId', 'startTime', 'endTime'],
    },
  },
  {
    name: 'list_bookings',
    description: 'List current user bookings, optionally filtered by status',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] },
      },
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancel an existing booking',
    inputSchema: {
      type: 'object',
      properties: {
        bookingId: { type: 'string' },
      },
      required: ['bookingId'],
    },
  },
];

// ── MCP protocol handler ────────────────────────────────────────────────
async function handleMcpRequest(
  request: JsonRpcRequest,
  transport: McpTransport,
  auth: { userId: string; keyId: string },
): Promise<void> {
  const { method, id, params } = request;

  switch (method) {
    case 'initialize': {
      transport.writeData({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'spotzy-mcp', version: '1.0.0' },
        },
      });
      break;
    }

    case 'tools/list': {
      transport.writeData({
        jsonrpc: '2.0',
        id,
        result: { tools: MCP_TOOLS },
      });
      break;
    }

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};

      try {
        const toolResult = await executeToolCall(toolName, toolArgs, auth);
        transport.writeData({
          jsonrpc: '2.0',
          id,
          result: toolResult,
        });
      } catch (err: any) {
        transport.writeData({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: err.message ?? 'Tool execution failed' },
        });
      }
      break;
    }

    default: {
      transport.writeData({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown method: ${method}` },
      });
    }
  }

  transport.end();
}

async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  auth: { userId: string; keyId: string },
): Promise<any> {
  // Route tool calls to agent API endpoints
  const baseUrl = AGENT_API_BASE_URL.replace(/\/$/, '');

  let endpoint: string;
  let method = 'GET';
  let body: string | undefined;

  switch (toolName) {
    case 'search_listings': {
      const qs = new URLSearchParams();
      if (args.location) qs.set('location', args.location);
      if (args.startTime) qs.set('startTime', args.startTime);
      if (args.endTime) qs.set('endTime', args.endTime);
      endpoint = `/api/v1/agent/search?${qs.toString()}`;
      break;
    }
    case 'get_quote': {
      const qs = new URLSearchParams({ startTime: args.startTime, endTime: args.endTime });
      endpoint = `/api/v1/agent/listings/${args.listingId}/quote?${qs.toString()}`;
      break;
    }
    case 'create_booking': {
      endpoint = '/api/v1/agent/bookings';
      method = 'POST';
      body = JSON.stringify(args);
      break;
    }
    case 'list_bookings': {
      const qs = new URLSearchParams();
      if (args.status) qs.set('status', args.status);
      endpoint = `/api/v1/agent/bookings?${qs.toString()}`;
      break;
    }
    case 'cancel_booking': {
      endpoint = `/api/v1/agent/bookings/${args.bookingId}/cancel`;
      method = 'POST';
      break;
    }
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }

  // In production, this calls the agent API internally
  // For now, we return a structured response indicating the call
  if (!baseUrl) {
    return { content: [{ type: 'text', text: `Tool ${toolName} called with args: ${JSON.stringify(args)}` }] };
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-User-Id': auth.userId,
    },
    ...(body ? { body } : {}),
  });

  const data = await response.json();
  return data;
}

// ��─ Lambda handler with response streaming ──────────────────────────────
declare const awslambda: any;

// Export for both streaming runtime and testing
export async function handleRequest(
  event: any,
  responseStream: any,
  _context?: any,
): Promise<void> {
  const path = event.path ?? event.rawPath ?? '';
  const method = event.httpMethod ?? event.requestContext?.http?.method ?? '';
  const headers = event.headers ?? {};

  // Health check
  if (path === '/health' && method === 'GET') {
    responseStream.setContentType('text/plain');
    responseStream.write('ok');
    responseStream.end();
    return;
  }

  // MCP endpoint
  if (path === '/mcp' && method === 'POST') {
    const auth = await authenticateRequest(headers.authorization ?? headers.Authorization);
    if (!auth.valid) {
      responseStream.setContentType('application/json');
      responseStream.write(JSON.stringify({ error: 'unauthorized', message: auth.error }));
      responseStream.end();
      return;
    }

    // Set SSE content type
    responseStream.setContentType('text/event-stream');

    const body: JsonRpcRequest = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    const transport: McpTransport = {
      writeEvent: (name: string, data: any) => {
        responseStream.write(`event: ${name}\n`);
        responseStream.write(`data: ${JSON.stringify(data)}\n\n`);
      },
      writeData: (data: any) => {
        responseStream.write(`data: ${JSON.stringify(data)}\n\n`);
      },
      end: () => responseStream.end(),
    };

    await handleMcpRequest(body, transport, {
      userId: auth.userId!,
      keyId: auth.keyId!,
    });
    return;
  }

  // Not found
  responseStream.setContentType('application/json');
  responseStream.write(JSON.stringify({ error: 'not_found' }));
  responseStream.end();
}

// For Lambda Response Streaming runtime
export const handler = typeof awslambda !== 'undefined'
  ? awslambda.streamifyResponse(handleRequest)
  : handleRequest;
