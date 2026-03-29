# Spotzy — Claude Code Session Guide v2
## TDD Edition — Tests First, Implementation Second

---

## What changed from v1

Every domain session now follows TDD:
1. Claude Code writes the **test file first**
2. Tests are confirmed **failing (red)**
3. Claude Code writes the **implementation**
4. Tests must **pass (green)**

This means you get full test coverage as a natural byproduct of building, not as an afterthought. The sessions are slightly larger but you get two deliverables per session: tests + implementation.

---

## Session order

| # | File | What it builds | Phase |
|---|------|----------------|-------|
| 00 | `00_scaffold.md` | Project structure, shared types, CDK skeletons | Setup |
| 01 | `01_infrastructure.md` | All 5 CDK stacks (DynamoDB, S3, API GW, Cognito, EventBridge, CloudFront) | Infrastructure |
| 02 | `02_listings_tdd.md` | Unit tests + Listings Lambda (create, update, publish, search, get, AI validate) | Backend |
| 03 | `03_bookings_tdd.md` | Unit tests + Bookings Lambda (create, get, modify, cancel, availability) | Backend |
| 04 | `04_payments_tdd.md` | Unit tests + Payments Lambda (Stripe intent, webhook, payout, Connect) | Backend |
| 05 | `05_chat_notif_reviews_disputes_tdd.md` | Unit tests + Chat, Notifications, Reviews, Disputes | Backend |
| 06 | `06_users_preferences_tdd.md` | Unit tests + Users, Preferences, Cognito trigger | Backend |
| 07 | `07_frontend_scaffold_search_tdd.md` | Component tests + Next.js scaffold + Map search screen | Frontend |
| 08 | `08_frontend_listing_booking_tdd.md` | Component tests + Listing detail + Booking flow | Frontend |
| 09 | `09_frontend_dashboards_tdd.md` | Component tests + Host dashboard + Spotter dashboard | Frontend |
| 10 | `10_frontend_chat_disputes_auth_tdd.md` | Component tests + Chat + Dispute flow + Auth screens | Frontend |
| 11 | `11_api_integration_e2e_tests.md` | Integration tests + API tests + Playwright E2E + CI pipeline | Testing |

---

## Testing tools by layer

| Layer | Tool | Runs |
|---|---|---|
| Lambda unit tests | Jest + ts-jest | On every save (watch mode) |
| Frontend component tests | Vitest + React Testing Library + MSW | On every save |
| Lambda integration tests | Jest + DynamoDB Local (Docker) | On CI (push to main) |
| API tests | Jest/Axios against test environment | On CI after deploy-to-test |
| E2E tests | Playwright against staging | On CI before deploy-to-production |

---

## CI/CD pipeline gates

```
Pull Request
  └── Unit tests (Jest) ─────────────────────── ~30s
  └── Component tests (Vitest) ───────────────── ~45s
  └── CDK synth ──────────────────────────────── ~20s

Merge to main
  └── All PR checks
  └── Integration tests (DynamoDB Local) ─────── ~2min
  └── Deploy to test environment
  └── API tests ──────────────────────────────── ~3min

Release tag
  └── All above
  └── Deploy to staging
  └── E2E tests (Playwright) ─────────────────── ~8min
  └── Manual approval ──────────────────────────
  └── Deploy to production
```

---

## How to run tests locally

```bash
# Backend unit tests (watch mode during development)
cd backend && npm test -- --watch

# Backend unit tests with coverage report
cd backend && npm test -- --coverage

# Frontend component tests
cd frontend && npm run test

# Integration tests (requires Docker)
docker-compose -f docker-compose.test.yml up -d
cd backend && npm run test:integration
docker-compose -f docker-compose.test.yml down

# E2E tests (requires staging URL)
cd e2e && STAGING_URL=https://staging.spotzy.com npx playwright test

# E2E tests in headed mode (to watch the browser)
cd e2e && npx playwright test --headed
```

---

## Coverage targets

| Layer | Branches | Functions | Lines |
|---|---|---|---|
| Lambda (backend) | 80% | 90% | 90% |
| Frontend components | 75% | 85% | 85% |

Coverage is enforced in CI — builds fail if below thresholds.

---

## Environment variables

Same as v1 README. Key additions for testing:

```bash
# Test environment
TEST_API_URL=https://api-test.spotzy.com
TEST_HOST_PASSWORD=<from Secrets Manager>
TEST_SPOTTER_PASSWORD=<from Secrets Manager>
TEST_SPOTTER_2_PASSWORD=<from Secrets Manager>
STAGING_URL=https://staging.spotzy.com

# DynamoDB Local (integration tests)
DYNAMODB_ENDPOINT=http://localhost:8000
```

---

## What is NOT in these sessions (post-MVP)

- Smart lock integration (Seam / RemoteLock)
- Block Spotter bulk booking
- Spot Manager / Spot Pool
- Conversational search (NLP)
- Dynamic pricing
- MobiGIS overlay
- Mobile app

---

## Troubleshooting

**Tests fail with "Cannot find module 'ulid'"**
Run `npm install` in the `backend` directory. The scaffold creates `package.json` but doesn't install.

**Mapbox tests fail in CI with canvas errors**
The Mapbox mock in Session 07 handles this. Ensure `jest.mock('mapbox-gl', ...)` is in the test file.

**Stripe webhook tests fail signature verification**
Unit tests mock `stripe.webhooks.constructEvent`. If you're testing the actual webhook handler, use `stripe.webhooks.generateTestHeaderString` to create a valid test signature.

**DynamoDB Local connection refused**
Docker must be running before integration tests. Check with `docker ps`.

**Playwright tests flaky on CI**
The playwright config includes `retries: 2`. If a test fails consistently, check the uploaded artifact for screenshots and traces.
