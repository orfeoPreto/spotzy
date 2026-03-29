# Session 10 — Frontend: Chat, Disputes & Auth (TDD)

## What this session does
Component tests first, then implementation for chat, dispute flow, and auth screens.

## Feed to Claude Code
This file only.

---

## Component tests — Chat screen

### Tests first: `__tests__/pages/chat.test.tsx`

**Rendering:**
- Booking context banner renders at top with address and booking reference
- Empty state shown when no messages

**Message bubbles:**
- Own messages right-aligned with navy background
- Other party's messages left-aligned with mist background
- Timestamps shown correctly
- IMAGE message → thumbnail rendered, not raw URL

**WebSocket (mock):**
```typescript
// Mock WebSocket globally
global.WebSocket = jest.fn().mockImplementation(() => ({
  send: jest.fn(),
  close: jest.fn(),
  readyState: WebSocket.OPEN,
  onmessage: null,
  onerror: null,
  onclose: null,
}));
```
- New message arrives via `onmessage` → appears in message list without page reload
- Input submit → `ws.send` called with correct payload

**Emoji stripping:**
- User types "Great! 😀" → message sent as "Great! " (emoji removed)
- Message stored and displayed without emoji

**Image upload:**
- Attachment button click → file input triggered
- File selected → thumbnail preview in input area
- Confirm send → pre-signed URL fetched, file uploaded, message sent with imageUrl

---

## Component tests — Dispute flow

### Tests first: `__tests__/pages/dispute.test.tsx`

**Rendering:**
- Navy-tinted background visible (support mode styling)
- "Spotzy Support" header with shield icon
- Initial AI message auto-rendered on page load

**Quick reply chips:**
- 4 chips render below initial AI message
- Clicking a chip → pre-fills text input with that category
- After sending first message → chips disappear

**Photo upload (dispute evidence):**
- "Add photos" button appears in chat when AI requests evidence
- Selecting photos → inline thumbnail preview
- Photos attached → count shown in summary

**Summary card:**
- AI renders SUMMARY contentType card
- Card shows issue category, description, photo count
- "Confirm and submit" button inside the card
- On confirm → `POST /api/v1/disputes` called

**Escalation:**
- Response with `status=ESCALATED` → "Transferring to agent" spinner shown
- Then "Agent connected" message appears
- Reference number shown in monospace badge

---

## Component tests — Auth screens

### Tests first: `__tests__/pages/auth.test.tsx`

**Login:**
- Email and password inputs render
- "Sign in" button disabled when fields empty
- Invalid credentials (MSW returns 401) → error message shown
- Successful login → redirects to dashboard (mock router)
- "Forgot password?" link renders

**Registration — Step 1:**
- 3 role cards render
- "Spot Manager" card has "Coming soon" label and is disabled
- Clicking Host card → selected state (amber border)
- "Continue" disabled until a role selected

**Registration — Step 2:**
- All fields render
- Password and confirm password must match → "Passwords don't match" error if not
- Weak password → error message
- Successful submit → advances to Step 3

**Registration — Step 3 OTP:**
- 6 individual input boxes render
- Entering a digit → auto-focuses next box
- Backspace → focuses previous box
- Entering all 6 digits → "Verify" button activates
- Resend countdown: starts at 60, counts down, "Resend code" appears at 0

**Forgot password:**
- Email input + submit → success message shown
- Invalid email format → inline error

---

## Implementation (after all tests confirmed failing)

Build in order:

1. `hooks/useChat.ts` — WebSocket connection management
2. `app/chat/[bookingId]/page.tsx`
3. `app/dispute/[bookingId]/page.tsx`
4. `app/auth/login/page.tsx`
5. `app/auth/register/page.tsx`
6. `app/auth/forgot-password/page.tsx`
7. `components/ChatBubble.tsx`
8. `components/Navigation.tsx` — top nav (desktop) + bottom tabs (mobile)
