# Session 21b — Agent Integration Supplement (v2.x)

## Hosted MCP Server (ALB + Lambda + SSE) · EVENT_SUB# Webhook Reverse Index · Monthly Spending Reset Cron

> ⚠ **v2.x SCOPE — supplements Session 21 (Agent Integration)**
> Prerequisite sessions: 00–22 AND Session 21 (the original agent integration session) deployed and validated.
>
> **This session does NOT replace Session 21.** It adds three pieces that Session 21 explicitly listed as known gaps. Session 21's existing local-stdio MCP server, API key authentication, agent endpoints, OpenAPI spec, and basic webhook delivery all remain unchanged. This session adds:
>
> 1. The **hosted MCP server** (`mcp.spotzy.com`) using ALB + Lambda streaming + Server-Sent Events for Claude.ai remote MCP and other MCP clients that need a hosted endpoint
> 2. The **EVENT_SUB# reverse-lookup index** for webhook subscriptions, which fixes a scaling bug in Session 21's webhook-delivery Lambda
> 3. The **monthly spending reset cron Lambda** that resets `monthlySpendingSoFarEur` on all API keys at the start of each month

---

## Why these gaps matter

### Hosted MCP server

Session 21 implemented the local stdio mode of the MCP server — the version that ships as an npm package and runs inside Claude Desktop on the user's machine. That covers desktop MCP clients but does NOT cover:

- **Claude.ai remote MCP** — the web-hosted MCP feature in Claude.ai that talks to a remote server over HTTP+SSE
- **Other agent platforms** that connect to MCP servers over the network rather than running them as local subprocesses
- **Any agent framework that doesn't have a local execution environment** (CI runners, serverless agents, mobile-only agents)

The hosted MCP mode is documented in architecture v10 §10.5 as the second of two MCP modes, with explicit infrastructure spec (ALB + Lambda streaming + SSE) and a noted ~€22/month fixed cost per environment for the ALB.

### EVENT_SUB# reverse-lookup index

Session 21's webhook delivery Lambda has a scaling problem. The current implementation queries:

```typescript
KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'WEBHOOK#' }
```

This works for **user-scoped events** like `booking.confirmed` (where the booking has a known userId), because the dispatcher knows the user ID and can Query directly. It does **NOT** work for:

- **Listing-scoped events** like `listing.created` or `listing.availability_updated` where multiple users may want to subscribe to events about a single listing
- **System-wide events** like `block.request.market_changed` (a v3 idea) where there's no specific user attached
- **Cross-tenant events** where the dispatching code doesn't have the subscriber's user ID at hand

Architecture v10 §6.2 documents the fix: a separate `EVENT_SUB#{eventType}` reverse-lookup row that lets `webhook-dispatch` Query a single PK and get all subscribers for the event type, regardless of which user owns each subscription.

The fix is **two-row writes** on webhook registration: one row keyed `USER#{userId}/WEBHOOK#{webhookId}` (the existing user-owned record, used for the developer UI listing/management) and one row keyed `EVENT_SUB#{eventType}/WEBHOOK#{userId}#{webhookId}` per subscribed event type (the dispatch-side index). Webhook deletion deletes all the matching EVENT_SUB# rows in the same TransactWriteItems.

### Monthly spending reset cron

Session 21 created the `monthlySpendingSoFarEur` and `monthlyResetAt` fields on the `APIKEY#` record to enforce the monthly spending limit per key, but never wrote the cron Lambda that resets these fields on the 1st of each month. The agent integration is currently shipping with a known correctness bug: a key whose limit was hit in March will stay locked indefinitely until someone manually resets it.

The fix is small: an EventBridge Scheduler rule firing on `cron(0 0 1 * ? *)` (00:00 UTC on the 1st of each month) that triggers a Lambda which scans the `APIKEY#` records and resets the two fields atomically.

---

## DynamoDB schema additions

### EVENT_SUB# reverse-lookup index

```
PK: EVENT_SUB#{eventType}                SK: WEBHOOK#{userId}#{webhookId}
  webhookId, userId, url,
  signingSecretHash (sha256 of the raw signing secret — same value as the user-owned row),
  active (bool),
  registeredAt
```

