# Session 00 — Project Scaffold

## What this session does
Generates the full folder structure, CDK stack skeletons, shared types, and configuration files for the entire Spotzy project. No business logic yet — structure only.

## Prompt

You are bootstrapping a new AWS serverless project called Spotzy — a P2P parking marketplace. Generate the complete project scaffold based on the following architecture specification. Do not implement business logic yet. Create folder structures, empty files with correct exports, and skeleton CDK stacks only.

---

### Stack

- **Frontend**: Next.js 14+ (App Router), TypeScript, Tailwind CSS, hosted on S3 + CloudFront
- **API**: AWS API Gateway REST + WebSocket, Cognito JWT authorizer
- **Compute**: AWS Lambda, Node.js 20.x, TypeScript, one function per domain
- **Database**: DynamoDB single table named `spotzy-main`
- **Storage**: S3 buckets: `spotzy-media-uploads`, `spotzy-media-public`, `spotzy-media-disputes`, `spotzy-frontend`, `spotzy-logs`
- **Auth**: Amazon Cognito User Pools
- **Events**: Amazon EventBridge (bus: `spotzy-events`)
- **Notifications**: Amazon SNS (SMS) + Amazon SES (email)
- **Payments**: Stripe Connect
- **Maps**: Mapbox GL JS
- **IaC**: AWS CDK v2 (TypeScript)

---

### Folder structure to generate

```
spotzy/
├── infrastructure/           # AWS CDK
│   ├── bin/spotzy.ts
│   ├── lib/
│   │   ├── frontend-stack.ts
│   │   ├── api-stack.ts
│   │   ├── data-stack.ts
│   │   ├── integration-stack.ts
│   │   └── observability-stack.ts
│   ├── cdk.json
│   └── package.json
├── backend/
│   ├── shared/
│   │   ├── types/            # Shared TypeScript interfaces
│   │   │   ├── user.ts
│   │   │   ├── listing.ts
│   │   │   ├── booking.ts
│   │   │   ├── review.ts
│   │   │   ├── dispute.ts
│   │   │   └── events.ts
│   │   ├── db/
│   │   │   ├── client.ts     # DynamoDB DocumentClient singleton
│   │   │   └── keys.ts       # PK/SK builder functions
│   │   └── utils/
│   │       ├── response.ts   # Standard Lambda response helpers
│   │       └── auth.ts       # JWT claim extractor
│   ├── functions/
│   │   ├── listings/
│   │   │   ├── create/index.ts
│   │   │   ├── update/index.ts
│   │   │   ├── publish/index.ts
│   │   │   ├── search/index.ts
│   │   │   ├── get/index.ts
│   │   │   └── ai-validate/index.ts
│   │   ├── bookings/
│   │   │   ├── create/index.ts
│   │   │   ├── get/index.ts
│   │   │   ├── modify/index.ts
│   │   │   └── cancel/index.ts
│   │   ├── payments/
│   │   │   ├── intent/index.ts
│   │   │   ├── webhook/index.ts
│   │   │   └── payout-trigger/index.ts
│   │   ├── chat/
│   │   │   ├── connect/index.ts
│   │   │   ├── disconnect/index.ts
│   │   │   ├── send/index.ts
│   │   │   └── get/index.ts
│   │   ├── notifications/
│   │   │   ├── sms/index.ts
│   │   │   └── email/index.ts
│   │   ├── reviews/
│   │   │   ├── create/index.ts
│   │   │   └── aggregate/index.ts
│   │   ├── disputes/
│   │   │   ├── create/index.ts
│   │   │   ├── message/index.ts
│   │   │   └── escalate/index.ts
│   │   ├── users/
│   │   │   ├── get/index.ts
│   │   │   ├── update/index.ts
│   │   │   └── payout-setup/index.ts
│   │   ├── availability/
│   │   │   ├── block/index.ts
│   │   │   └── release/index.ts
│   │   └── preferences/
│   │       └── learn/index.ts
│   └── package.json
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx          # Home / marketing (SSG)
│   │   ├── search/page.tsx   # Map search (CSR)
│   │   ├── listing/[id]/page.tsx  # Listing detail (ISR)
│   │   ├── book/[id]/page.tsx     # Booking flow (CSR)
│   │   ├── dashboard/
│   │   │   ├── host/page.tsx
│   │   │   └── guest/page.tsx
│   │   ├── chat/[bookingId]/page.tsx
│   │   └── dispute/[bookingId]/page.tsx
│   ├── components/           # Empty placeholder files
│   ├── lib/
│   │   ├── api.ts            # API client with auth headers
│   │   ├── mapbox.ts         # Mapbox config
│   │   └── stripe.ts         # Stripe client
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   └── package.json
├── .github/
│   └── workflows/
│       └── deploy.yml        # CI/CD pipeline
└── README.md
```

