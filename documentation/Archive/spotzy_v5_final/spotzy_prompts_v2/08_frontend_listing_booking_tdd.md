# Session 08 — Frontend: Listing Detail + Booking Flow (TDD)

## What this session does
Component tests first, then implementation for listing detail page and booking flow.

## Feed to Claude Code
This file only. MSW server from Session 07 is already set up.

---

## Component tests — ListingDetail

### Tests first: `__tests__/pages/listing.test.tsx`

**Rendering:**
- Shows spot address as heading
- Shows spot type label
- Shows price in correct format (€3.50/hr)
- Shows covered badge when `covered=true`
- Shows accessibility badge when `accessible=true`
- Shows host name and rating
- Shows description (collapsed if > 3 lines)

**Availability calendar:**
- Available dates shown in green
- Booked dates shown in navy
- Clicking an available date → selects as start or end of range (amber highlight)
- Clicking a booked date → no selection change

**Booking widget:**
- "Book this spot" button disabled when no dates selected
- "Book this spot" enabled when valid date range selected
- Vehicle dropdown shows user's registered vehicles
- Total price updates when dates change

**Not logged in:**
- "Sign in to book" shown instead of "Book this spot"
- Clicking → redirects to `/auth/login`

**Error states:**
- Listing not found (MSW returns 404) → "This spot is no longer available" message + search CTA

---

## Component tests — BookingFlow (3 steps)

### Tests first: `__tests__/pages/booking-flow.test.tsx`

**Step indicator:**
- Step 1 active → "Review" step highlighted in amber
- After clicking "Proceed to payment" → step 2 highlighted
- Step 3 shown after payment confirmation

**Step 1 — Review:**
- Shows spot summary (address, type, covered)
- Shows date range (passed from search/listing)
- Shows price breakdown: subtotal + 15% fee + total
- Shows cancellation policy
- "Proceed to payment" disabled until dates confirmed
- Date change → total price recalculates live

**Step 2 — Payment (mock Stripe):**
```typescript
jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: any) => children,
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useStripe: () => ({
    confirmPayment: jest.fn().mockResolvedValue({ paymentIntent: { status: 'succeeded' } }),
  }),
  useElements: () => ({}),
}));
```
- Stripe PaymentElement renders
- "Pay €X.XX" button shows exact amount
- On payment success → navigates to Step 3

**Step 3 — Confirmation:**
- Booking reference shown in monospace style
- "Get directions" button renders
- "Message host" button renders → correct href to `/chat/{bookingId}`
- "View booking" CTA navigates to `/dashboard/spotter`

**Error handling:**
- Payment failure → red error message shown below payment form, stays on Step 2
- Spot taken during booking → red banner "This spot was just taken"

---

## Component tests — hooks

### Tests first: `__tests__/hooks/useListing.test.ts`

```typescript
// Test useListing(id) SWR hook
// - Returns { listing, isLoading: true } on initial render
// - Returns { listing: data, isLoading: false } after fetch resolves
// - Returns { error, isLoading: false } on fetch error
```

### Tests first: `__tests__/hooks/useBookingFlow.test.ts`

```typescript
// Test useBookingFlow(listingId, initialDates)
// - Initial state: step=1, dates from initialDates prop
// - setDates() → price recalculated correctly
// - advanceStep() → step incremented
// - Cannot advance to step 3 without bookingId set
```

---

## Implementation (after all tests confirmed failing)

Build in order:

1. `hooks/useListing.ts` — SWR fetch hook
2. `hooks/useBookingFlow.ts` — booking state machine
3. `hooks/useAuth.ts` — Cognito auth state
4. `app/listing/[id]/page.tsx` — full listing detail page with ISR
5. `app/book/[id]/page.tsx` — 3-step booking flow with Stripe Elements
6. Stripe integration: `lib/stripe.ts` — `loadStripe`, payment confirmation helper
