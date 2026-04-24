# SPOTZY — Supervisor Agent Context

> **Purpose**: Give any Claude Code agent enough context to start working on any part of the Spotzy codebase immediately, without reading spec documents or scanning the repo. This file is the single source of truth for high-level architecture, entity model, conventions, and session dependency order.
>
> **When you need detail**: Each session prompt in `prompts/` is the implementation-level spec for its domain. Read the specific session prompt before implementing in that area. This file tells you WHICH prompt to read and what to expect.

---

## 1. What is Spotzy

Belgian P2P parking marketplace. Hosts list parking spots, Spotters book them. Spot Managers operate pools of bays with RC insurance. Block Spotters reserve bays in bulk for events/hotels. Three locales live from day one: `en`, `fr-BE`, `nl-BE`.

**Team**: Solo founder (Duke) + wife (management/marketing). No SaaS budget. Bootstrap.

---

## 2. Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 14+ App Router, TypeScript, Tailwind CSS | Hosted on S3 + CloudFront |
| API | API Gateway REST + WebSocket | Cognito JWT authorizer |
| Compute | Lambda, Node.js 20.x, TypeScript | One function per domain |
| Database | DynamoDB single table `spotzy-main` | Single-table design, all entities |
| Auth | Cognito User Pools | |
| Events | EventBridge, bus `spotzy-events` | Async workflows |
| Payments | Stripe Connect | Application fee model |
| Maps | Mapbox GL JS | |
| Storage | S3: `spotzy-media-uploads`, `spotzy-media-public`, `spotzy-media-disputes`, `spotzy-frontend`, `spotzy-logs` | |
| IaC | CDK v2 (TypeScript) | |
| i18n | next-intl + YAML files + Amazon Translate (UGC) | Claude API for static string translation |
| Region | `eu-west-1` (Ireland) | |

---

## 3. Project structure

```
spotzy/
├── infrastructure/              # CDK stacks
├── backend/
│   └── src/
│       ├── functions/           # One dir per Lambda
│       │   ├── listings/        # listing-create, listing-update, listing-get, listing-search, listing-publish, listing-translate
│       │   ├── bookings/        # booking-create, booking-get, booking-modify, booking-cancel, booking-quote, booking-confirmed
│       │   ├── payments/        # payment-intent, payment-webhook
│       │   ├── chat/            # chat-get, chat-send
│       │   ├── reviews/         # review-create
│       │   ├── disputes/        # dispute-create, dispute-message
│       │   ├── users/           # user-get, user-update, user-vat-status-update
│       │   ├── spot-manager/    # rc-submission-create, rc-review, rc-reminder, rc-suspend, pool-create, bay-manage
│       │   ├── block-spotter/   # block-request-create, block-match, block-confirm-plan, block-guest-add, block-auth, block-settle, block-cancel
│       │   ├── translate/       # translate-on-demand (read-time chat/review translation)
│       │   ├── agent/           # agent-mcp, agent-webhook-dispatch, agent-spending-reset
│       │   └── admin/           # admin-platform-fee-update, admin-rc-review
│       └── shared/
│           ├── db/              # DynamoDB client, key helpers
│           ├── pricing/         # tiered-pricing.ts, vat-constants.ts, validation.ts
│           ├── locales/         # constants.ts (SUPPORTED_LOCALES), format.ts
│           └── types/           # Shared interfaces, event types
├── frontend/
│   └── src/
│       ├── app/[locale]/        # next-intl dynamic locale segment
│       ├── locales/             # en/, fr-BE/, nl-BE/ YAML translation files + _glossary.yaml
│       ├── lib/                 # pricing.ts (frontend port), locale-resolution.ts, yaml-loader.ts
│       └── components/
├── frontend/scripts/            # i18n-translate.ts, i18n-lint.ts, lint-legal-docs.ts, i18n-translate-legal.ts
├── frontend/public/legal/       # Static legal docs: {doc}.{locale}.md
├── prompts/                     # Session prompts (implementation specs)
└── .github/workflows/           # CI: i18n.yml
```

---

## 4. DynamoDB entity model (single table: `spotzy-main`)

All entities share one table. PK/SK patterns below. GSI1 is used for reverse lookups.

### Core entities (Sessions 00–22)

