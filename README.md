# Spotzy

Spotzy is a peer-to-peer parking marketplace that connects hosts who rent out private parking spots with spotters (drivers) who need them. It is built on AWS serverless infrastructure using TypeScript throughout.

---

## Project Structure

```
spotzy/
├── backend/                    # Lambda functions + shared library
│   ├── shared/
│   │   ├── types/              # Domain types (User, Listing, Booking, …)
│   │   ├── db/                 # DynamoDB client singleton + key builders
│   │   └── utils/              # HTTP response helpers + Cognito auth helpers
│   ├── functions/
│   │   ├── listings/           # create / update / publish / delete / search / get
│   │   │                       # ai-validate / photo-url / photo-delete / photo-reorder
│   │   │                       # availability-get / availability-put
│   │   ├── bookings/           # create / get / modify / cancel
│   │   ├── payments/           # intent / webhook / payout-trigger
│   │   ├── chat/               # connect / disconnect / send / get / image-url
│   │   ├── notifications/      # sms / email (EventBridge targets)
│   │   ├── reviews/            # create / aggregate
│   │   ├── disputes/           # create / message / escalate
│   │   ├── users/              # get / update / public-get / payout-setup
│   │   │                       # post-confirmation / me-listings / me-bookings / me-metrics
│   │   ├── availability/       # block / release (EventBridge consumers)
│   │   └── preferences/        # learn
│   └── package.json
├── frontend/                   # Next.js 14 App Router
│   ├── app/                    # Route segments (pages)
│   │   ├── page.tsx            # Home / hero
│   │   ├── search/             # Search results + map
│   │   ├── listing/[id]/       # Listing detail
│   │   ├── book/[id]/          # Booking checkout (Stripe)
│   │   ├── dashboard/host/     # Host dashboard
│   │   ├── dashboard/spotter/  # Spotter dashboard
│   │   ├── chat/[bookingId]/   # Real-time chat
│   │   └── dispute/[bookingId]/# Dispute thread
│   ├── components/             # Shared UI components
│   ├── lib/
│   │   ├── api.ts              # Typed REST API client
│   │   ├── mapbox.ts           # Mapbox GL JS helpers
│   │   └── stripe.ts           # Stripe.js singleton
│   └── package.json
├── infrastructure/             # AWS CDK v2 (TypeScript)
│   ├── bin/spotzy.ts           # CDK app entry point
│   ├── lib/
│   │   ├── data-stack.ts       # DynamoDB table + S3 buckets
│   │   ├── api-stack.ts        # Cognito + API Gateway REST + WebSocket
│   │   ├── frontend-stack.ts   # S3 + CloudFront distribution
│   │   ├── integration-stack.ts# EventBridge + SNS + SES
│   │   └── observability-stack.ts # CloudWatch dashboards + alarms
│   ├── cdk.json
│   └── package.json
├── .github/
│   └── workflows/
│       └── deploy.yml          # CI/CD pipeline
└── README.md
```

---

## Architecture Overview

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS — hosted on S3 + CloudFront |
| API | AWS API Gateway REST + WebSocket, Cognito JWT authorizer |
| Compute | AWS Lambda, Node.js 20.x, TypeScript, one function per domain |
| Database | DynamoDB single table `spotzy-main` |
| Storage | S3: `spotzy-media-uploads`, `spotzy-media-public`, `spotzy-media-disputes`, `spotzy-frontend`, `spotzy-logs` |
| Auth | Amazon Cognito User Pools |
| Events | Amazon EventBridge (bus: `spotzy-events`) |
| Notifications | Amazon SNS (SMS) + Amazon SES (email) |
| Payments | Stripe Connect |
| Maps | Mapbox GL JS |
| IaC | AWS CDK v2 (TypeScript) |

---

## Prerequisites

