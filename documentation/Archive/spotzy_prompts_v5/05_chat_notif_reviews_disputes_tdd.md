# Session 05 — Chat, Notifications, Reviews & Disputes (TDD)

## What this session does
Tests first, then implementation for chat, notifications, reviews and disputes.

## Feed to Claude Code
This file only.

---

## CHAT

### Tests first: `__tests__/chat/send.test.ts`

**Happy path:**
- Valid message from guest to host → stored in DynamoDB, pushed to host's WebSocket connection, 201 returned
- Valid message from host to guest → stored, pushed to guest's connection
- IMAGE message with valid `imageUrl` → stored with imageUrl field

**Content rules:**
- TEXT message over 2000 chars → 400 `MESSAGE_TOO_LONG`
- IMAGE message without `imageUrl` → 400
- Emoji characters in TEXT message → stripped silently before storage

**WebSocket delivery:**
- Active connection found → `PostToConnectionCommand` called once with serialised message
- Multiple active connections for recipient → pushed to all of them
- Stale connection (GoneException from API Gateway) → connection record deleted from DynamoDB, no error returned
- No active connection for recipient → message stored but no push (async delivery — not an error)

**Auth / booking check:**
- No confirmed booking between sender and recipient → 403 `NO_ACTIVE_BOOKING`
- Missing auth → 401

**DynamoDB write:**
- PK=`CHAT#{bookingId}`, SK starts with `MSG#`
- TTL = 90 days from now (in Unix seconds)
- `read=false` on write

### Tests first: `__tests__/chat/get.test.ts`

- Returns messages sorted ascending by SK
- Requester is guest or host → 200
- Unrelated user → 403
- No messages yet → `{ messages: [], bookingId }`

### Implementation: chat functions

Implement `chat-send`, `chat-get`, `chat-connect`, `chat-disconnect` per test requirements.

---

## NOTIFICATIONS

### Tests first: `__tests__/notifications/sms.test.ts`

**Template rendering:**
- `booking.created` event → SMS to host includes spot address, guest name, dates, amount
- `booking.cancelled` event → SMS sent to BOTH host AND guest (two SNS publishes)
- `booking.modified` event → SMS to host only
- `dispute.created` event → SMS to host with 24h response deadline notice

**SNS:**
- `PublishCommand` called with correct `PhoneNumber` (fetched from DynamoDB user record)
- `Message` is under 160 characters (SMS limit — truncate gracefully if needed)

**Missing phone:**
- User has no phone number → skip SMS, log warning (do NOT throw — notification failure must not break booking flow)

### Tests first: `__tests__/notifications/email.test.ts`

**Template rendering:**
- `booking.created` → email to host with subject containing spot address, HTML body with booking summary
- `booking.completed` → email to BOTH parties with rating CTA link `spotzy.com/review/{bookingId}`
- `booking.cancelled` → subject contains "cancelled", body shows refund amount

**SES:**
- `SendEmailCommand` called with correct `Destination`, `Source: noreply@spotzy.com`
- HTML body is valid (no unclosed tags — use a simple string template, not a library)

**Missing email:**
- User has no email → skip, log warning

### Implementation: `functions/notifications/sms/index.ts` and `email/index.ts`

---

## REVIEWS

### Tests first: `__tests__/reviews/create.test.ts`

**Happy path — guest rating host:**
- Valid 4-section rating → stored, host's avgRating updated, 201 returned
- Minimum 2 sections rated → accepted
- Optional description stored when provided

**Happy path — host rating guest:**
- Valid 3-section rating → stored
- Minimum 1 section rated → accepted

**Validation:**
- Rating value 0 → 400 `INVALID_RATING` (must be 1–5)
- Rating value 6 → 400
- Rating value 3.5 (non-integer) → 400
- Guest tries to rate using host sections (SAFETY_SECURITY etc.) → 400 `INVALID_SECTION_FOR_ROLE`
- Host tries to rate using guest sections → 400
- Description over 500 chars → 400

**Business rules:**
- Booking not COMPLETED → 400 `BOOKING_NOT_COMPLETED`
- Review already submitted by this user for this booking → 409 `ALREADY_REVIEWED`
- Submitted more than 7 days after `completedAt` → 400 `REVIEW_WINDOW_EXPIRED`

**Visibility:**
- Both parties have reviewed → `published=true` on both reviews
- Only one party has reviewed → `published=false` on submitted review

**`review-aggregate` helper — unit test separately:**
- 3 reviews with SAFETY_SECURITY scores [4, 5, 3] → avg = 4.0
- 0 reviews → avgRating = null
- New review added → running average recalculated correctly

### Implementation: `functions/reviews/create/index.ts` and `aggregate/index.ts`

---

## DISPUTES

### Tests first: `__tests__/disputes/create.test.ts`

**Happy path:**
- Valid dispute → stored with status=OPEN, reference number returned (first 8 chars of disputeId uppercase)
- EventBridge `dispute.created` emitted
- Initial description stored as first dispute message record

**Business rules:**
- Booking is ACTIVE → allowed
- Booking completed within 48h → allowed
- Booking completed more than 48h ago → 400 `DISPUTE_WINDOW_EXPIRED`
- Open dispute already exists for this booking → 409 `DISPUTE_ALREADY_OPEN`
- Requester is neither guest nor host → 403

### Tests first: `__tests__/disputes/message.test.ts`

**Happy path:**
- Guest or host sends message → stored, 201 returned
- Platform agent (Cognito group AGENT) sends message → stored

**Escalation trigger:**
- Message contains "speak to human" → `requiresEscalation=true` set on dispute
- Message contains "refund" + "damage" → `requiresEscalation=true`

**Auth:**
- Unrelated user → 403

### Tests first: `__tests__/disputes/escalate.test.ts`

**Happy path:**
- Dispute with `requiresEscalation=true` → status updated to ESCALATED, `escalatedAt` set
- EventBridge `dispute.escalated` emitted
- `assignedToAgentQueue=true` stored

**Idempotency:**
- Already ESCALATED dispute → no-op, no duplicate event emitted

### Implementation: dispute functions

---

## AI DISPUTE CHAT — helper tests: `__tests__/disputes/ai-triage.test.ts`

Test the `classifyDisputeMessage(message: string)` helper function:

| Input | Expected output |
|---|---|
| "my car was scratched" | `{ category: 'DAMAGE', requiresEscalation: true }` |
| "I couldn't access the spot" | `{ category: 'ACCESS_PROBLEM', requiresEscalation: false }` |
| "I want to speak to a human" | `{ category: 'ESCALATION_REQUEST', requiresEscalation: true }` |
| "the spot was dirty" | `{ category: 'CONDITION_ISSUE', requiresEscalation: false }` |
| "there was a safety issue" | `{ category: 'SAFETY', requiresEscalation: true }` |
| "general complaint text" | `{ category: 'OTHER', requiresEscalation: false }` |

Implement this as a pure function (no AWS calls) — easy to test and reuse.