```
USER#{userId}              PROFILE                    # name, email, stripeConnectAccountId, vatStatus, vatNumber, preferredLocale, spotManagerStatus
EMAIL#{email}              USER#{userId}              # GSI1 — email lookup
USER#{userId}              PREFS                      # notification preferences
USER#{userId}              LEGAL_ACCEPTANCE#{doc}#{v} # legal doc acceptance records

LISTING#{listingId}        METADATA                   # title, description, hostNetPricePerHourEur, dailyDiscountPct, weeklyDiscountPct, monthlyDiscountPct, hostVatStatusAtCreation, isPool, poolCapacity, *Translations, originalLocale
LISTING#{listingId}        AVAIL#{date}               # availability blocks
HOST#{hostId}              LISTING#{listingId}         # GSI1 — host's listings

BOOKING#{bookingId}        METADATA                   # listingId, spotterId, hostId, startTime, endTime, status, priceBreakdown, stripePaymentIntentId
SPOTTER#{userId}           BOOKING#{bookingId}         # GSI1 — spotter's bookings
LISTING#{listingId}        BOOKING#{bookingId}         # listing's bookings

REVIEW#{targetId}          REVIEW#{bookingId}
DISPUTE#{disputeId}        METADATA
DISPUTE#{disputeId}        MSG#{timestamp}
BOOKING#{bookingId}        DISPUTE#{disputeId}         # GSI1

CONFIG#PLATFORM_FEE        METADATA                   # singleShotPct (0.15), blockReservationPct (0.15), bounds [0,0.30]
CONFIG#VAT_RATES           METADATA                   # belgianStandardRate (0.21)
```

### Spot Manager entities (Session 26)

```
USER#{userId}              RCSUBMISSION#{submissionId}  # insurer, policyNumber, expiryDate, documentS3Key, status
RC_REVIEW_QUEUE            PENDING#{createdAt}#{id}     # admin review queue projection
RC_SOFT_LOCK#{submissionId} METADATA                    # admin claim lock (5min TTL)
USER#{userId}              RCREMINDER#{subId}#{type}    # 30d/7d expiry reminders
USER#{userId}              RCSUSPEND#{submissionId}     # suspension record

LISTING#{poolListingId}    METADATA                    # isPool=true, poolCapacity, blockReservationsOptedIn
LISTING#{poolListingId}    BAY#{bayId}                 # label, accessInstructions, *Translations
```

### Block Spotter entities (Session 27)

```
BLOCKREQ#{reqId}           METADATA                   # blockSpotterUserId, targetBayCount, windowStart, windowEnd, status, preferences, stripePaymentIntentId
USER#{userId}              BLOCKREQ#{reqId}            # reverse — Block Spotter dashboard

BLOCKREQ#{reqId}           BLOCKALLOC#{allocId}        # poolListingId, spotManagerUserId, contributedBayCount, riskShareMode, riskShareRate, priceBreakdown
LISTING#{poolListingId}    BLOCKALLOC#{allocId}        # reverse — Spot Manager portfolio

BLOCKREQ#{reqId}           BOOKING#{bookingId}         # grandchild — materialised lazily on guest add
```

### Agent integration entities (Session 21/21b)

```
API_KEY#{keyHash}          METADATA                   # userId, name, scopes, monthlySpendingLimit, currentMonthSpending
USER#{userId}              WEBHOOK#{webhookId}         # developer-owned webhook record
EVENT_SUB#{eventType}      WEBHOOK#{userId}#{id}       # reverse — dispatch-side fan-out index
```

### Localization entities (Session 29)

```
TRANSLATION_CACHE#{sha256} METADATA                   # sourceText, sourceLocale, targetLocale, translatedText, expiresAtTtl (DynamoDB TTL)
```

---

## 5. Pricing model (Session 28 + 28b)

**Model B (fee-exclusive)**. Host enters NET rate. System grosses up for Spotter.

### Tiered pricing

```
hostNetPricePerHourEur → base
dailyRate   = base × 24 × dailyDiscountPct    (50%|60%|70%, default 60%)
weeklyRate  = dailyRate × 7 × weeklyDiscountPct
monthlyRate = weeklyRate × 4 × monthlyDiscountPct
```

Tier selection: <24h → HOURLY, ≥24h → DAILY, ≥7d → WEEKLY, ≥28d → MONTHLY. Within-tier: `ceil(duration ÷ tierUnit) × tierRate`.

### Full breakdown (`computeFullPriceBreakdown`)

```
1. hostNetTotal = strictTierTotal(duration, tieredPricing)
2. hostVatRate = (VAT_REGISTERED ? 0.21 : 0)
3. hostVat = round2(hostNetTotal × hostVatRate)
4. hostGross = hostNetTotal + hostVat
5. platformFee = round2(hostGross × feePct / (1 - feePct))     ← gross-up formula
6. platformFeeVat = round2(platformFee × 0.21)                  ← Spotzy always VAT-registered
7. spotterGross = hostGross + platformFee + platformFeeVat       ← what the Spotter pays
```

