import { handleRequest } from '../../functions/agent/mcp-server-hosted/index';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: jest.fn().mockImplementation((p) => ({ ...p, _type: 'GetCommand' })),
    __mockSend: mockSend,
  };
});

const mockSend = require('@aws-sdk/lib-dynamodb').__mockSend;

// Mock global fetch for tool calls
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function mockResponseStream() {
  let body = '';
  let contentType = '';
  let ended = false;

  return {
    setContentType(type: string) { contentType = type; },
    write(chunk: string) { body += chunk; },
    end() { ended = true; },
    getBody: () => body,
    getContentType: () => contentType,
    isEnded: () => ended,
  };
}

function mockContext() {
  return { functionName: 'test', awsRequestId: 'req-1' };
}

function seedApiKey(opts: { rawKey: string; userId: string; keyId?: string }) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(opts.rawKey).digest('hex');
  mockSend.mockImplementation((cmd: any) => {
    if (cmd._type === 'GetCommand' && cmd.Key?.PK === `APIKEY#${hash}`) {
      return Promise.resolve({
        Item: {
          PK: `APIKEY#${hash}`,
          SK: 'METADATA',
          userId: opts.userId,
          keyId: opts.keyId ?? 'key-1',
          revokedAt: null,
        },
      });
    }
    return Promise.resolve({ Item: undefined });
  });
}

describe('mcp-server-hosted Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  test('GET /health returns 200 with body "ok"', async () => {
    const event = { path: '/health', httpMethod: 'GET', headers: {} };
    const responseStream = mockResponseStream();

    await handleRequest(event, responseStream, mockContext());

    expect(responseStream.getContentType()).toBe('text/plain');
    expect(responseStream.getBody()).toBe('ok');
    expect(responseStream.isEnded()).toBe(true);
  });

  test('POST /mcp without Authorization returns unauthorized', async () => {
    mockSend.mockResolvedValue({ Item: undefined });

    const event = { path: '/mcp', httpMethod: 'POST', headers: {}, body: '{}' };
    const responseStream = mockResponseStream();

    await handleRequest(event, responseStream, mockContext());

    const body = JSON.parse(responseStream.getBody());
    expect(body.error).toBe('unauthorized');
    expect(responseStream.isEnded()).toBe(true);
  });

  test('POST /mcp with valid API key authenticates and starts SSE stream', async () => {
    seedApiKey({ rawKey: 'sk_test_abc', userId: 'user-1' });

    const event = {
      path: '/mcp',
      httpMethod: 'POST',
      headers: { authorization: 'Bearer sk_test_abc' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }),
    };
    const responseStream = mockResponseStream();

    await handleRequest(event, responseStream, mockContext());

    expect(responseStream.getContentType()).toBe('text/event-stream');
    expect(responseStream.getBody()).toMatch(/^data: /m);
    expect(responseStream.isEnded()).toBe(true);

    // Parse the SSE data
    const dataLine = responseStream.getBody().match(/^data: (.+)$/m);
    expect(dataLine).toBeTruthy();
    const parsed = JSON.parse(dataLine![1]);
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.id).toBe(1);
    expect(parsed.result.serverInfo.name).toBe('spotzy-mcp');
    expect(parsed.result.protocolVersion).toBe('2024-11-05');
  });

  test('POST /mcp with revoked API key returns unauthorized', async () => {
    const { createHash } = require('crypto');
    const hash = createHash('sha256').update('sk_revoked').digest('hex');
    mockSend.mockResolvedValue({
      Item: {
        PK: `APIKEY#${hash}`,
        SK: 'METADATA',
        userId: 'user-1',
        keyId: 'key-1',
        revokedAt: '2026-01-01T00:00:00Z',
      },
    });

    const event = {
      path: '/mcp',
      httpMethod: 'POST',
      headers: { authorization: 'Bearer sk_revoked' },
      body: '{}',
    };
    const responseStream = mockResponseStream();

    await handleRequest(event, responseStream, mockContext());

    const body = JSON.parse(responseStream.getBody());
    expect(body.error).toBe('unauthorized');
  });

  test('tools/list returns available MCP tools', async () => {
    seedApiKey({ rawKey: 'sk_test_xyz', userId: 'user-1' });

    const event = {
      path: '/mcp',
      httpMethod: 'POST',
      headers: { authorization: 'Bearer sk_test_xyz' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2, params: {} }),
    };
    const responseStream = mockResponseStream();

    await handleRequest(event, responseStream, mockContext());

    const dataLine = responseStream.getBody().match(/^data: (.+)$/m);
    const parsed = JSON.parse(dataLine![1]);
    expect(parsed.id).toBe(2);
    expect(parsed.result.tools).toBeDefined();
    expect(parsed.result.tools.length).toBeGreaterThan(0);
    const toolNames = parsed.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('search_listings');
    expect(toolNames).toContain('list_bookings');
    expect(toolNames).toContain('create_booking');
  });

  test('tools/call with list_bookings routes to agent endpoint', async () => {
    seedApiKey({ rawKey: 'sk_test_tool', userId: 'user-1' });

    // No AGENT_API_BASE_URL set, so returns structured response
    const event = {
      path: '/mcp',
      httpMethod: 'POST',
      headers: { authorization: 'Bearer sk_test_tool' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 3,
        params: { name: 'list_bookings', arguments: { status: 'CONFIRMED' } },
      }),
    };
    const responseStream = mockResponseStream();

    await handleRequest(event, responseStream, mockContext());

    const dataLine = responseStream.getBody().match(/^data: (.+)$/m);
    const parsed = JSON.parse(dataLine![1]);
    expect(parsed.id).toBe(3);
    expect(parsed.result).toBeDefined();
  });

  test('unknown method returns error', async () => {
    seedApiKey({ rawKey: 'sk_test_unknown', userId: 'user-1' });

    const event = {
      path: '/mcp',
      httpMethod: 'POST',
      headers: { authorization: 'Bearer sk_test_unknown' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'unknown/method', id: 4 }),
    };
    const responseStream = mockResponseStream();

    await handleRequest(event, responseStream, mockContext());

    const dataLine = responseStream.getBody().match(/^data: (.+)$/m);
    const parsed = JSON.parse(dataLine![1]);
    expect(parsed.id).toBe(4);
    expect(parsed.error.code).toBe(-32601);
    expect(parsed.error.message).toContain('Unknown method');
  });

  test('unknown path returns not_found', async () => {
    const event = { path: '/unknown', httpMethod: 'GET', headers: {} };
    const responseStream = mockResponseStream();

    await handleRequest(event, responseStream, mockContext());

    const body = JSON.parse(responseStream.getBody());
    expect(body.error).toBe('not_found');
  });
});