**Notes:**
- One row per (eventType, webhook) tuple. A webhook subscribed to 3 event types creates 3 EVENT_SUB# rows.
- The SK structure `WEBHOOK#{userId}#{webhookId}` ensures uniqueness even if two users register webhooks with colliding webhookIds (which shouldn't happen with ULIDs, but defense in depth).
- This row is a **denormalised projection** of the user-owned `USER#/WEBHOOK#` row. The user-owned row remains the source of truth for the developer UI (list, create, delete). The EVENT_SUB# rows exist only to make dispatch efficient.
- `webhook-dispatch` reads from the EVENT_SUB# index. `webhook-register` and `webhook-delete` write both rows in a single TransactWriteItems.
- If the two rows ever drift (e.g. due to a partial transaction failure), the user-owned row wins. A nightly reconciliation job (out of scope for this session — listed as an open question) could detect drift and repair from the user-owned side.

### No changes to existing schema

- `USER#{userId}/WEBHOOK#{webhookId}` rows from Session 21 are unchanged.
- `APIKEY#{keyHash}/METADATA` rows from Session 21 are unchanged.

---

## Critical constants

```typescript
// Hosted MCP server
export const HOSTED_MCP_DOMAIN = process.env.HOSTED_MCP_DOMAIN ?? 'mcp.spotzy.com';
export const HOSTED_MCP_LISTENER_PORT = 443;
export const HOSTED_MCP_LAMBDA_TIMEOUT_SECONDS = 900;       // 15 minutes — Lambda max
export const HOSTED_MCP_RESPONSE_STREAMING = true;          // RESPONSE_STREAM mode
export const HOSTED_MCP_HEALTH_CHECK_PATH = '/health';
export const HOSTED_MCP_MCP_ENDPOINT_PATH = '/mcp';

// Webhook EVENT_SUB# index
export const SUPPORTED_WEBHOOK_EVENT_TYPES = [
  'booking.confirmed',
  'booking.active',
  'booking.completed',
  'booking.cancelled',
  'message.received',
] as const;
export type WebhookEventType = typeof SUPPORTED_WEBHOOK_EVENT_TYPES[number];

// Monthly spending reset
export const MONTHLY_RESET_CRON = 'cron(0 0 1 * ? *)';      // 00:00 UTC on the 1st of each month
export const MONTHLY_RESET_BATCH_SIZE = 100;                // DynamoDB BatchWriteItem max is 25, but UpdateItem is 1 per call — chunk in pages of 100
```

These constants live in `backend/src/shared/agent/constants.ts` (the same file Session 21 uses, extended).

---

## PART A — EVENT_SUB# reverse-lookup index

### A1 — Schema migration script for existing webhook subscriptions

Anyone who has Session 21 deployed already has `USER#{userId}/WEBHOOK#{webhookId}` rows but no `EVENT_SUB#` rows. The migration script backfills the EVENT_SUB# index from the existing user-owned rows.

**File:** `backend/scripts/backfill-event-sub-index.ts`

**Strategy:**

```typescript
// 1. Scan the table for items where SK begins with 'WEBHOOK#' (user-owned webhook records)
// 2. For each such row, expand its `events` array into one EVENT_SUB# row per event type
// 3. Use a TransactWriteItems batch (10 at a time to stay well under the 100-item limit)
// 4. Track progress in a separate CHECKPOINT# row so the script can resume after a failure
// 5. Output a CSV report listing all backfilled rows
```

**Tests first:** `backend/__tests__/scripts/backfill-event-sub-index.test.ts`

```typescript
describe('backfill-event-sub-index', () => {
  test('creates EVENT_SUB# row for each (eventType, webhook) pair', async () => {
    await seedWebhook({ userId: 'user-1', webhookId: 'wh-1', events: ['booking.confirmed', 'booking.cancelled'] });
    await seedWebhook({ userId: 'user-2', webhookId: 'wh-2', events: ['message.received'] });

    await runBackfill();

    // Verify 3 EVENT_SUB# rows exist
    const confirmed = await getDynamoItem('EVENT_SUB#booking.confirmed', 'WEBHOOK#user-1#wh-1');
    const cancelled = await getDynamoItem('EVENT_SUB#booking.cancelled', 'WEBHOOK#user-1#wh-1');
    const message = await getDynamoItem('EVENT_SUB#message.received', 'WEBHOOK#user-2#wh-2');
    expect(confirmed).toBeDefined();
    expect(cancelled).toBeDefined();
    expect(message).toBeDefined();
  });

  test('idempotent — running twice produces the same final state', async () => {
    await seedWebhook({ userId: 'user-1', webhookId: 'wh-1', events: ['booking.confirmed'] });
    await runBackfill();
    await runBackfill();
    const items = await scanTable('EVENT_SUB#booking.confirmed');
    expect(items).toHaveLength(1);   // not 2
  });

  test('skips inactive webhooks', async () => {
    await seedWebhook({ userId: 'user-1', webhookId: 'wh-1', events: ['booking.confirmed'], active: false });
    await runBackfill();
    const items = await scanTable('EVENT_SUB#booking.confirmed');
    expect(items).toHaveLength(0);
  });

  test('resumes from checkpoint after failure', async () => {
    // Seed 50 webhooks
    for (let i = 0; i < 50; i++) {
      await seedWebhook({ userId: `user-${i}`, webhookId: `wh-${i}`, events: ['booking.confirmed'] });
    }
    // Simulate failure halfway
    await runBackfill({ failAfter: 25 });
    // Verify checkpoint exists
    const checkpoint = await getDynamoItem('CHECKPOINT#backfill-event-sub-index', 'METADATA');
    expect(checkpoint.lastProcessedKey).toBeDefined();
    // Resume
    await runBackfill();
    // Verify all 50 EVENT_SUB# rows exist
    const items = await scanTable('EVENT_SUB#booking.confirmed');
    expect(items).toHaveLength(50);
  });
});
```

Implementation: standard scan with paginated `LastEvaluatedKey`. Each batch writes 10 EVENT_SUB# rows in a TransactWriteItems plus updates the CHECKPOINT# row with the next pagination cursor.

**Run instructions** (added to deployment README):
```bash
ts-node backend/scripts/backfill-event-sub-index.ts --env=staging --dry-run
ts-node backend/scripts/backfill-event-sub-index.ts --env=staging
ts-node backend/scripts/backfill-event-sub-index.ts --env=prod
```

The migration is idempotent and resumable, so it's safe to run during a normal deployment window without downtime.

### A2 — Update `webhook-register` Lambda (existing in Session 21)

**Existing endpoint:** `POST /api/v1/agent/webhooks` from Session 21 PART E1

This is a SURGICAL UPDATE to the existing Lambda. The change:

- Existing behaviour: writes one `USER#{userId}/WEBHOOK#{webhookId}` row
- New behaviour: writes one `USER#{userId}/WEBHOOK#{webhookId}` row PLUS one `EVENT_SUB#{eventType}/WEBHOOK#{userId}#{webhookId}` row per subscribed event type, all in a single TransactWriteItems

If the events array has 3 entries, the TransactWriteItems writes 1 + 3 = 4 rows. The maximum supported events array length is 5 (the count of `SUPPORTED_WEBHOOK_EVENT_TYPES`), so the maximum write is 6 rows — well under the 100-item TransactWriteItems limit.

**Tests first:** Add new test cases to the existing Session 21 webhook tests:

```typescript
describe('webhook-register with EVENT_SUB# index', () => {
  test('creates EVENT_SUB# row for each event type', async () => {
    const result = await handler(mockAuthEvent('user-1', {
      body: { url: 'https://example.com', events: ['booking.confirmed', 'booking.cancelled'] },
    }));
    expect(result.statusCode).toBe(201);
    const { webhookId } = JSON.parse(result.body);

    // User-owned row exists
    const userOwned = await getDynamoItem(`USER#user-1`, `WEBHOOK#${webhookId}`);
    expect(userOwned).toBeDefined();

    // Two EVENT_SUB# rows exist
    const sub1 = await getDynamoItem('EVENT_SUB#booking.confirmed', `WEBHOOK#user-1#${webhookId}`);
    const sub2 = await getDynamoItem('EVENT_SUB#booking.cancelled', `WEBHOOK#user-1#${webhookId}`);
    expect(sub1).toBeDefined();
    expect(sub2).toBeDefined();
    expect(sub1.signingSecretHash).toBe(userOwned.signingSecret);
    expect(sub1.active).toBe(true);
  });

  test('all rows written in a single TransactWriteItems (atomic)', async () => {
    // Force a failure on the 2nd EVENT_SUB# write to verify the entire batch is rolled back
    mockDynamoTransactWriteFailOnNthItem(2);
    const result = await handler(mockAuthEvent('user-1', {
      body: { url: 'https://example.com', events: ['booking.confirmed', 'booking.cancelled'] },
    }));
    expect(result.statusCode).toBe(500);
    // Verify NEITHER the user-owned row NOR any EVENT_SUB# row exists
    const userOwned = await scanTable(`USER#user-1`);
    expect(userOwned.filter((r) => r.SK.startsWith('WEBHOOK#'))).toHaveLength(0);
    const subRows = await scanTable('EVENT_SUB#');
    expect(subRows).toHaveLength(0);
  });

  test('rejects unknown event types with 400 INVALID_EVENT_TYPE', async () => {
    const result = await handler(mockAuthEvent('user-1', {
      body: { url: 'https://example.com', events: ['booking.confirmed', 'invented.event'] },
    }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('INVALID_EVENT_TYPE');
    expect(JSON.parse(result.body).details.invalidTypes).toEqual(['invented.event']);
  });
});
```

### A3 — Update `webhook-delete` Lambda (existing in Session 21)

**Existing endpoint:** `DELETE /api/v1/agent/webhooks/{webhookId}` from Session 21 PART E1

The change:
- Load the existing user-owned row to find the events array
- Delete the user-owned row PLUS all matching `EVENT_SUB#{eventType}/WEBHOOK#{userId}#{webhookId}` rows in a single TransactWriteItems