**Invariant**: `spotterGross - platformFee - platformFeeVat = hostGross`

### Canonical example

€2/h exempt Host, 25h booking, 60% daily discount, 15% fee:
hostNet=57.60, hostVat=0, hostGross=57.60, fee=10.16, feeVat=2.13, **spotterGross=69.89**

### Block reservations

Two risk-share modes per pool: PERCENTAGE (30% of unfilled bay rate) or MIN_BAYS_FLOOR (pay for at least 55% of bays). Stripe Option C: €1 validation → void → single auth at T-7d for worst-case → capture at settlement.

---

## 6. VAT model (Session 28b)

- **Scenario 3 — mixed marketplace**, default `EXEMPT_FRANCHISE`
- `vatStatus`: `NONE` → `EXEMPT_FRANCHISE` (implicit on first listing) or `VAT_REGISTERED` (explicit via commitment gate or /account/vat-settings)
- Belgian VAT number format: `BE0` + 9 digits, Mod-97 checksum validation
- Rate: 21% standard, no reduced rates for parking
- `hostVatStatusAtCreation` snapshotted on LISTING at creation — immutable until listing re-edited
- `priceBreakdown` snapshotted on BOOKING/BLOCKALLOC at creation — settlement uses snapshot, never recomputes

---

## 7. Personas

| Persona | Registration path | Key capabilities |
|---|---|---|
| **Spotter** | Register → Spotter | Search, book, review, dispute |
| **Host** | Register → Spotter → list a spot → Host | Create listings, manage bookings, receive payouts |
| **Spot Manager** | Host → UC-SM00 commitment gate (RC insurance + VAT status + T&Cs) → Spot Manager | Pool listing creation, bay management, block reservation opt-in |
| **Block Spotter** | Register with company name + VAT number → Block Spotter | Bulk bay reservation, guest allocation via magic links |

Multi-role: a user can be Spotter + Host + Spot Manager + Block Spotter simultaneously.

---

## 8. Localization (Sessions 29 + 30)

- **Library**: next-intl with custom YAML loader
- **Locales**: `en` (source), `fr-BE`, `nl-BE` — all live day one
- **URL pattern**: `/{locale}/...` always present, bare URLs 308-redirect
- **Resolution**: URL prefix → user profile `preferredLocale` → cookie → Accept-Language → fallback `fr-BE`
- **Translation files**: `frontend/src/locales/{locale}/{namespace}.yaml`, 24 namespaces
- **Static strings**: Claude API (sonnet for UI, opus for legal docs) via `npm run i18n:translate`
- **UGC (listings, bays)**: Amazon Translate at write time, stored in `*Translations` maps on entity rows
- **UGC (chat, reviews)**: Amazon Translate at read time, cached in `TRANSLATION_CACHE#` rows (30-day TTL)
- **Backend rule**: Lambdas NEVER return human-readable text. Return `{error: ERROR_CODE, details: {...}}`. Frontend renders.
- **Email templates**: SES named templates, `{family}-{locale}` naming (30 families × 3 locales = 90)
- **Legal docs**: `frontend/public/legal/{doc}.{locale}.md`, LLM-translated, founder-reviewed
- **Linter**: `npm run lint:i18n` (8 checks), `npm run lint:legal-docs` (heading structure parity)
- **Git hook**: pre-push hook auto-translates new `en/` keys, opt-in via `npm run i18n:install-hooks`

---

## 9. Key scripts

```bash
# Translation
npm run i18n:translate                        # fill missing keys in fr-BE/nl-BE via Claude API
npm run i18n:translate -- --namespace=listings # specific namespace
npm run i18n:translate -- --dry-run            # preview without API calls
npm run i18n:retranslate                       # force re-translate all keys
npm run i18n:translate-legal -- --document=terms-of-service  # legal doc translation (opus model)

# Linting
npm run lint:i18n                              # validate all translation files
npm run lint:legal-docs                        # verify legal doc heading parity across locales

# Hooks
npm run i18n:install-hooks                     # install git pre-push hook
```

---

## 10. Session dependency graph

```
Sessions 00–22 (MVP)
  └─→ Session 26 (Spot Manager v2.x)
        └─→ Session 27 (Block Spotter v2.x)
              └─→ Session 28 (Tiered Pricing + Platform Fee)
                    └─→ Session 28b (Fee-Exclusive Pricing + VAT) ← corrects 28
  └─→ Session 21b (Agent Integration Supplement) ← supplements 21
  └─→ Session 29 (Localization Runtime) ← depends on 26, 27, 28
        └─→ Session 30 (Localization Workflow) ← depends on 29

Obsolete (do NOT run): Sessions 23, 24 — replaced by 26, 27
Deferred (v3+): Session 25 (Smart Lock)
```

