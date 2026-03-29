# Session 14 — Self-Booking Prevention, List-Your-Spot Flows & Design System v3

## What this session builds
1. Self-booking prevention — frontend + backend (BR-SB01)
2. List-your-spot CTA routing — 3 paths (UC-H18)
3. Spotter-to-Host upgrade flow — Become a Host interstitial (UC-H19)
4. Design system v3 — Lacoste green family + brick red (#AD3614) only. Remove all gold. Slow-grow animation with 0.5s delay. 360° logo spin.

Feed after sessions 00–13 are complete.

---

## PART A — Self-Booking Prevention (BR-SB01)

### A1 — Backend: booking-create update

**Tests first — add to `__tests__/bookings/create.test.ts`:**
```typescript
test('spotterId === hostId → 403 CANNOT_BOOK_OWN_LISTING', async () => {
  const userId = 'user-123';
  const listing = buildListing({ hostId: userId });
  const event = mockEvent({
    body: { listingId: listing.listingId, startTime: tomorrow(), endTime: tomorrowPlus2h() },
    requestContext: { authorizer: { claims: { sub: userId } } }, // same user
  });
  const result = await handler(event);
  expect(result.statusCode).toBe(403);
  expect(JSON.parse(result.body).error).toBe('CANNOT_BOOK_OWN_LISTING');
});

test('spotterId !== hostId → proceeds normally', async () => {
  const listing = buildListing({ hostId: 'host-abc' });
  const event = mockEvent({
    body: { listingId: listing.listingId, startTime: tomorrow(), endTime: tomorrowPlus2h() },
    requestContext: { authorizer: { claims: { sub: 'spotter-xyz' } } },
  });
  // Should reach availability check (not blocked at self-booking check)
  // ... rest of happy-path assertions
});

test('self-booking check happens BEFORE availability check and BEFORE Stripe', async () => {
  // Verify DynamoDB availability query NOT called when spotterId === hostId
  const userId = 'user-123';
  const listing = buildListing({ hostId: userId });
  await handler(mockEvent({ body: { listingId: listing.listingId }, userId }));
  expect(mockDynamoQuery).not.toHaveBeenCalledWith(expect.objectContaining({
    KeyConditionExpression: expect.stringContaining('AVAIL_BLOCK'),
  }));
  expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();
});
```

**Implementation — insert at the top of booking-create handler, after fetching the listing:**
```typescript
// Self-booking prevention — BR-SB01
if (spotterId === listing.hostId) {
  return forbidden('CANNOT_BOOK_OWN_LISTING');
}
// Then proceed with availability check, duration check, Stripe...
```

---

### A2 — Frontend: listing detail page

**Tests first — add to `__tests__/pages/listing.test.tsx`:**
```typescript
test('own listing: shows "This is your listing" instead of "Book this spot"', () => {
  // Mock useAuth to return userId matching listing.hostId
  mockUseAuth({ userId: 'host-123' });
  render(<ListingDetailPage listing={{ ...mockListing, hostId: 'host-123' }} />);
  expect(screen.queryByRole('button', { name: /book this spot/i })).not.toBeInTheDocument();
  expect(screen.getByText('This is your listing')).toBeInTheDocument();
});

test('own listing: booking widget inputs are disabled', () => {
  mockUseAuth({ userId: 'host-123' });
  render(<ListingDetailPage listing={{ ...mockListing, hostId: 'host-123' }} />);
  const dateInput = screen.getByLabelText(/start date/i);
  expect(dateInput).toBeDisabled();
});

test('other user listing: shows "Book this spot" button normally', () => {
  mockUseAuth({ userId: 'spotter-xyz' });
  render(<ListingDetailPage listing={{ ...mockListing, hostId: 'host-123' }} />);
  expect(screen.getByRole('button', { name: /book this spot/i })).toBeInTheDocument();
  expect(screen.queryByText('This is your listing')).not.toBeInTheDocument();
});

test('"This is your listing" label is not clickable — no cursor-pointer', () => {
  mockUseAuth({ userId: 'host-123' });
  render(<ListingDetailPage listing={{ ...mockListing, hostId: 'host-123' }} />);
  const label = screen.getByText('This is your listing');
  expect(label).not.toHaveAttribute('role', 'button');
  expect(label).toHaveStyle({ cursor: 'default' });
});
```

**Implementation — in `app/listing/[id]/page.tsx`:**
```typescript
const { userId } = useAuth();
const isOwnListing = userId === listing.hostId;

// In the booking widget render:
{isOwnListing ? (
  <p
    className="text-center text-sm text-[#4B6354] py-3 cursor-default select-none"
    data-testid="own-listing-label"
  >
    This is your listing
  </p>
) : (
  <button onClick={handleBook} className="btn-emerald w-full">
    Book this spot
  </button>
)}

// Disable date/time inputs when own listing:
<input
  type="datetime-local"
  disabled={isOwnListing}
  className={isOwnListing ? 'opacity-50 cursor-not-allowed' : ''}
/>
```

---

## PART B — List-Your-Spot CTA Routing (UC-H18)

### B1 — Hook: useListYourSpot

**Tests first: `__tests__/hooks/useListYourSpot.test.ts`**
```typescript
test('unauthenticated → returns destination: "/auth/register?intent=host"', () => {
  mockUseAuth({ user: null });
  const { destination } = useListYourSpotDestination();
  expect(destination).toBe('/auth/register?intent=host');
});

test('logged in, stripeConnectEnabled=true → returns "/listings/new"', () => {
  mockUseAuth({ user: { stripeConnectEnabled: true } });
  const { destination } = useListYourSpotDestination();
  expect(destination).toBe('/listings/new');
});

test('logged in, has existing listings → returns "/listings/new"', () => {
  mockUseAuth({ user: { stripeConnectEnabled: false, listingCount: 2 } });
  const { destination } = useListYourSpotDestination();
  expect(destination).toBe('/listings/new');
});

test('logged in, Spotter only (no Stripe, no listings) → returns "/become-host"', () => {
  mockUseAuth({ user: { stripeConnectEnabled: false, listingCount: 0 } });
  const { destination } = useListYourSpotDestination();
  expect(destination).toBe('/become-host');
});
```

**Implementation: `hooks/useListYourSpotDestination.ts`**
```typescript
export function useListYourSpotDestination() {
  const { user } = useAuth();
  if (!user) return { destination: '/auth/register?intent=host' };
  if (user.stripeConnectEnabled || (user.listingCount ?? 0) > 0) return { destination: '/listings/new' };
  return { destination: '/become-host' };
}
```

**Wire into Navigation and all "List your spot" CTAs:**
```typescript
const { destination } = useListYourSpotDestination();
<Link href={destination}>List your spot</Link>
```

**Registration flow update (`app/auth/register/page.tsx`):**
- When `?intent=host` is in the URL query string: pre-select the Host persona card (add Forest border + checkmark to the Host card on render).
- The user can still change their selection — the pre-selection is a default, not a lock.

---

## PART C — Become a Host Interstitial (UC-H19)

### C1 — New page: `app/become-host/page.tsx`

**Tests first: `__tests__/pages/become-host.test.tsx`**
```typescript
test('renders heading "Become a Host"', () => {
  render(<BecomeHostPage />);
  expect(screen.getByRole('heading', { name: /become a host/i })).toBeInTheDocument();
});

test('renders "Set up payouts" CTA button', () => {
  render(<BecomeHostPage />);
  expect(screen.getByRole('button', { name: /set up payouts/i })).toBeInTheDocument();
});

test('no "Skip" link present', () => {
  render(<BecomeHostPage />);
  expect(screen.queryByText(/skip/i)).not.toBeInTheDocument();
});

test('clicking "Set up payouts" calls POST /api/v1/users/me/payout and opens Stripe URL', async () => {
  const mockOnboardingUrl = 'https://connect.stripe.com/onboarding/test';
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ onboardingUrl: mockOnboardingUrl }),
  });
  const mockOpen = jest.fn();
  Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });

  render(<BecomeHostPage />);
  fireEvent.click(screen.getByRole('button', { name: /set up payouts/i }));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/users/me/payout'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

test('redirected back with ?payout=success → shows success state then navigates to /listings/new', async () => {
  // Mock URL: /become-host?payout=success
  Object.defineProperty(window, 'location', {
    value: { search: '?payout=success' }, writable: true
  });
  render(<BecomeHostPage />);
  // Should call POST /api/v1/users/me/become-host to confirm
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/become-host'), expect.any(Object)
  ));
  // Then navigate to /listings/new
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/listings/new'));
});

test('redirected back without success param → stays on interstitial screen', () => {
  Object.defineProperty(window, 'location', { value: { search: '' }, writable: true });
  render(<BecomeHostPage />);
  expect(screen.getByRole('button', { name: /set up payouts/i })).toBeInTheDocument();
});
```

**Implementation: `app/become-host/page.tsx`** (CSR)

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export default function BecomeHostPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Handle Stripe return
  useEffect(() => {
    if (params.get('payout') === 'success') {
      setConfirming(true);
      apiFetch('/api/v1/users/me/become-host', { method: 'POST' })
        .then(() => router.push('/listings/new'))
        .catch(() => setConfirming(false));
    }
  }, []);

  const handleSetupPayouts = async () => {
    setLoading(true);
    const res = await apiFetch('/api/v1/users/me/payout', { method: 'POST' });
    const { onboardingUrl } = await res.json();
    window.location.href = onboardingUrl;
  };

  if (confirming) return (
    <div className="min-h-screen flex items-center justify-center bg-[#F2F9F5]">
      <div className="text-center space-y-3">
        {/* Animated forest green checkmark */}
        <div className="w-16 h-16 rounded-full bg-[#006B3C] flex items-center justify-center mx-auto animate-bounce">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <p className="text-[#004526] font-semibold text-lg">Payout account connected!</p>
        <p className="text-[#4B6354] text-sm">Taking you to create your listing…</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F2F9F5] p-6">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center space-y-6">
        {/* Host icon — 360° spin on mount via CSS animation */}
        <div className="w-16 h-16 rounded-full bg-[#004526] flex items-center justify-center mx-auto shadow-lg"
             style={{ animation: 'spin360 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[#004526] mb-2">Become a Host</h1>
          <p className="text-[#4B6354]">Set up your payout account to start earning from your parking space.</p>
        </div>
        <button
          onClick={handleSetupPayouts}
          disabled={loading}
          className="w-full bg-[#006B3C] text-white font-semibold py-3 rounded-lg
                     disabled:opacity-50 transition-all
                     hover:bg-[#005a32] hover:shadow-lg"
          style={{ transition: 'transform 1.5s cubic-bezier(0.34,1.56,0.64,1) 0.5s' }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.04)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {loading ? 'Opening Stripe…' : 'Set up payouts'}
        </button>
        <p className="text-xs text-[#7A9A88]">Powered by Stripe Connect — your banking details are handled securely by Stripe, not stored by Spotzy.</p>
      </div>
      <style>{`@keyframes spin360 { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
```

### C2 — Backend: become-host Lambda (POST /api/v1/users/me/become-host)

**Tests first: `__tests__/users/become-host.test.ts`**
```typescript
test('sets stripeConnectEnabled=true on user record', async () => {
  const event = mockAuthEvent('user-123');
  await handler(event);
  expect(mockDynamoPut).toHaveBeenCalledWith(expect.objectContaining({
    Key: { PK: 'USER#user-123', SK: 'PROFILE' },
    UpdateExpression: expect.stringContaining('stripeConnectEnabled'),
  }));
});
test('idempotent — calling twice does not error', async () => {
  const event = mockAuthEvent('user-123');
  await handler(event);
  const result = await handler(event); // second call
  expect(result.statusCode).toBe(200);
});
test('missing auth → 401', async () => { ... });
```

**Implementation: `functions/users/become-host/index.ts`**
```typescript
export const handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;
  await dynamodb.update({
    TableName: process.env.DYNAMODB_TABLE,
    Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
    UpdateExpression: 'SET stripeConnectEnabled = :t, updatedAt = :now',
    ExpressionAttributeValues: { ':t': true, ':now': new Date().toISOString() },
  });
  return ok({ success: true });
};
```

---

## PART D — Design System v3 (green + brick only)

### D1 — Replace theme.css

Replace `styles/theme.css` with the following (removes all gold, adds brick red, updates focus ring to emerald):

```css
:root {
  --background: #F2F9F5;      /* Off-white green — page surface */
  --foreground: #1C2B1A;
  --card: #FFFFFF;             /* White — card surfaces only */
  --card-foreground: #1C2B1A;
  --primary: #006B3C;          /* Emerald — main CTA */
  --primary-foreground: #FFFFFF;
  --secondary: #EBF7F1;        /* Sage — secondary surfaces */
  --secondary-foreground: #004526;
  --muted: #EFF5F1;
  --muted-foreground: #4B6354;
  --accent: #B8E6D0;           /* Mint — accent fills */
  --accent-foreground: #004526;
  --destructive: #DC2626;
  --destructive-foreground: #FFFFFF;
  --border: #C8DDD2;
  --input: transparent;
  --input-background: #EBF7F1;
  --ring: #006B3C;             /* Emerald focus ring — NO gold */
  --brick: #AD3614;            /* Brick red — warm accent */
  --brick-light: #F5E6E1;
  --brick-mid: #C94A28;
  --forest: #004526;
  --radius: 0.75rem;
  --sidebar: #004526;
  --sidebar-foreground: #FFFFFF;
  --sidebar-primary: #B8E6D0;
  --sidebar-primary-foreground: #004526;
  --sidebar-accent: #006B3C;
  --sidebar-accent-foreground: #FFFFFF;
  --sidebar-border: #006B3C;
  --sidebar-ring: #B8E6D0;
}

.dark {
  --background: #0D1F15;
  --foreground: #EBF7F1;
  --card: #1A2E1E;
  --primary: #059669;
  --secondary: #1A2E1E;
  --secondary-foreground: #059669;
  --muted: #1F3327;
  --muted-foreground: #9CA3AF;
  --accent: #065F46;
  --accent-foreground: #B8E6D0;
  --border: #2D4A35;
  --ring: #059669;
  --brick: #AD3614;
  --brick-light: #3A1A10;
  --brick-mid: #C94A28;
  --forest: #004526;
  --sidebar: #0D1F15;
  --sidebar-foreground: #EBF7F1;
  --sidebar-primary: #B8E6D0;
  --sidebar-primary-foreground: #004526;
  --sidebar-border: #2D4A35;
  --sidebar-ring: #B8E6D0;
}

/* Slow grow animation — 0.5s delay, 1.5s spring */
.grow {
  transition:
    transform 1.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s,
    box-shadow 1.5s ease 0.5s;
}
.grow:hover { transform: scale(1.045); }
.grow:not(:hover) { transform: scale(1); transition-delay: 0s; }

/* 360° spin — logo icon, listing thumbnails */
.spin-360 { transition: transform 0.68s cubic-bezier(0.34, 1.56, 0.64, 1); }
.spin-360:hover { transform: rotate(360deg); }

/* Wiggle — small icons */
@keyframes wiggle {
  0%,100% { transform: rotate(0deg); }
  20%     { transform: rotate(-14deg); }
  40%     { transform: rotate(14deg); }
  60%     { transform: rotate(-10deg); }
  80%     { transform: rotate(8deg); }
}

/* Brick utility classes */
.bg-brick       { background-color: #AD3614; }
.text-brick     { color: #AD3614; }
.border-brick   { border-color: #AD3614; }
.bg-brick-light { background-color: #F5E6E1; }

/* Shadow utilities */
.shadow-forest { box-shadow: 0 4px 12px rgba(0,69,38,0.18); }
.shadow-brick  { box-shadow: 0 4px 12px rgba(173,54,20,0.18); }
```

### D2 — Component updates

**Tests first: `__tests__/design/palette.test.ts`**
```typescript
test('--ring CSS variable is emerald green, not gold', () => {
  const styles = getComputedStyle(document.documentElement);
  expect(styles.getPropertyValue('--ring').trim()).toBe('#006B3C');
});
test('no gold (#FFD700, #B8960C, #D4A017) appears in computed styles', () => {
  const html = document.documentElement.outerHTML;
  expect(html).not.toContain('#FFD700');
  expect(html).not.toContain('#B8960C');
  expect(html).not.toContain('#D4A017');
});
```

**`components/ui/button.tsx` — update variant colours:**
```typescript
const buttonVariants = cva('...base classes...', {
  variants: {
    variant: {
      default:   'bg-[#006B3C] text-white hover:bg-[#005a32] shadow-sm hover:shadow-forest',
      forest:    'bg-[#004526] text-white hover:bg-[#003a1f] shadow-sm hover:shadow-forest',
      park:      'bg-[#059669] text-white hover:bg-[#047857]',
      brick:     'bg-[#AD3614] text-white hover:bg-[#C94A28] shadow-sm hover:shadow-brick',
      secondary: 'bg-[#EBF7F1] text-[#004526] border border-[#C8DDD2] hover:bg-[#B8E6D0] hover:border-[#006B3C]',
      outline:   'border border-[#004526] text-[#004526] hover:bg-[#EBF7F1]',
      'outline-brick': 'border border-[#AD3614] text-[#AD3614] hover:bg-[#F5E6E1]',
      ghost:     'hover:bg-[#EBF7F1] text-[#4B6354]',
      link:      'text-[#006B3C] underline-offset-4 hover:underline',
      destructive: 'bg-[#DC2626] text-white hover:bg-[#b91c1c]',
    }
  }
});
// Apply slow-grow to all variants via base class:
// Add 'transition-transform duration-[1500ms] delay-500 hover:scale-[1.07] active:scale-[0.97]'
// to the base cva string
```

**`components/ui/badge.tsx` — add brick variant:**
```typescript
variant: {
  default:   'border-transparent bg-[#006B3C] text-white',
  secondary: 'border-transparent bg-[#EBF7F1] text-[#004526]',
  brick:     'border-[#E8B4A4] bg-[#F5E6E1] text-[#AD3614]',
  outline:   'text-foreground',
  success:   'border-transparent bg-[#B8E6D0] text-[#004526]',
}
```

**Remove all gold text from price/earnings components:**
- Replace `text-[#B8960C]` → `text-[#004526] font-bold` (forest green)
- Replace `text-[#FFD700]` → `text-[#006B3C]` (emerald)
- Replace `fill-[#FFD700]` on star ratings → `fill-[#059669]` (park green)

**Logo component — ensure circular frame:**
```tsx
// In Navigation.tsx and anywhere the logo appears:
<div className="w-12 h-12 rounded-full bg-[#004526] flex items-center justify-center shadow-lg spin-360">
  {/* P icon SVG — no inner rect */}
  <svg width="24" height="24" ...>
    <path d="M9 13V7h3.5a2.5 2.5 0 010 5H9M9 13v4"/>
  </svg>
</div>
```

---

## PART E — E2E additions

**`e2e/journeys/self-booking.spec.ts`**
```typescript
test('Host viewing own listing sees "This is your listing" not "Book this spot"', async ({ page }) => {
  await loginAsHost(page);
  // Navigate to a listing owned by this host
  await page.goto(`/listing/${TEST_HOST_LISTING_ID}`);
  await expect(page.getByText('This is your listing')).toBeVisible();
  await expect(page.getByRole('button', { name: /book this spot/i })).not.toBeVisible();
});

test('Direct API call to book own listing returns 403', async () => {
  const token = await getHostToken();
  const res = await fetch(`${API_URL}/api/v1/bookings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ listingId: TEST_HOST_LISTING_ID, startTime: tomorrow(), endTime: tomorrowPlus2h() }),
  });
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body.error).toBe('CANNOT_BOOK_OWN_LISTING');
});
```

**`e2e/journeys/become-host.spec.ts`**
```typescript
test('Spotter clicking "List your spot" sees Become a Host screen', async ({ page }) => {
  await loginAsSpotter(page); // spotter with no listings, no Stripe
  await page.click('[data-testid="list-your-spot-cta"]');
  await expect(page).toHaveURL('/become-host');
  await expect(page.getByRole('heading', { name: /become a host/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /set up payouts/i })).toBeVisible();
  await expect(page.getByText(/skip/i)).not.toBeVisible();
});

test('Logged-in Host clicking "List your spot" goes directly to /listings/new', async ({ page }) => {
  await loginAsHost(page); // host with stripeConnectEnabled=true
  await page.click('[data-testid="list-your-spot-cta"]');
  await expect(page).toHaveURL('/listings/new');
});

test('Unauthenticated "List your spot" goes to register with Host pre-selected', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="list-your-spot-cta"]');
  await expect(page).toHaveURL(/\/auth\/register/);
  const hostCard = page.getByTestId('persona-host');
  await expect(hostCard).toHaveClass(/border-\[#004526\]/); // pre-selected
});
```