**Tests first:**

```typescript
describe('webhook-delete with EVENT_SUB# cleanup', () => {
  test('deletes user-owned row + all EVENT_SUB# rows', async () => {
    const { webhookId } = await seedWebhookWithEventSubs('user-1', ['booking.confirmed', 'message.received']);

    const result = await handler(mockAuthEvent('user-1', { pathParameters: { webhookId } }));
    expect(result.statusCode).toBe(200);

    // User-owned row gone
    const userOwned = await getDynamoItem(`USER#user-1`, `WEBHOOK#${webhookId}`);
    expect(userOwned).toBeUndefined();

    // EVENT_SUB# rows gone
    const sub1 = await getDynamoItem('EVENT_SUB#booking.confirmed', `WEBHOOK#user-1#${webhookId}`);
    const sub2 = await getDynamoItem('EVENT_SUB#message.received', `WEBHOOK#user-1#${webhookId}`);
    expect(sub1).toBeUndefined();
    expect(sub2).toBeUndefined();
  });

  test('atomicity — partial failure rolls back the entire delete', async () => {
    const { webhookId } = await seedWebhookWithEventSubs('user-1', ['booking.confirmed']);
    mockDynamoTransactWriteFailOnNthItem(2);
    const result = await handler(mockAuthEvent('user-1', { pathParameters: { webhookId } }));
    expect(result.statusCode).toBe(500);
    // Both rows should still exist
    expect(await getDynamoItem(`USER#user-1`, `WEBHOOK#${webhookId}`)).toBeDefined();
    expect(await getDynamoItem('EVENT_SUB#booking.confirmed', `WEBHOOK#user-1#${webhookId}`)).toBeDefined();
  });

  test('idempotent — deleting already-deleted webhook returns 200', async () => {
    const result = await handler(mockAuthEvent('user-1', { pathParameters: { webhookId: 'never-existed' } }));
    expect(result.statusCode).toBe(200);   // not 404 — idempotent contract
  });
});
```

### A4 — Replace the dispatch path in `webhook-delivery` Lambda

**Existing Lambda:** `functions/agent/webhook-delivery/index.ts` from Session 21 PART E2

The dispatch query changes from a per-user Query to a per-event-type Query:

**Before (Session 21 — broken for non-user-scoped events):**
```typescript
const { Items: webhooks = [] } = await dynamodb.query({
  KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
  FilterExpression: 'active = :t AND contains(events, :eventType)',
  ExpressionAttributeValues: {
    ':pk': `USER#${userId}`, ':prefix': 'WEBHOOK#',
    ':t': true, ':eventType': eventType,
  },
});
```

**After (uses the EVENT_SUB# index):**
```typescript
const { Items: subscriptions = [] } = await dynamodb.query({
  TableName: TABLE,
  KeyConditionExpression: 'PK = :pk',
  FilterExpression: 'active = :t',
  ExpressionAttributeValues: {
    ':pk': `EVENT_SUB#${eventType}`,
    ':t': true,
  },
});

