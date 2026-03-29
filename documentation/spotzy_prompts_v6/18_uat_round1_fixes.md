# Session 18 — UAT Round 1 Fixes

## Source: Issue-tracker-spotzy.xlsx — 33 issues
All fixes confirmed against functional specs v6, architecture v5, UI/UX v5.

---

## GROUP A — Booking Status & Lifecycle (#01 #02 #12 #13)

### A1 — booking-status-transition Lambda (NEW)

**Tests first: `__tests__/bookings/status-transition.test.ts`**
```typescript
test('transitions CONFIRMED → ACTIVE at start time', async () => {
  const booking = buildBooking({ status: 'CONFIRMED', startTime: now() });
  const result = await handler(buildEvent({ bookingId: booking.bookingId, targetStatus: 'ACTIVE' }));
  expect(result.statusCode).toBe(200);
  expect(mockDynamo.update).toHaveBeenCalledWith(expect.objectContaining({
    ExpressionAttributeValues: expect.objectContaining({ ':s': 'ACTIVE' })
  }));
});

test('transitions ACTIVE → COMPLETED at end time, emits booking.completed', async () => {
  const booking = buildBooking({ status: 'ACTIVE', endTime: now() });
  await handler(buildEvent({ bookingId: booking.bookingId, targetStatus: 'COMPLETED' }));
  expect(mockEventBridge.putEvents).toHaveBeenCalledWith(
    expect.objectContaining({ Entries: expect.arrayContaining([
      expect.objectContaining({ DetailType: 'booking.completed' })
    ])})
  );
});

test('idempotent — already at target status returns 200 without update', async () => {
  const booking = buildBooking({ status: 'ACTIVE' });
  await handler(buildEvent({ bookingId: booking.bookingId, targetStatus: 'ACTIVE' }));
  expect(mockDynamo.update).not.toHaveBeenCalled();
});
```

**Implementation: `functions/bookings/status-transition/index.ts`**
- Called by EventBridge Scheduler at booking.startTime (→ ACTIVE) and booking.endTime (→ COMPLETED)
- Fetch booking, check current status, update if not already at target
- On COMPLETED: emit booking.completed event → triggers payout-trigger, review prompts

**CDK: create Scheduler rules in booking-create Lambda on booking confirmation:**
```typescript
// At booking.startTime → ACTIVE
await scheduler.createSchedule({
  Name: `booking-active-${bookingId}`,
  ScheduleExpression: `at(${booking.startTime})`,
  Target: { Arn: statusTransitionLambdaArn, Input: JSON.stringify({ bookingId, targetStatus: 'ACTIVE' }) },
  FlexibleTimeWindow: { Mode: 'OFF' },
});
// At booking.endTime → COMPLETED
await scheduler.createSchedule({
  Name: `booking-completed-${bookingId}`,
  ScheduleExpression: `at(${booking.endTime})`,
  Target: { Arn: statusTransitionLambdaArn, Input: JSON.stringify({ bookingId, targetStatus: 'COMPLETED' }) },
  FlexibleTimeWindow: { Mode: 'OFF' },
});
```
Delete both schedules in booking-cancel Lambda.

### A2 — BookingCard component — status display (#01 #02)

**Tests:**
```typescript
test.each([
  ['CONFIRMED', 'Confirmed', 'bg-\\[#006B3C\\]'],
  ['ACTIVE',    'Active',    'bg-\\[#059669\\]'],
  ['COMPLETED', 'Completed', 'bg-\\[#9CA3AF\\]'],
  ['CANCELLED', 'Cancelled', 'bg-\\[#DC2626\\]'],
])('status %s shows badge "%s"', (status, label, bgClass) => {
  render(<BookingCard booking={{ ...mockBooking, status }} />);
  const badge = screen.getByTestId('status-badge');
  expect(badge).toHaveTextContent(label);
  expect(badge).toHaveClass(bgClass);
});
```

### A3 — Modify booking — start/end time rules (#12 #13)