---

### DynamoDB single-table key patterns to include in `backend/shared/db/keys.ts`

```
USER#{userId}           | PROFILE
EMAIL#{email}           | USER#{userId}           (GSI1)
LISTING#{listingId}     | METADATA
HOST#{hostId}           | LISTING#{listingId}     (GSI1)
LISTING#{listingId}     | AVAIL#{date}
BOOKING#{bookingId}     | METADATA
SPOTTER#{userId}        | BOOKING#{bookingId}     (GSI1)
LISTING#{listingId}     | BOOKING#{bookingId}
CHAT#{bookingId}        | MSG#{timestamp}#{messageId}
REVIEW#{targetId}       | REVIEW#{bookingId}
DISPUTE#{disputeId}     | METADATA
BOOKING#{bookingId}     | DISPUTE#{disputeId}     (GSI1)
DISPUTE#{disputeId}     | MSG#{timestamp}
USER#{userId}           | PREFS
```

---

### EventBridge events to define in `backend/shared/types/events.ts`

```
booking.created     → emitted by booking-create
booking.modified    → emitted by booking-modify
booking.cancelled   → emitted by booking-cancel
booking.completed   → emitted by EventBridge Scheduler
dispute.created     → emitted by dispute-create
dispute.escalated   → emitted by dispute-escalate
listing.published   → emitted by listing-publish
```

---

### API routes to stub in the CDK ApiStack

```
POST   /api/v1/listings                → listing-create       (auth required)
GET    /api/v1/listings/search         → listing-search       (public)
GET    /api/v1/listings/{id}           → listing-get          (public)
PUT    /api/v1/listings/{id}           → listing-update       (auth required)
POST   /api/v1/listings/{id}/publish   → listing-publish      (auth required)
POST   /api/v1/listings/{id}/photo-url → listing-photo-url    (auth required)
POST   /api/v1/bookings                → booking-create       (auth required)
GET    /api/v1/bookings/{id}           → booking-get          (auth required)
PUT    /api/v1/bookings/{id}/modify    → booking-modify       (auth required)
POST   /api/v1/bookings/{id}/cancel    → booking-cancel       (auth required)
POST   /api/v1/payments/intent         → payment-intent       (auth required)
POST   /api/v1/payments/webhook        → payment-webhook      (Stripe sig — no Cognito auth)
GET    /api/v1/chat/{bookingId}        → chat-get             (auth required)
POST   /api/v1/chat/{bookingId}        → chat-send            (auth required)
POST   /api/v1/reviews                 → review-create        (auth required)
POST   /api/v1/disputes                → dispute-create       (auth required)
POST   /api/v1/disputes/{id}/message   → dispute-message      (auth required)
GET    /api/v1/users/me                → user-get             (auth required)
PUT    /api/v1/users/me                → user-update          (auth required)
POST   /api/v1/users/me/payout         → payout-setup         (auth required)
```

WebSocket routes: `$connect`, `$disconnect`, `sendMessage`

---

### Instructions

1. Generate all files and folders listed above.
2. Each Lambda `index.ts` should export a typed handler skeleton with a `TODO` comment for business logic.
3. The shared `response.ts` should export `ok(body)`, `created(body)`, `badRequest(message)`, `unauthorized()`, `notFound()`, `conflict(message)`, `internalError()` helpers.
4. The shared `keys.ts` should export builder functions for every key pattern above.
5. CDK stacks should be skeletons — resource definitions with correct names, no Lambda code bundling yet.
6. Include a `README.md` with project structure overview and local dev setup instructions.
7. Use TypeScript strict mode throughout.
8. Do not install packages — only generate `package.json` files with correct dependencies listed.