// Each subscription row already has webhookId, userId, url, signingSecretHash
// — everything the deliverWebhook function needs. No need to re-fetch the user-owned row.
```

**Tests first:** Add new test cases AND update the existing Session 21 webhook-delivery tests to verify the new query pattern:

```typescript
describe('webhook-delivery with EVENT_SUB# index', () => {
  test('dispatches to all webhooks subscribed to the event type, regardless of user', async () => {
    // Seed webhooks for 3 different users, all subscribed to booking.confirmed
    await seedWebhookWithEventSubs('user-a', ['booking.confirmed']);
    await seedWebhookWithEventSubs('user-b', ['booking.confirmed']);
    await seedWebhookWithEventSubs('user-c', ['booking.confirmed', 'message.received']);

    await webhookDeliveryHandler({
      'detail-type': 'booking.confirmed',
      detail: { bookingId: 'b-1' },   // NOTE: no userId in the event detail
    });

    // All 3 users get a delivery
    expect(mockHttpPost).toHaveBeenCalledTimes(3);
  });

  test('event with no subscribers is a no-op (no errors)', async () => {
    await webhookDeliveryHandler({
      'detail-type': 'message.received',
      detail: { conversationId: 'c-1' },
    });
    expect(mockHttpPost).not.toHaveBeenCalled();
  });

  test('inactive subscriptions are skipped via the FilterExpression', async () => {
    await seedWebhookWithEventSubs('user-a', ['booking.confirmed'], { active: false });
    await seedWebhookWithEventSubs('user-b', ['booking.confirmed'], { active: true });
    await webhookDeliveryHandler({ 'detail-type': 'booking.confirmed', detail: {} });
    expect(mockHttpPost).toHaveBeenCalledTimes(1);
  });

  test('Query is single-PK (no user filter, no Scan)', async () => {
    await seedWebhookWithEventSubs('user-a', ['booking.confirmed']);
    await webhookDeliveryHandler({ 'detail-type': 'booking.confirmed', detail: {} });
    // Verify the underlying DynamoDB call is a Query with PK='EVENT_SUB#booking.confirmed'
    expect(mockDynamoQuery).toHaveBeenCalledWith(expect.objectContaining({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: expect.objectContaining({
        ':pk': 'EVENT_SUB#booking.confirmed',
      }),
    }));
  });
});
```

The HMAC signing, retry, audit logging, and 10-second timeout behaviour from Session 21 PART E2 are unchanged. Only the query path changes.

**Backward compatibility note**: After this session deploys, the dispatch path no longer reads from the `USER#/WEBHOOK#` rows. The user-owned rows remain the source of truth for the developer UI but are no longer on the dispatch hot path. If the EVENT_SUB# index ever drifts from the user-owned rows (which shouldn't happen given the TransactWriteItems atomicity), webhooks will silently stop firing for the affected subscriptions. The reconciliation job mentioned in the open questions section can detect and repair drift.

---

## PART B — Hosted MCP server (ALB + Lambda + SSE)

The hosted MCP server runs the **same MCP protocol** as the local stdio server from Session 21 PART C, but exposed over HTTP+SSE behind an Application Load Balancer instead of as a local stdin/stdout subprocess. The Lambda function uses **AWS Lambda Response Streaming** mode to return Server-Sent Events without buffering.

### B1 — MCP server Lambda (HTTP+SSE mode)

**File:** `backend/src/functions/agent/mcp-server-hosted/index.ts`

This is a NEW Lambda. It cannot reuse the local stdio server from Session 21 directly because the protocol transport is different (stdio frames vs HTTP requests with SSE response streaming). However, the **tool implementations** are shared — both the local and hosted MCP servers call the same underlying agent endpoints (search, quote, book, cancel, messages, preferences) via internal HTTP requests to API Gateway.

**Lambda configuration:**
- Runtime: `nodejs20.x`
- Handler: `index.handler` (uses `awslambda.streamifyResponse`)
- Memory: 1024 MB (the SSE streaming benefits from more memory for the WebStreams API overhead)
- Timeout: 900 seconds (Lambda max — long-lived MCP sessions can hold the connection open for the full duration)
- Function URL: NOT used. Function URLs do not support streaming responses. The Lambda is invoked through the ALB as a Lambda target type instead.

**Handler pseudocode:**

```typescript
// backend/src/functions/agent/mcp-server-hosted/index.ts
import { Buffer } from 'buffer';
import { McpServer } from './mcp-protocol';   // imports the protocol-handling logic shared with the local server
import { authenticateRequest } from './auth';

declare const awslambda: any;

export const handler = awslambda.streamifyResponse(async (event: any, responseStream: any, context: any) => {
  // Step 1: parse the ALB event
  const path = event.path;
  const method = event.httpMethod;
  const headers = event.headers;

  // Step 2: health check endpoint (no auth, no streaming)
  if (path === '/health' && method === 'GET') {
    responseStream.setHeader('Content-Type', 'text/plain');
    responseStream.write('ok');
    responseStream.end();
    return;
  }

  // Step 3: MCP endpoint
  if (path === '/mcp' && method === 'POST') {
    // Authenticate via Bearer token (same API key authorizer logic as the REST endpoints)
    const auth = await authenticateRequest(headers.authorization);
    if (!auth.valid) {
      responseStream.setHeader('Content-Type', 'application/json');
      responseStream.write(JSON.stringify({ error: 'unauthorized', message: auth.error }));
      responseStream.end();
      return;
    }

    // Set SSE headers
    responseStream.setHeader('Content-Type', 'text/event-stream');
    responseStream.setHeader('Cache-Control', 'no-cache');
    responseStream.setHeader('Connection', 'keep-alive');

    // Parse the incoming MCP request body (JSON-RPC 2.0)
    const body = JSON.parse(event.body);

    // Hand off to the MCP server protocol handler
    const mcpServer = new McpServer({ userId: auth.userId, scopes: auth.scopes });
    await mcpServer.handleStreamingRequest(body, {
      writeEvent: (name: string, data: any) => {
        responseStream.write(`event: ${name}\n`);
        responseStream.write(`data: ${JSON.stringify(data)}\n\n`);
      },
      writeData: (data: any) => {
        responseStream.write(`data: ${JSON.stringify(data)}\n\n`);
      },
      end: () => responseStream.end(),
    });
    return;
  }

  // Step 4: anything else
  responseStream.setHeader('Content-Type', 'application/json');
  responseStream.write(JSON.stringify({ error: 'not_found' }));
  responseStream.end();
});
```

The actual MCP protocol logic (`mcp-protocol.ts`) is reused from Session 21's local stdio server, but with a transport adapter pattern: instead of writing to stdout, it writes through the `writeEvent` / `writeData` / `end` callbacks injected by the streaming wrapper. Refactor the local server to use the same transport interface and have the stdio adapter implement it via stdout writes — this avoids code duplication.