### Session catalog

| Session | Domain | Key outputs |
|---|---|---|
| 00 | Scaffold | Folder structure, CDK skeletons, key patterns |
| 01 | Infrastructure | CDK stacks: API, Auth, DB, Storage, Events |
| 02 | Listings | listing-create, listing-update, listing-get, listing-search, listing-publish |
| 03 | Bookings | booking-create, booking-get, booking-modify, booking-cancel |
| 04 | Payments | payment-intent, payment-webhook, Stripe Connect |
| 05 | Chat/Reviews/Disputes | chat-send, chat-get, review-create, dispute-create |
| 06 | Users | user-get, user-update, preferences |
| 07–10 | Frontend | Search, listing detail, booking flow, dashboards, chat, auth |
| 11 | Testing | API tests, integration tests, E2E (Playwright), CI pipeline |
| 12 | Availability | Availability rules engine |
| 13–19 | Polish | Self-booking prevention, CTA flows, booking cards, host registration, identity |
| 20 | Backoffice | Admin tools (UC-BO01/02/03) |
| 21+21b | Agent | MCP server, API keys, webhooks, EVENT_SUB# index |
| 22 | GDPR | Data export, deletion, anonymisation |
| 26 | Spot Manager | RC insurance gate, pool listings, bay management |
| 27 | Block Spotter | Block reservations, magic links, risk-share, settlement |
| 28+28b | Pricing/VAT | Tiered pricing, platform fee, fee-exclusive model, Belgian VAT |
| 29 | Localization runtime | next-intl, YAML loader, listing-translate Lambda, SES templates |
| 30 | Localization workflow | Claude API translation script, linters, git hooks |

---

## 11. Conventions

- **TDD everywhere**: tests first (red), implement (green), refactor. All session prompts follow this pattern.
- **Error responses**: `{ error: "SCREAMING_SNAKE_CASE", details: { ... } }`. Never human-readable text from backend.
- **Pricing field name**: `hostNetPricePerHourEur` (NOT `pricePerHourEur` — legacy name rejected with `LEGACY_PRICING_FIELD_REJECTED`).
- **Snapshots are immutable**: `priceBreakdown` on BOOKING#, `hostVatStatusAtCreation` on LISTING#, `riskShareMode`/`riskShareRate` on BLOCKALLOC# — once written, never recomputed.
- **TransactWriteItems for multi-entity writes**: any operation touching 2+ entities uses DynamoDB transactions.
- **EventBridge for async**: `listing.translation_required`, `booking.completed`, `block.auth_required`, etc.
- **Stripe Connect**: application fee model. Host receives `hostGrossTotalEur` via Stripe transfer. Spotzy retains `platformFeeEur + platformFeeVatEur`.
- **YAML for translations**: never JSON. Quotes required around values with `{ } : # [ ]`.
- **Glossary enforcement**: `_glossary.yaml` defines term translations. "Spotzy", "Spotter", "Block Spotter", "Bay" → never translate. "Spot Pool" → "Pool de Stationnement" (fr-BE) / "Parkeerpool" (nl-BE).

---

## 12. Spec documents (in outputs/)

| Document | Purpose |
|---|---|
| `spotzy_functional_specs_v22.docx` | 117-page functional spec, 56+ UCs, canonical |
| `spotzy_architecture_v10.docx` | Architecture spec, 70 routes, entity model |
| `spotzy_uiux_v10.docx` | UI/UX spec, 64 UC screen specs |
| `spotzy_localization_v2.docx` | Localization spec, 63 pages, solo-founder workflow |
| `28b_localization_addendum.md` | Localization changes from pricing/VAT supplement |

---

## 13. Quick reference: what to read before working on...

| Task | Read first |
|---|---|
| Listing CRUD | Session 02, then 28b (pricing field rename) |
| Booking flow | Session 03 + 04, then 28b (priceBreakdown) |
| Spot Manager / pools / bays | Session 26 |
| Block reservations | Session 27 (depends on 26) |
| Pricing / fees / VAT | Session 28b (supersedes parts of 28) |
| Localization runtime | Session 29 |
| Translation tooling | Session 30 |
| Agent API / MCP / webhooks | Session 21 + 21b |
| GDPR / data deletion | Session 22 |
| Backoffice admin tools | Session 20 |
| Frontend scaffold / search | Session 07 |
| Frontend booking flow | Session 08 |
| Frontend dashboards | Session 09 |
| CI / testing | Session 11 |
| Infrastructure / CDK | Session 01 |