**Tests:**
```typescript
test('ACTIVE booking: start time input is disabled', () => {
  render(<ModifyBookingPage booking={{ ...mockBooking, status: 'ACTIVE' }} />);
  expect(screen.getByLabelText(/start time/i)).toBeDisabled();
  expect(screen.getByLabelText(/start time/i)).toHaveClass('cursor-not-allowed');
});

test('ACTIVE booking: end time input is enabled', () => {
  render(<ModifyBookingPage booking={{ ...mockBooking, status: 'ACTIVE' }} />);
  expect(screen.getByLabelText(/end time/i)).not.toBeDisabled();
});

test('ACTIVE booking: end time change shows "No refund applies" notice', async () => {
  render(<ModifyBookingPage booking={{ ...mockBooking, status: 'ACTIVE' }} />);
  fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: '...' } });
  await waitFor(() => expect(screen.getByTestId('no-refund-notice')).toBeInTheDocument());
});
```

---

## GROUP B — Cancellation/Refund Policy (#18 #19 #20 #21)

### B1 — booking-cancel Lambda — policy enforcement

**Tests:**
```typescript
test('#19 ACTIVE booking: returns 409 BOOKING_ALREADY_ACTIVE', async () => {
  const booking = buildBooking({ status: 'ACTIVE' });
  const result = await handler(mockAuthEvent(booking));
  expect(result.statusCode).toBe(409);
  expect(JSON.parse(result.body).error).toBe('BOOKING_ALREADY_ACTIVE');
});

test('#20 <12h before start: cancels with no refund', async () => {
  const booking = buildBooking({ status: 'CONFIRMED', startTime: addHours(now(), 6) });
  await handler(mockAuthEvent(booking));
  expect(mockStripe.refunds.create).not.toHaveBeenCalled();
  expect(mockDynamo.update).toHaveBeenCalledWith(expect.objectContaining({
    ExpressionAttributeValues: expect.objectContaining({ ':s': 'CANCELLED' })
  }));
});

test('#21 12–24h before start: cancels with 50% refund', async () => {
  const booking = buildBooking({ status: 'CONFIRMED', startTime: addHours(now(), 18), totalPrice: 100 });
  await handler(mockAuthEvent(booking));
  expect(mockStripe.refunds.create).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 5000 }) // 50% of €100 = €50 = 5000 cents
  );
});

test('>24h before start: cancels with full refund', async () => {
  const booking = buildBooking({ status: 'CONFIRMED', startTime: addHours(now(), 48), totalPrice: 100 });
  await handler(mockAuthEvent(booking));
  expect(mockStripe.refunds.create).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 10000 }) // 100% = €100 = 10000 cents
  );
});
```

**Policy implementation in `functions/bookings/cancel/index.ts`:**
```typescript
const now = Date.now();
const startTime = new Date(booking.startTime).getTime();
const hoursUntilStart = (startTime - now) / (1000 * 60 * 60);

if (booking.status === 'ACTIVE') {
  return { statusCode: 409, body: JSON.stringify({ error: 'BOOKING_ALREADY_ACTIVE' }) };
}

let refundPercent = 0;
if (hoursUntilStart > 24) refundPercent = 100;
else if (hoursUntilStart > 12) refundPercent = 50;
// else < 12h: refundPercent stays 0

if (refundPercent > 0) {
  await stripe.refunds.create({
    payment_intent: booking.stripePaymentIntentId,
    amount: Math.round(booking.totalPriceInCents * refundPercent / 100),
  });
}
```

### B2 — CancelModal — show refund amount before confirm