**Tests first:** `backend/__tests__/agent/mcp-server-hosted.test.ts`

```typescript
describe('mcp-server-hosted Lambda', () => {
  test('GET /health returns 200 with body "ok"', async () => {
    const event = { path: '/health', httpMethod: 'GET', headers: {} };
    const responseStream = mockResponseStream();
    await handler(event, responseStream, mockContext());

    expect(responseStream.getHeaders()['Content-Type']).toBe('text/plain');
    expect(responseStream.getBody()).toBe('ok');
    expect(responseStream.isEnded()).toBe(true);
  });

  test('POST /mcp without Authorization returns 401', async () => {
    const event = { path: '/mcp', httpMethod: 'POST', headers: {}, body: '{}' };
    const responseStream = mockResponseStream();
    await handler(event, responseStream, mockContext());

    expect(JSON.parse(responseStream.getBody()).error).toBe('unauthorized');
  });

  test('POST /mcp with valid API key authenticates and starts SSE stream', async () => {
    await seedApiKey({ rawKey: 'sk_test_abc', userId: 'user-1', scopes: ['bookings:read'] });
    const event = {
      path: '/mcp',
      httpMethod: 'POST',
      headers: { authorization: 'Bearer sk_test_abc' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }),
    };
    const responseStream = mockResponseStream();
    await handler(event, responseStream, mockContext());

    expect(responseStream.getHeaders()['Content-Type']).toBe('text/event-stream');
    // Verify at least one SSE event was written
    expect(responseStream.getBody()).toMatch(/^data: /m);
  });

  test('handleStreamingRequest forwards tool calls to the agent endpoints', async () => {
    await seedApiKey({ rawKey: 'sk_test_xyz', userId: 'user-1', scopes: ['bookings:read'] });
    const event = {
      path: '/mcp',
      httpMethod: 'POST',
      headers: { authorization: 'Bearer sk_test_xyz' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 2,
        params: { name: 'list_bookings', arguments: { status: 'CONFIRMED' } },
      }),
    };
    const responseStream = mockResponseStream();

    // Mock the internal call to the list-bookings agent endpoint
    mockAgentEndpoint('GET', '/api/v1/agent/bookings?status=CONFIRMED', { bookings: [{ id: 'b-1' }] });

    await handler(event, responseStream, mockContext());

    const events = parseSSEEvents(responseStream.getBody());
    expect(events).toContainEqual(expect.objectContaining({ id: 2, result: { bookings: [{ id: 'b-1' }] } }));
  });

  test('long-running tool call streams progress updates', async () => {
    // Use a tool that fires progress events (e.g. a hypothetical "search_pools" tool that streams partial results)
    // Verify that multiple SSE `data: ` lines are written before the final response
  });

  test('handles client disconnect mid-stream gracefully', async () => {
    // Verify the Lambda doesn't crash when the responseStream is closed by the client
  });
});
```