- **Node.js 20** — [https://nodejs.org](https://nodejs.org)
- **AWS CLI v2** — [https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- **AWS CDK CLI** — `npm install -g aws-cdk`
- **AWS credentials** configured locally (`aws configure` or via environment variables)

---

## Local Development

### 1. Install dependencies

```bash
# Backend
cd backend && npm install

# Frontend
cd frontend && npm install

# Infrastructure
cd infrastructure && npm install
```

### 2. Environment variables

Copy the example env file for the frontend and fill in your values:

```bash
cp frontend/.env.example frontend/.env.local
```

Required variables:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | REST API base URL (e.g. `https://abc.execute-api.us-east-1.amazonaws.com/prod`) |
| `NEXT_PUBLIC_WS_URL` | WebSocket API URL |
| `NEXT_PUBLIC_MEDIA_URL` | CloudFront distribution URL for serving validated listing photos |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox public access token |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | Cognito App Client ID |

### 3. Start the frontend dev server

```bash
cd frontend
npm run dev
# Open http://localhost:3000
```

### 4. Run Lambda functions locally (optional)

Use AWS SAM CLI or the AWS Toolkit for VSCode to invoke individual Lambda functions:

```bash
# Example: invoke listing-search locally
aws lambda invoke \
  --function-name spotzy-listing-search \
  --payload '{"queryStringParameters":{"lat":"51.5","lng":"-0.1"}}' \
  response.json
```

---

## Testing

### Unit tests (backend — Jest)

```bash
cd backend
npm test                    # run all unit tests once
npm run test:watch          # watch mode
npm test -- --coverage      # with coverage report
```

### Component tests (frontend — Vitest)

```bash
cd frontend
npm test                    # run all component tests
npm run test:ui             # open Vitest UI in browser
```

### Integration tests

```bash
cd backend
npm run test:integration    # requires AWS credentials + test DynamoDB table
```

### E2E tests (Playwright — to be added)

```bash
cd frontend
npx playwright install      # first time only
npx playwright test         # run all E2E tests
npx playwright test --ui    # interactive UI mode
```

---

## Deployment

### Bootstrap CDK (first time only per AWS account / region)

```bash
cd infrastructure
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1
```

### Deploy all stacks

```bash
cd infrastructure
npm run build
npx cdk deploy --all
```

### Deploy a single stack

```bash
npx cdk deploy SpotzyDataStack
npx cdk deploy SpotzyApiStack
npx cdk deploy SpotzyFrontendStack
npx cdk deploy SpotzyIntegrationStack
npx cdk deploy SpotzyObservabilityStack
```

### Deploy the frontend

```bash
cd frontend
npm run build               # generates frontend/out/ (static export)
aws s3 sync out/ s3://spotzy-frontend/ --delete
aws cloudfront create-invalidation \
  --distribution-id DISTRIBUTION_ID \
  --paths "/*"
```

### CI/CD Pipeline

| Trigger | What runs |
|---|---|
| Pull Request to `main` | Unit tests (Jest + Vitest) + CDK synth |
| Merge to `main` | PR checks + integration tests + deploy to **test** + API smoke tests |
| Push tag `v*` | All above + deploy to **staging** + Playwright E2E + manual approval gate + deploy to **production** |

Required GitHub secrets:

- `AWS_ACCESS_KEY_ID_TEST` / `AWS_SECRET_ACCESS_KEY_TEST`
- `AWS_ACCESS_KEY_ID_STAGING` / `AWS_SECRET_ACCESS_KEY_STAGING`
- `AWS_ACCESS_KEY_ID_PROD` / `AWS_SECRET_ACCESS_KEY_PROD`
- `MAPBOX_TOKEN`
- `STRIPE_PUBLISHABLE_KEY_TEST` / `STRIPE_PUBLISHABLE_KEY_PROD`
- Environment-specific: `*_API_URL`, `*_WS_URL`, `*_COGNITO_USER_POOL_ID`, `*_COGNITO_CLIENT_ID`, `*_CLOUDFRONT_DISTRIBUTION_ID`

---

## DynamoDB Key Patterns

The `spotzy-main` table uses a single-table design. See `backend/shared/db/keys.ts` for all builder functions.

| PK | SK | Notes |
|---|---|---|
| `USER#{userId}` | `PROFILE` | User profile |
| `USER#{userId}` | `PREFS` | User preferences |
| `LISTING#{listingId}` | `METADATA` | Listing metadata |
| `LISTING#{listingId}` | `AVAIL#{date}` | Availability slot |
| `LISTING#{listingId}` | `BOOKING#{bookingId}` | Listing-booking relation |
| `BOOKING#{bookingId}` | `METADATA` | Booking metadata |
| `CHAT#{bookingId}` | `MSG#{timestamp}#{messageId}` | Chat message |
| `REVIEW#{targetId}` | `REVIEW#{bookingId}` | Review |
| `DISPUTE#{disputeId}` | `METADATA` | Dispute metadata |
| `DISPUTE#{disputeId}` | `MSG#{timestamp}` | Dispute message |

GSI1 access patterns:

| GSI1PK | GSI1SK | Query |
|---|---|---|
| `EMAIL#{email}` | `USER#{userId}` | Look up user by email |
| `HOST#{hostId}` | `LISTING#{listingId}` | List host's listings |
| `SPOTTER#{userId}` | `BOOKING#{bookingId}` | List spotter's bookings |
| `BOOKING#{bookingId}` | `DISPUTE#{disputeId}` | Get disputes for booking |

---

## EventBridge Events

All events are published to the `spotzy-events` bus. See `backend/shared/types/events.ts` for full type definitions.

| Detail Type | Emitter |
|---|---|
| `booking.created` | booking-create Lambda |
| `booking.modified` | booking-modify Lambda |
| `booking.cancelled` | booking-cancel Lambda |
| `booking.completed` | EventBridge Scheduler |
| `dispute.created` | dispute-create Lambda |
| `dispute.escalated` | dispute-escalate Lambda |
| `listing.published` | listing-publish Lambda |