**Tests:**
```typescript
test('modal shows correct refund amount based on timing', async () => {
  // >24h → full refund
  render(<CancelModal booking={{ ...mockBooking, totalPrice: 40, startTime: addHours(now(), 48) }} />);
  await waitFor(() => expect(screen.getByTestId('refund-amount')).toHaveTextContent('€40.00'));
});

test('modal shows zero refund when <12h before start', async () => {
  render(<CancelModal booking={{ ...mockBooking, totalPrice: 40, startTime: addHours(now(), 6) }} />);
  await waitFor(() => expect(screen.getByTestId('refund-amount')).toHaveTextContent('€0.00'));
});

test('ACTIVE booking: cancel CTA not shown', () => {
  render(<BookingCard booking={{ ...mockBooking, status: 'ACTIVE' }} />);
  expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
});
```

---

## GROUP C — Listing Card Content (#15 #28 #29 #30)

### C1 — spotTypeDisplay utility

**Tests:**
```typescript
import { spotTypeDisplay } from '@/lib/spotTypeDisplay';

test.each([
  ['COVERED_GARAGE', 'Covered garage'],
  ['CARPORT',        'Carport'],
  ['DRIVEWAY',       'Driveway'],
  ['OPEN_SPACE',     'Open space'],
  ['unknown',        'Unknown'],
])('maps %s → %s', (input, expected) => {
  expect(spotTypeDisplay(input)).toBe(expected);
});
```

**Implementation: `lib/spotTypeDisplay.ts`**
```typescript
const SPOT_TYPE_LABELS: Record<string, string> = {
  COVERED_GARAGE: 'Covered garage',
  CARPORT: 'Carport',
  DRIVEWAY: 'Driveway',
  OPEN_SPACE: 'Open space',
};
export const spotTypeDisplay = (raw: string): string =>
  SPOT_TYPE_LABELS[raw] ?? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase().replace(/_/g, ' ');
```

Apply `spotTypeDisplay()` everywhere a spot type is rendered: ListingCard, ListingDetailPage, HostListingCard, BookingCard, PublicProfilePage.

### C2 — ListingCard — spot type, EV badge, line breaks (#28 #29 #30)

**Tests:**
```typescript
test('#28 spot type shown as human-readable label', () => {
  render(<ListingCard listing={{ ...mockListing, spotType: 'OPEN_SPACE' }} />);
  expect(screen.getByTestId('spot-type')).toHaveTextContent('Open space');
  expect(screen.queryByText('OPEN_SPACE')).not.toBeInTheDocument();
});

test('#29 EV badge shown when evCharging=true', () => {
  render(<ListingCard listing={{ ...mockListing, evCharging: true }} />);
  expect(screen.getByTestId('ev-badge')).toBeInTheDocument();
});

test('#29 EV badge not shown when evCharging=false', () => {
  render(<ListingCard listing={{ ...mockListing, evCharging: false }} />);
  expect(screen.queryByTestId('ev-badge')).not.toBeInTheDocument();
});

test('#30 each info row has separate vertical spacing', () => {
  render(<ListingCard listing={mockListing} />);
  const infoContainer = screen.getByTestId('listing-info');
  expect(infoContainer).toHaveClass('flex', 'flex-col', 'gap-2');
});
```

---

## GROUP D — Listing Management (#22 #23 #24)

### D1 — EV charging toggle in listing wizard (#22)

**Tests:**
```typescript
test('#22 EV charging toggle present in Step 2', () => {
  render(<ListingWizardStep2 />);
  expect(screen.getByTestId('ev-charging-toggle')).toBeInTheDocument();
});

test('selecting Yes shows Park green Zap confirmation icon', async () => {
  render(<ListingWizardStep2 />);
  fireEvent.click(screen.getByRole('button', { name: /yes/i }));
  await waitFor(() => expect(screen.getByTestId('ev-confirmed-icon')).toBeInTheDocument());
});
```

### D2 — Host listing full editing (#23 #24)

**Tests:**
```typescript
test('#23 host listing card has Edit button that opens full editor', () => {
  render(<HostListingCard listing={mockListing} />);
  expect(screen.getByRole('link', { name: /edit listing/i }))
    .toHaveAttribute('href', `/listings/${mockListing.listingId}/edit`);
});

test('#24 host listing card has View listing link', () => {
  render(<HostListingCard listing={mockListing} />);
  expect(screen.getByRole('link', { name: /view listing/i }))
    .toHaveAttribute('href', `/listing/${mockListing.listingId}`);
});
```