Implementation notes:
- The `awslambda.streamifyResponse` helper is provided by the AWS Lambda Node.js runtime when the function is configured with `RESPONSE_STREAM` invoke mode. It's not an npm package.
- The TypeScript declaration `declare const awslambda: any;` at the top of the file is the standard pattern (the AWS SDK doesn't provide proper types for this yet).
- The MCP protocol logic must be **transport-agnostic**. Refactor the existing local stdio server's protocol handler to take a `Transport` interface with `writeEvent`, `writeData`, and `end` methods. The stdio adapter implements those by writing to stdout. The HTTP streaming adapter implements them via the response stream callbacks.
- Keep the per-request memory footprint small. The hosted MCP server can hold a connection open for up to 15 minutes; multiple concurrent connections multiply the memory pressure.
- Set ALB idle timeout to the maximum (4000 seconds — the ALB max) so it doesn't close the connection before the Lambda finishes.

### B2 — ALB and target group CDK

**File:** `lib/agent-stack.ts` (extend the existing AgentStack from Session 21)

```typescript
// Add to the AgentStack constructor body, after the existing webhook-delivery setup

import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53_targets from 'aws-cdk-lib/aws-route53-targets';

// ── Hosted MCP server Lambda ────────────────────────────────────────────
const mcpHostedFn = new lambda.Function(this, 'McpServerHosted', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('functions/agent/mcp-server-hosted'),
  environment: { ...commonEnv, AGENT_API_BASE_URL: mainApi.url },
  timeout: cdk.Duration.seconds(900),
  memorySize: 1024,
});
mainTable.grantReadData(mcpHostedFn);

// IMPORTANT: Lambda Response Streaming requires this invoke mode
const mcpHostedFnUrl = mcpHostedFn.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE,    // ALB handles auth at the application layer
  invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
});

// ── ALB ─────────────────────────────────────────────────────────────────
// Reuses the default VPC. If no default VPC exists, create one with 2 public subnets in eu-west-3.
const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

const alb = new elbv2.ApplicationLoadBalancer(this, 'McpHostedAlb', {
  vpc,
  internetFacing: true,
  loadBalancerName: `spotzy-mcp-hosted-${this.envName}`,
  idleTimeout: cdk.Duration.seconds(4000),    // ALB maximum, prevents premature SSE disconnects
});

// Domain name and certificate (assumed to exist — provisioned manually or via a separate stack)
const hostedZone = route53.HostedZone.fromLookup(this, 'SpotzyHostedZone', {
  domainName: 'spotzy.com',
});
const mcpDomainName = `mcp${this.envName === 'prod' ? '' : '-' + this.envName}.spotzy.com`;
const cert = new acm.Certificate(this, 'McpHostedCert', {
  domainName: mcpDomainName,
  validation: acm.CertificateValidation.fromDns(hostedZone),
});

const httpsListener = alb.addListener('McpHttpsListener', {
  port: 443,
  protocol: elbv2.ApplicationProtocol.HTTPS,
  certificates: [cert],
  defaultAction: elbv2.ListenerAction.fixedResponse(404, { contentType: 'text/plain', messageBody: 'Not Found' }),
});

// Route /mcp and /health to the Lambda target group
const mcpTargetGroup = new elbv2.ApplicationTargetGroup(this, 'McpTargetGroup', {
  targetType: elbv2.TargetType.LAMBDA,
  targets: [new elbv2_targets.LambdaTarget(mcpHostedFn)],
  healthCheck: {
    enabled: true,
    path: '/health',
  },
});

httpsListener.addAction('McpRoutingRule', {
  priority: 10,
  conditions: [elbv2.ListenerCondition.pathPatterns(['/mcp', '/health'])],
  action: elbv2.ListenerAction.forward([mcpTargetGroup]),
});

// Route 53 alias record
new route53.ARecord(this, 'McpHostedAliasRecord', {
  zone: hostedZone,
  recordName: mcpDomainName,
  target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(alb)),
});

// HTTP → HTTPS redirect listener (port 80)
alb.addListener('McpHttpRedirect', {
  port: 80,
  protocol: elbv2.ApplicationProtocol.HTTP,
  defaultAction: elbv2.ListenerAction.redirect({
    protocol: 'HTTPS',
    port: '443',
    permanent: true,
  }),
});
```

**Cost note:** the ALB introduces a fixed cost of approximately €22/month per environment in eu-west-3 (Paris). This is documented in architecture v10 §10.5 as the only fixed-cost AWS resource in the otherwise fully serverless v2.x stack. For dev/staging environments where hosted MCP usage is low, an alternative is to consolidate dev and staging onto a single shared ALB with path-prefix routing.

**Health check note:** the ALB target group health check sends `GET /health` to the Lambda. The Lambda's health check branch is the first thing in the handler (no auth, no DynamoDB read) so it stays cheap.

### B3 — Frontend: API key UI documentation update

**File:** `frontend/app/account/api-keys/page.tsx` (existing from Session 21 PART F)

Add a new section to the API key management page documenting how to connect a hosted MCP client:

- A "Hosted MCP" section card showing the URL `https://mcp.spotzy.com/mcp` with copy buttons
- A code snippet for Claude.ai remote MCP configuration
- A code snippet for the local stdio MCP version (preserved from Session 21) so users can pick the version that fits their client

This is documentation only — no new functional behaviour. **Tests first:** verify both URL displays + copy button interactions.

### B4 — Integration test: end-to-end hosted MCP flow

`backend/__tests__/integration/mcp-hosted.integration.test.ts`

```typescript
describe('Hosted MCP server end-to-end', () => {
  test('client connects, initializes, calls a tool, gets streamed response', async () => {
    // 1. Start a local instance of the hosted MCP Lambda using the SAM local emulator
    //    OR mock the Lambda by calling the handler directly with a fabricated ALB event
    // 2. POST to /mcp with an MCP initialize request
    // 3. Verify the SSE response contains the initialize result
    // 4. POST a tools/call request
    // 5. Verify the SSE stream contains the tool result
  });

  test('client without API key gets 401', async () => { /* ... */ });
  test('client with revoked API key gets 401', async () => { /* ... */ });
  test('GET /health returns 200', async () => { /* ... */ });
});
```

---

## PART C — Monthly spending reset cron Lambda

### C1 — `apikey-monthly-reset` Lambda

**File:** `backend/src/functions/agent/apikey-monthly-reset/index.ts`

**Trigger:** EventBridge Scheduler rule firing at `cron(0 0 1 * ? *)` (00:00 UTC on the 1st of each month)
**Implements:** Resets `monthlySpendingSoFarEur` to `0` on every `APIKEY#` row, updates `monthlyResetAt` to the new period start

**Tests first:** `backend/__tests__/agent/apikey-monthly-reset.test.ts`

```typescript
describe('apikey-monthly-reset Lambda', () => {
  test('resets monthlySpendingSoFarEur to 0 on all active API keys', async () => {
    await seedApiKey({ keyId: 'key-1', monthlySpendingSoFarEur: 15.50, monthlyResetAt: '2026-03-01T00:00:00Z' });
    await seedApiKey({ keyId: 'key-2', monthlySpendingSoFarEur: 250.00, monthlyResetAt: '2026-03-01T00:00:00Z' });
    await seedApiKey({ keyId: 'key-3', monthlySpendingSoFarEur: 0, monthlyResetAt: '2026-03-01T00:00:00Z' });

    await handler({ time: '2026-04-01T00:00:00Z' });

    const k1 = await getDynamoItem(`APIKEY#${hash('key-1')}`, 'METADATA');
    const k2 = await getDynamoItem(`APIKEY#${hash('key-2')}`, 'METADATA');
    const k3 = await getDynamoItem(`APIKEY#${hash('key-3')}`, 'METADATA');

    expect(k1.monthlySpendingSoFarEur).toBe(0);
    expect(k1.monthlyResetAt).toBe('2026-04-01T00:00:00.000Z');
    expect(k2.monthlySpendingSoFarEur).toBe(0);
    expect(k3.monthlySpendingSoFarEur).toBe(0);
  });

  test('skips revoked API keys', async () => {
    await seedApiKey({ keyId: 'key-revoked', monthlySpendingSoFarEur: 10, revokedAt: '2026-02-15T12:00:00Z' });
    await handler({ time: '2026-04-01T00:00:00Z' });

    const k = await getDynamoItem(`APIKEY#${hash('key-revoked')}`, 'METADATA');
    // Revoked keys are NOT reset — preserves the audit trail of how much they had spent before revocation
    expect(k.monthlySpendingSoFarEur).toBe(10);
  });

  test('paginates through large key sets', async () => {
    // Seed 250 API keys
    for (let i = 0; i < 250; i++) {
      await seedApiKey({ keyId: `key-${i}`, monthlySpendingSoFarEur: 5 });
    }

    await handler({ time: '2026-04-01T00:00:00Z' });

    // Verify all 250 are reset
    for (let i = 0; i < 250; i++) {
      const k = await getDynamoItem(`APIKEY#${hash(`key-${i}`)}`, 'METADATA');
      expect(k.monthlySpendingSoFarEur).toBe(0);
    }
  });

  test('idempotent — running twice in the same minute is a no-op the second time', async () => {
    await seedApiKey({ keyId: 'key-1', monthlySpendingSoFarEur: 10 });
    await handler({ time: '2026-04-01T00:00:00Z' });
    await handler({ time: '2026-04-01T00:00:00Z' });
    const k = await getDynamoItem(`APIKEY#${hash('key-1')}`, 'METADATA');
    expect(k.monthlySpendingSoFarEur).toBe(0);   // still 0, no error
  });

  test('emits CloudWatch metric with the count of keys reset', async () => {
    // Verify the Lambda calls PutMetricData with a Spotzy/AgentApi/MonthlyResetCount metric
  });

  test('handles transient DynamoDB throttle by retrying with backoff', async () => {
    mockDynamoUpdateThrottle(2);   // first 2 calls throttle, 3rd succeeds
    await seedApiKey({ keyId: 'key-1', monthlySpendingSoFarEur: 10 });
    await handler({ time: '2026-04-01T00:00:00Z' });
    const k = await getDynamoItem(`APIKEY#${hash('key-1')}`, 'METADATA');
    expect(k.monthlySpendingSoFarEur).toBe(0);
  });
});
```

**Implementation strategy:**

```typescript
// backend/src/functions/agent/apikey-monthly-reset/index.ts
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

