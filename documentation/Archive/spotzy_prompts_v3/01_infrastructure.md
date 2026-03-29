# Session 01 — Infrastructure (CDK Stacks)

## What this session does
Implements all five CDK stacks fully. After this session the entire AWS infrastructure can be deployed with `cdk deploy --all`.

## Feed to Claude Code
This file only. No other docs needed.

## Prompt

Implement the five AWS CDK v2 (TypeScript) stacks for the Spotzy P2P parking marketplace. The scaffold already exists — fill in the full resource definitions for each stack.

---

### Stack 1 — DataStack (`lib/data-stack.ts`)

**DynamoDB table: `spotzy-main`**
- Billing: on-demand (PAY_PER_REQUEST)
- Partition key: `PK` (String), Sort key: `SK` (String)
- GSI1: partition key `GSI1PK` (String), sort key `GSI1SK` (String), projection ALL
- GSI2: partition key `geohash` (String), sort key `listingId` (String), projection KEYS_ONLY
- DynamoDB Streams: NEW_AND_OLD_IMAGES
- Point-in-time recovery: enabled
- TTL attribute: `ttl`

**S3 buckets**
- `spotzy-media-uploads` — versioning enabled, CORS for direct browser upload from spotzy.com, lifecycle: delete objects after 7 days if not tagged `validated=true`
- `spotzy-media-public` — no public access (CloudFront OAC only), SSE-S3
- `spotzy-media-disputes` — private, versioning enabled, lifecycle: transition to Glacier after 365 days
- `spotzy-frontend` — no public access (CloudFront OAC only)
- `spotzy-logs` — private

Export: table ARN, table name, all bucket ARNs and names.

---

### Stack 2 — ApiStack (`lib/api-stack.ts`)

**Cognito User Pool**
- Self sign-up enabled
- Email verification required
- Phone number attribute (required, mutable)
- Password policy: min 8 chars, uppercase, lowercase, numbers
- App client: no secret, auth flows: USER_PASSWORD_AUTH + REFRESH_TOKEN_AUTH

**API Gateway REST API: `spotzy-api`**
- All routes prefixed `/api/v1/`
- Default Cognito JWT authorizer on all routes except:
  - `GET /listings/search` (public)
  - `GET /listings/{id}` (public)
  - `POST /payments/webhook` (no authorizer — raw body passthrough, Stripe sig verified in Lambda)
- CORS: origin `https://spotzy.com` (and `http://localhost:3000` for dev), methods GET/POST/PUT/DELETE/OPTIONS
- Throttling: 1000 burst, 500 steady-state
- Routes: implement all 20 REST routes from the route map, each pointing to a placeholder Lambda (use `aws_lambda.Function.from_function_name` with the function name convention `spotzy-{domain}-{action}`)

**WebSocket API: `spotzy-ws`**
- Routes: `$connect`, `$disconnect`, `sendMessage`
- Stage: `prod`

Export: REST API URL, WebSocket URL, User Pool ID, User Pool Client ID.

---

### Stack 3 — IntegrationStack (`lib/integration-stack.ts`)

**EventBridge custom bus: `spotzy-events`**

**EventBridge rules** — one rule per event, each targeting the appropriate Lambda:
- `booking.created` → [availability-block, notify-sms, notify-email]
- `booking.modified` → [availability-block, availability-release, notify-sms, notify-email]
- `booking.cancelled` → [availability-release, notify-sms, notify-email, payout-trigger]
- `booking.completed` → [payout-trigger, review-aggregate, preference-learn]
- `dispute.created` → [notify-sms, notify-email]
- `dispute.escalated` → [notify-sms, notify-email]
- `listing.published` → [listing-ai-validate]

**EventBridge Scheduler** — daily rule to check for bookings ending in the next 24h and trigger `booking-complete-check` Lambda.

**SNS topic: `spotzy-notifications-sms`**

**SES configuration**
- Email identity for `spotzy.com` (assumes domain is verified externally)
- Configuration set: `spotzy-transactional`

**Secrets Manager secrets** (empty values — to be filled manually):
- `spotzy/stripe/secret-key`
- `spotzy/stripe/webhook-secret`
- `spotzy/stripe/connect-client-id`
- `spotzy/mapbox/server-token`
- `spotzy/sns/sender-id`

---

### Stack 4 — FrontendStack (`lib/frontend-stack.ts`)

**CloudFront distribution**
- Origins: `spotzy-frontend` bucket (OAC), `spotzy-media-public` bucket (OAC) at path `/media/*`
- Default behaviour: `spotzy-frontend`, cache policy managed CachingOptimized
- Error responses: 404 and 403 → `/index.html` (SPA fallback)
- WAF: associate `AWS-AWSManagedRulesCommonRuleSet` + `AWS-AWSManagedRulesAmazonIpReputationList`
- ACM certificate: use `certificateArn` from context (injected per environment)
- Aliases: `spotzy.com`, `www.spotzy.com` (prod) / `dev.spotzy.com` (dev) / `staging.spotzy.com` (staging)

---

### Stack 5 — ObservabilityStack (`lib/observability-stack.ts`)

**CloudWatch alarms**
- Lambda errors > 5 in 5 minutes for: booking-create, payment-intent, payment-webhook
- API Gateway 5xx rate > 1% over 5 minutes
- DynamoDB system errors > 0

**CloudWatch dashboard: `Spotzy-MVP`**
- Widgets: Lambda invocations + errors (all functions), API Gateway requests + latency, DynamoDB read/write units

**X-Ray tracing**
- Enable active tracing on all Lambda functions and API Gateway

---

### Cross-stack wiring
- ApiStack receives DataStack outputs (table name, bucket names) via constructor props
- IntegrationStack receives ApiStack outputs (Lambda function names) via constructor props
- FrontendStack is independent

### Environment support
- Read `process.env.ENVIRONMENT` (dev / staging / prod) and suffix resource names accordingly where appropriate (e.g. `spotzy-main-dev`)
- Prod resources should have `removalPolicy: RETAIN`; dev/staging use `DESTROY`

### Output
Generate complete, deployable TypeScript CDK code for all five stacks. Use `aws-cdk-lib` v2 imports throughout.