Ensure the full listing editor (`/listings/{id}/edit`) exposes fields: spot type, EV charging, address, photos, pricing — not just availability.

---

## GROUP E — Chat / Messages (#04 #05 #08)

**Tests:**
```typescript
// #04 Conversation partner shown in chat header
test('chat header shows other party name as link', () => {
  render(<ChatThread booking={mockBooking} currentUserId="guest-123" />);
  const link = screen.getByRole('link', { name: /Marc D\./i });
  expect(link).toHaveAttribute('href', `/users/${mockBooking.hostId}`);
});

// #05 Chat window height dynamic
test('chat message area has dynamic height with max-height constraint', () => {
  render(<ChatThread booking={mockBooking} currentUserId="guest-123" />);
  const messageArea = screen.getByTestId('message-area');
  expect(messageArea).toHaveStyle({ maxHeight: '80vh', overflowY: 'auto' });
});

// #08 Back button present
test('back button links to dashboard', () => {
  render(<ChatThread booking={mockBooking} currentUserId="guest-123" role="guest" />);
  expect(screen.getByRole('link', { name: /back to bookings/i }))
    .toHaveAttribute('href', '/dashboard/guest');
});
```

**Chat message area CSS:**
```tsx
<div
  data-testid="message-area"
  className="flex-1 overflow-y-auto"
  style={{ maxHeight: '80vh', minHeight: '20vh' }}
>
  {messages.map(...)}
</div>
```

---

## GROUP F — Profile Page (#14 #31 #32)

### F1 — Spot photo (#14)
Fix listing cards on profile page to use `listing.primaryPhotoUrl`. Fallback: Forest green gradient + `<ParkingCircle>` icon. Never render an empty `<img>` tag without a confirmed src.

### F2 — Email, phone editable (#31)

**Tests:**
```typescript
test('#31 email shown and editable on profile page', () => {
  render(<ProfilePage user={mockUser} />);
  expect(screen.getByTestId('email-field')).toHaveTextContent(mockUser.email);
  fireEvent.click(screen.getByTestId('edit-email'));
  expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
});

test('#31 phone shown with country code on profile page', () => {
  render(<ProfilePage user={mockUser} />);
  expect(screen.getByTestId('phone-field')).toBeVisible();
});
```

### F3 — Invoicing details (#32 #33)

**Tests:**
```typescript
test('#32 invoicing section present on profile page', () => {
  render(<ProfilePage user={mockUser} />);
  expect(screen.getByTestId('invoicing-section')).toBeInTheDocument();
  expect(screen.getByLabelText(/vat number/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/company name/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/billing address/i)).toBeInTheDocument();
});

test('#33 invoicing fields present in host registration Step 3', () => {
  render(<HostRegistrationStep3 />);
  expect(screen.getByLabelText(/vat number/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/company name/i)).toBeInTheDocument();
});
```

**DynamoDB: store invoicing under USER#{userId} / INVOICING:**
```typescript
{
  PK: `USER#${userId}`,
  SK: 'INVOICING',
  vatNumber: string | null,
  companyName: string | null,
  billingStreet: string | null,
  billingCity: string | null,
  billingPostcode: string | null,
  billingCountry: string | null,
  updatedAt: string,
}
```

**New API route: `PUT /api/v1/users/me/invoicing`** — upserts INVOICING record.

---

## GROUP G — Registration (#06 #33)

### G1 — Phone country code dropdown (#06)

**Tests:**
```typescript
test('#06 phone input has country code dropdown defaulting to +32', () => {
  render(<PhoneInput />);
  expect(screen.getByTestId('country-code-select')).toHaveValue('+32');
});