export const handler = async (event: { time: string }) => {
  const client = DynamoDBDocumentClient.from(/* ... */);
  const cloudwatch = new CloudWatchClient({});
  const newResetAt = new Date(event.time).toISOString();

  let resetCount = 0;
  let lastEvaluatedKey: Record<string, any> | undefined;

  // Scan with FilterExpression: PK begins_with APIKEY# AND attribute_not_exists(revokedAt)
  do {
    const result = await client.send(new ScanCommand({
      TableName: process.env.DYNAMODB_TABLE!,
      FilterExpression: 'begins_with(PK, :prefix) AND attribute_not_exists(revokedAt)',
      ExpressionAttributeValues: { ':prefix': 'APIKEY#' },
      ExclusiveStartKey: lastEvaluatedKey,
      Limit: 100,
    }));

    // Update each key in parallel (UpdateItem is not transactionally needed — these are independent rows)
    const updates = (result.Items ?? []).map(async (item) => {
      try {
        await client.send(new UpdateCommand({
          TableName: process.env.DYNAMODB_TABLE!,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: 'SET monthlySpendingSoFarEur = :zero, monthlyResetAt = :now',
          ExpressionAttributeValues: { ':zero': 0, ':now': newResetAt },
          ConditionExpression: 'attribute_not_exists(revokedAt)',   // defensive race-condition guard
        }));
        return true;
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') return false;   // revoked between scan and update
        throw err;
      }
    });

    const results = await Promise.all(updates);
    resetCount += results.filter(Boolean).length;

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  // Emit CloudWatch metric for monitoring
  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: 'Spotzy/AgentApi',
    MetricData: [{
      MetricName: 'MonthlyResetCount',
      Value: resetCount,
      Unit: 'Count',
      Timestamp: new Date(),
    }],
  }));

  return { resetCount };
};
```

**Notes:**
- Uses Scan (not Query) because there's no GSI on `APIKEY#` rows alone — they're spread across the table by their hash. The Scan is bounded by the `FilterExpression` to only `APIKEY#` rows.
- The Scan runs at most once per month, so the cost is negligible even at scale (10k keys = ~$0.001 per scan).
- Each UpdateItem has a `ConditionExpression: 'attribute_not_exists(revokedAt)'` as a defensive race guard — if a key is revoked between the Scan reading it and the UpdateItem trying to reset it, the UpdateItem fails silently.
- The CloudWatch metric `Spotzy/AgentApi/MonthlyResetCount` lets you monitor reset success in CloudWatch alarms (e.g. alert if the metric drops to 0 in a month when there should be at least 1 active key).

### C2 — EventBridge Scheduler rule

**File:** `lib/agent-stack.ts` (extend the AgentStack)

```typescript
// ── Monthly spending reset Lambda + Scheduler rule ──────────────────────
const apiKeyResetFn = new lambda.Function(this, 'ApiKeyMonthlyReset', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('functions/agent/apikey-monthly-reset'),
  environment: commonEnv,
  timeout: cdk.Duration.minutes(5),    // 5 minute budget for the scan + updates
});
mainTable.grantReadWriteData(apiKeyResetFn);
apiKeyResetFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['cloudwatch:PutMetricData'],
  resources: ['*'],
}));

const schedulerRole = new iam.Role(this, 'ApiKeyResetSchedulerRole', {
  assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
});
apiKeyResetFn.grantInvoke(schedulerRole);

new scheduler.Schedule(this, 'ApiKeyResetSchedule', {
  scheduleName: 'spotzy-apikey-monthly-reset',
  scheduleExpression: scheduler.ScheduleExpression.cron({
    minute: '0',
    hour: '0',
    day: '1',
    month: '*',
    year: '*',
  }),
  scheduleExpressionTimezone: 'UTC',
  target: new scheduler.targets.LambdaInvoke(apiKeyResetFn, {
    input: scheduler.ScheduleTargetInput.fromObject({ source: 'monthly-cron' }),
    role: schedulerRole,
  }),
  flexibleTimeWindow: scheduler.TimeWindow.off(),
});
```

This **replaces the `// TODO: implement monthly-reset Lambda` comment** in the existing AgentStack from Session 21 PART G.

---

## PART D — Migration order

The three pieces in this session can be deployed independently and in any order, but the recommended order is:

1. **PART C (monthly reset cron)** first — small, low-risk, fixes a correctness bug, no schema changes
2. **PART A (EVENT_SUB# index)** second — requires the migration script run BEFORE updating the dispatch path. The order is: deploy the schema migration script, run it against staging in dry-run mode, run it for real in staging, validate, deploy to prod, run the script in prod, then deploy the updated `webhook-register`/`webhook-delete`/`webhook-delivery` Lambdas
3. **PART B (hosted MCP)** last — requires DNS, ACM cert, ALB provisioning, and is the most expensive piece of infrastructure to validate

Each part can be run in its own Claude Code session for clarity, or all three in sequence if the developer prefers.

---

## PART E — Acceptance criteria

A successful Claude Code run produces:

1. The `EVENT_SUB#` reverse-lookup index is populated for all existing webhooks via the backfill script
2. `webhook-register` writes user-owned + N EVENT_SUB# rows in a single atomic TransactWriteItems
3. `webhook-delete` removes user-owned + all matching EVENT_SUB# rows atomically
4. `webhook-delivery` Queries the EVENT_SUB# index by event type, fanning out to all subscribed webhooks regardless of user
5. The migration script is idempotent and resumable from a checkpoint
6. The hosted MCP server Lambda runs in RESPONSE_STREAM mode and serves SSE responses
7. The ALB is provisioned with HTTPS listener, ACM cert, Route53 alias, and routes /mcp + /health to the Lambda target group
8. The hosted MCP Lambda authenticates via the same API key authorizer as the REST endpoints
9. The MCP protocol logic is shared between the local stdio server and the hosted streaming server via a transport abstraction
10. The `apikey-monthly-reset` Lambda resets all active API keys on the 1st of each month at 00:00 UTC
11. The reset Lambda skips revoked keys (preserves audit trail) and emits a CloudWatch metric for monitoring
12. The EventBridge Scheduler rule `spotzy-apikey-monthly-reset` is created in CDK
13. The frontend API key page documents the hosted MCP URL and shows configuration snippets for both modes
14. Architecture v10 §5.21, §6.2, and §10.5 are now fully implemented in code (no remaining gaps)

### Open questions to resolve at implementation time

1. **Webhook drift reconciliation** — if the EVENT_SUB# index ever drifts from the user-owned `USER#/WEBHOOK#` rows (e.g. due to a partial transaction failure that wasn't caught), webhooks will silently stop firing. A nightly reconciliation Lambda would scan both sides and repair drift. This is OUT of scope for this session — flag as a follow-up monitoring task. Recommendation: add a CloudWatch alarm on `webhook-delivery` errors as a leading indicator that drift may have occurred.

2. **Hosted MCP cost for low-traffic environments** — €22/month per ALB is wasteful for dev and staging environments that see < 100 MCP requests/month. Two alternatives:
   - **Single shared ALB across dev and staging** with path-prefix routing (`/mcp-dev/*` and `/mcp-staging/*`) — saves ~€22/month at the cost of slightly more complex CDK
   - **API Gateway HTTP API instead of ALB** — cheaper for low traffic but does NOT support response streaming. Would require giving up SSE and using polling instead. Not recommended for the MCP use case.
   Recommendation: ship one ALB per environment for the first cut, monitor utilisation, consolidate if usage stays low after 3 months.

3. **ALB idle timeout vs Lambda timeout mismatch** — the ALB idle timeout is set to 4000 seconds (the maximum), but the Lambda timeout is 900 seconds (also the maximum). Long MCP sessions that exceed 900 seconds will see the Lambda terminate while the ALB connection is still open, resulting in a hung connection from the client's perspective. Mitigation: the MCP server should send periodic SSE keepalive comments (`: keepalive\n\n`) every 30 seconds AND should gracefully close the connection at the 850-second mark to give clients time to reconnect.

4. **Lambda cold start latency for hosted MCP** — the 1024 MB Lambda has a cold start of ~500-800ms in eu-west-3. For interactive MCP clients this is acceptable but noticeable. Provisioned concurrency is an option (~€10/month per provisioned instance) but not justified until usage warrants it. Document as a known characteristic, not a defect.

5. **Monthly reset timing alignment with timezones** — the cron fires at 00:00 UTC, which is 01:00 Brussels time in winter and 02:00 in summer. This is fine for billing-period boundaries that nominally align to "the 1st of the month UTC", but if Spotzy ever needs to align reset to a customer's local timezone, that's a per-key reset schedule which is significantly more complex. Out of scope for this session.

---

## Reading order for Claude Code

When feeding this file to Claude Code, the recommended sequence is:

1. **PART C (monthly reset)** — smallest, lowest risk, fixes a known correctness bug
   - C1 (Lambda + tests)
   - C2 (CDK Scheduler rule)
2. **PART A (EVENT_SUB# index)** — schema migration is the highest-risk piece, do it second when fresh
   - A1 (backfill script + tests) — run dry-run against staging immediately after writing
   - A2 (webhook-register update)
   - A3 (webhook-delete update)
   - A4 (webhook-delivery dispatch path replacement)
3. **PART B (hosted MCP server)** — most infrastructure, save for last
   - B1 (Lambda + tests + protocol transport refactor)
   - B2 (ALB + Route53 + ACM CDK)
   - B3 (frontend API key page documentation)
   - B4 (integration test)

The most critical risk is the **EVENT_SUB# migration** in PART A. If the migration script and the Lambda updates are deployed in the wrong order, webhooks will silently stop firing for any user whose dispatch path was switched before the EVENT_SUB# rows existed. The strict sequence is:

1. Write the backfill script and the updated Lambdas in code
2. Deploy the backfill script ALONE (don't deploy the updated Lambdas yet)
3. Run the backfill script in dry-run mode against staging
4. Run the backfill script for real in staging
5. Manually verify a few webhooks fire correctly via the OLD dispatch path (still pointing at user-owned rows)
6. Deploy the updated Lambdas to staging
7. Manually verify webhooks still fire correctly via the NEW dispatch path
8. Repeat 4–7 for production

Document this in the deployment runbook. The bug class here is "silent webhook delivery failure during a deploy window" which is the worst possible failure mode for an integration that customers rely on for booking notifications.