test('selecting +44 updates dial code prefix', async () => {
  render(<PhoneInput />);
  fireEvent.change(screen.getByTestId('country-code-select'), { target: { value: '+44' } });
  await waitFor(() => expect(screen.getByTestId('country-code-select')).toHaveValue('+44'));
});
```

**Implementation:**
Use `react-phone-input-2` or build a simple select with flag emoji + dial code. Store the full number (country code + local number) as a single E.164 string in the DB.

---

## GROUP H — Search & Navbar (#16 #25)

### H1 — Address dropdown dismiss (#16)

```typescript
test('#16 dropdown dismisses after address selection', async () => {
  render(<AddressAutocomplete />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Rue de la' } });
  await waitFor(() => screen.getByTestId('suggestion-0'));
  fireEvent.click(screen.getByTestId('suggestion-0'));
  await waitFor(() => expect(screen.queryByTestId('suggestions-list')).not.toBeInTheDocument());
});
```

On suggestion click: call `setInputValue(suggestion.label)`, `setShowDropdown(false)`, `inputRef.current?.blur()`.

### H2 — Navbar persona-aware links (#25)

```typescript
test('#25 Guest-only: no Dashboard or Listings link shown', () => {
  mockUseAuth({ user: { stripeConnectEnabled: false } });
  render(<Navigation />);
  expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /listings/i })).not.toBeInTheDocument();
});

test('#25 Host: Dashboard and Listings links shown', () => {
  mockUseAuth({ user: { stripeConnectEnabled: true } });
  render(<Navigation />);
  expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
});
```

---

## GROUP I — Notifications (#07)

### I1 — SMS on booking confirmation

**Tests:**
```typescript
test('#07 booking.confirmed event triggers SMS to guest and host', async () => {
  await handler(buildEvent('booking.confirmed', { bookingId: 'b1', hostPhone: '+32...', guestPhone: '+32...' }));
  expect(mockSNS.publish).toHaveBeenCalledTimes(2);
  expect(mockSNS.publish).toHaveBeenCalledWith(expect.objectContaining({
    PhoneNumber: '+32...',
    Message: expect.stringContaining('confirmed'),
  }));
});
```

Ensure `notify-sms` Lambda is subscribed to `booking.confirmed` EventBridge event (check CDK event rule). The SNS publish call must be present for both host and guest phone numbers.

---

## GROUP J — Booking Detail (#09 #10)

### J1 — Dates not shown on back-navigation (#09)

```typescript
test('#09 booking detail page always shows dates from API response, not history state', async () => {
  mockFetch({ booking: { ...mockBooking, startTime: '2026-04-10T09:00:00Z' } });
  render(<BookingDetailPage bookingId="b1" />);
  await waitFor(() => {
    expect(screen.getByTestId('booking-start-date')).not.toHaveTextContent('Invalid date');
    expect(screen.getByTestId('booking-start-date')).toHaveTextContent('10 Apr 2026');
  });
});
```

Always parse dates from API response using `new Date(isoString)`. Never from `window.history.state` or URL params without validation.

### J2 — Link to spot from booking (#10)

Already specified in BR-BC01. Verify the spot address link is present on booking cards. If not rendered, check `booking.listingId` is included in the booking-get API response.

---

## GROUP K — Dispute (#11)

```typescript
test('#11 dispute can be opened for any CONFIRMED or ACTIVE booking', async () => {
  for (const status of ['CONFIRMED', 'ACTIVE']) {
    const booking = buildBooking({ status });
    const event = mockAuthEvent({ bookingId: booking.bookingId });
    const result = await disputeHandler(event);
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).disputeId).toBeDefined();
  }
});

test('dispute-create returns helpful error for COMPLETED bookings beyond review window', async () => {
  const booking = buildBooking({ status: 'COMPLETED', endTime: addDays(now(), -30) });
  const result = await disputeHandler(mockAuthEvent({ bookingId: booking.bookingId }));
  expect(result.statusCode).toBe(409);
  const body = JSON.parse(result.body);
  expect(body.error).toBe('DISPUTE_WINDOW_EXPIRED');
  expect(body.message).toBeDefined(); // human-readable message for the bot to relay
});
```

The dispute-create Lambda must: (1) allow disputes on CONFIRMED and ACTIVE bookings unconditionally; (2) allow disputes on COMPLETED bookings within 7 days of end time; (3) return a structured error with a `message` field that the AI triage bot can relay as a helpful response rather than a raw error.

---

## GROUP L — Landing Page (#17 #26 #27)

```typescript
// #17 Get directions removed
test('booking confirmation page has no "Get directions" button', () => {
  render(<BookingConfirmPage booking={mockBooking} />);
  expect(screen.queryByRole('button', { name: /directions/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /directions/i })).not.toBeInTheDocument();
});

// #26 Create account hover colour
test('"Create account" quick card hover uses Sage background not Forest fill', () => {
  render(<QuickAccessCards />);
  // Check CSS class — should use EBF7F1 not 004526 as hover bg
  const card = screen.getByText('Create account').closest('[data-testid="quick-card"]');
  expect(card).toHaveClass('hover:bg-[#EBF7F1]');
  expect(card).not.toHaveClass('hover:bg-[#004526]');
});

// #27 List your spot removed from hero
test('"List your spot" CTA not present in landing page hero', () => {
  render(<LandingPage />);
  const hero = screen.getByTestId('hero-section');
  expect(within(hero).queryByText(/list your spot/i)).not.toBeInTheDocument();
});
```

---

## E2E — UAT regression suite

**`e2e/journeys/uat-round1.spec.ts`**

```typescript
test('#01 #02 Booking status badges correct on dashboard', async ({ page }) => {
  await loginAsHost(page);
  await page.goto('/dashboard/host');
  // Completed booking shows Completed badge
  await expect(page.getByTestId('status-badge').filter({ hasText: 'Completed' }).first()).toBeVisible();
});

test('#19 Active booking: no cancel button shown', async ({ page }) => {
  await loginAsGuest(page);
  await page.goto('/dashboard/guest');
  const activeCard = page.locator('[data-status="ACTIVE"]').first();
  await expect(activeCard.getByRole('button', { name: /cancel/i })).not.toBeVisible();
});

test('#20 #21 Cancel modal shows correct refund amount', async ({ page }) => {
  await loginAsGuest(page);
  // Navigate to a booking starting in 6h (< 12h window)
  await page.goto(`/bookings/${BOOKING_UNDER_12H}`);
  await page.click('[data-testid="cancel-btn"]');
  await expect(page.getByTestId('refund-amount')).toHaveText('€0.00');
});

test('#15 Spot type human-readable on listing card', async ({ page }) => {
  await page.goto('/search');
  await expect(page.getByTestId('spot-type').first()).not.toHaveText('OPEN_SPACE');
  await expect(page.getByTestId('spot-type').first()).toHaveText(/Open space|Covered garage|Carport|Driveway/);
});

test('#11 Dispute can be opened on active booking', async ({ page }) => {
  await loginAsGuest(page);
  await page.goto(`/bookings/${ACTIVE_BOOKING_ID}`);
  await page.click('[data-testid="open-dispute-btn"]');
  await expect(page.getByTestId('dispute-chat')).toBeVisible();
  await expect(page.getByText(/cannot open/i)).not.toBeVisible();
});

test('#06 Phone input has country code dropdown', async ({ page }) => {
  await page.goto('/auth/register');
  await expect(page.getByTestId('country-code-select')).toBeVisible();
  await expect(page.getByTestId('country-code-select')).toHaveValue('+32');
});

test('#32 Invoicing details on profile page', async ({ page }) => {
  await loginAsHost(page);
  await page.goto('/profile');
  await expect(page.getByTestId('invoicing-section')).toBeVisible();
  await expect(page.getByLabel(/vat number/i)).toBeVisible();
});
```
