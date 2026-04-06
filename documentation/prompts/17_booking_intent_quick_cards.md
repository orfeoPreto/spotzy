# Session 17 — Booking Intent Preservation (UC-A03) & Quick Access Cards (UC-QA01)

## What this session builds
1. Booking intent preservation — unauthenticated user selects spot → login/register → checkout with data intact
2. Remove current behaviour: redirect to empty Guest dashboard after unauthenticated booking attempt
3. Quick access cards — 3 context-aware cards in landing page hero, existing visual design

Feed after sessions 00–16 are complete.

---

## PART A — Booking Intent Preservation (UC-A03)

### A1 — useBookingIntent hook

**Tests first: `__tests__/hooks/useBookingIntent.test.ts`**
```typescript
import { useBookingIntent } from '@/hooks/useBookingIntent';

const mockIntent = {
  listingId: 'listing-abc',
  startTime: '2026-04-10T09:00:00Z',
  endTime: '2026-04-10T11:00:00Z',
  listingData: {
    address: 'Rue de la Loi 42, Bruxelles',
    primaryPhotoUrl: 'https://cdn.spotzy.com/photos/abc/0.jpg',
    pricePerHour: 5.5,
    spotType: 'COVERED_GARAGE',
    hostName: 'Marc D.',
  }
};

test('saveIntent writes to sessionStorage and encodes URL params correctly', () => {
  const { saveIntent } = useBookingIntent();
  saveIntent(mockIntent);
  const stored = JSON.parse(sessionStorage.getItem('bookingIntent')!);
  expect(stored.listingId).toBe('listing-abc');
  expect(stored.listingData.address).toBe('Rue de la Loi 42, Bruxelles');
});

test('getRedirectUrl returns correct URL with encoded params', () => {
  const { getRedirectUrl } = useBookingIntent();
  const url = getRedirectUrl(mockIntent);
  expect(url).toContain('/auth/login?next=checkout');
  expect(url).toContain('listingId=listing-abc');
  expect(url).toContain('start=');
  expect(url).toContain('end=');
});

test('readIntent reads from sessionStorage first, falls back to URL params', () => {
  sessionStorage.setItem('bookingIntent', JSON.stringify(mockIntent));
  const { readIntent } = useBookingIntent();
  const intent = readIntent();
  expect(intent?.listingId).toBe('listing-abc');
  expect(intent?.listingData).toBeDefined();
});

test('readIntent falls back to URL params when sessionStorage empty', () => {
  sessionStorage.clear();
  // Mock window.location.search
  Object.defineProperty(window, 'location', {
    value: { search: '?next=checkout&listingId=listing-abc&start=2026-04-10T09:00:00Z&end=2026-04-10T11:00:00Z' },
    writable: true,
  });
  const { readIntent } = useBookingIntent();
  const intent = readIntent();
  expect(intent?.listingId).toBe('listing-abc');
  // listingData NOT available from URL params alone — only from sessionStorage
  expect(intent?.listingData).toBeUndefined();
});

test('readIntent returns null when no intent found in either source', () => {
  sessionStorage.clear();
  Object.defineProperty(window, 'location', { value: { search: '' }, writable: true });
  const { readIntent } = useBookingIntent();
  expect(readIntent()).toBeNull();
});

test('clearIntent removes sessionStorage entry', () => {
  sessionStorage.setItem('bookingIntent', JSON.stringify(mockIntent));
  const { clearIntent } = useBookingIntent();
  clearIntent();
  expect(sessionStorage.getItem('bookingIntent')).toBeNull();
});
```

**Implementation: `hooks/useBookingIntent.ts`**
```typescript
const STORAGE_KEY = 'bookingIntent';

export interface BookingIntent {
  listingId: string;
  startTime: string;
  endTime: string;
  listingData?: {
    address: string;
    primaryPhotoUrl: string | null;
    pricePerHour: number | null;
    pricePerDay: number | null;
    spotType: string;
    hostName: string;
  };
}

export function useBookingIntent() {
  const saveIntent = (intent: BookingIntent) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
    } catch {
      // sessionStorage unavailable (private browsing) — URL params will be sole source
    }
  };

  const getRedirectUrl = (intent: BookingIntent): string => {
    const params = new URLSearchParams({
      next: 'checkout',
      listingId: intent.listingId,
      start: intent.startTime,
      end: intent.endTime,
    });
    return `/auth/login?${params.toString()}`;
  };

  const readIntent = (): BookingIntent | null => {
    // 1. Try sessionStorage first (has full listingData)
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}

    // 2. Fall back to URL params (partial intent — no listingData)
    const params = new URLSearchParams(window.location.search);
    const listingId = params.get('listingId');
    const startTime = params.get('start');
    const endTime   = params.get('end');
    if (listingId && startTime && endTime) {
      return { listingId, startTime, endTime }; // no listingData — checkout will fetch
    }

    return null;
  };

  const clearIntent = () => {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  };

  return { saveIntent, getRedirectUrl, readIntent, clearIntent };
}
```

---

### A2 — 'Book this spot' button — unauthenticated intercept

**Tests first — update `__tests__/pages/listing.test.tsx`:**
```typescript
test('unauthenticated user: "Book this spot" saves intent and redirects to login', async () => {
  mockUseAuth({ user: null }); // not logged in
  render(<ListingDetailPage listing={mockListing} />);
  fireEvent.click(screen.getByRole('button', { name: /book this spot/i }));

  // Intent stored in sessionStorage
  await waitFor(() => {
    const stored = JSON.parse(sessionStorage.getItem('bookingIntent')!);
    expect(stored.listingId).toBe(mockListing.listingId);
    expect(stored.listingData).toBeDefined();
  });

  // Redirected to login with intent params
  expect(mockRouter.push).toHaveBeenCalledWith(
    expect.stringContaining('/auth/login?next=checkout&listingId=')
  );
});

test('unauthenticated user: NOT redirected to dashboard after booking attempt', async () => {
  mockUseAuth({ user: null });
  render(<ListingDetailPage listing={mockListing} />);
  fireEvent.click(screen.getByRole('button', { name: /book this spot/i }));
  expect(mockRouter.push).not.toHaveBeenCalledWith('/dashboard/guest');
  expect(mockRouter.push).not.toHaveBeenCalledWith('/dashboard');
});
```

**Update `app/listing/[id]/page.tsx` — 'Book this spot' handler:**
```typescript
const { user } = useAuth();
const { saveIntent, getRedirectUrl } = useBookingIntent();

const handleBookClick = () => {
  if (!user) {
    // Capture intent before redirecting
    const intent: BookingIntent = {
      listingId: listing.listingId,
      startTime: selectedStart,
      endTime: selectedEnd,
      listingData: {
        address: listing.address,
        primaryPhotoUrl: listing.photos[0]?.url ?? null,
        pricePerHour: listing.pricePerHour,
        pricePerDay: listing.pricePerDay,
        spotType: listing.spotType,
        hostName: listing.hostName,
      },
    };
    saveIntent(intent);
    router.push(getRedirectUrl(intent));
    return;
  }
  // Authenticated — proceed to checkout normally
  router.push(`/checkout?listingId=${listing.listingId}&start=${selectedStart}&end=${selectedEnd}`);
};
```

---

### A3 — Login page — booking summary strip + post-login redirect

**Tests first — update `__tests__/pages/login.test.tsx`:**
```typescript
test('shows booking summary strip when intent params present in URL', () => {
  Object.defineProperty(window, 'location', {
    value: { search: '?next=checkout&listingId=listing-abc&start=2026-04-10T09:00:00Z&end=2026-04-10T11:00:00Z' },
    writable: true,
  });
  // Mock sessionStorage intent with listingData
  sessionStorage.setItem('bookingIntent', JSON.stringify(mockIntent));
  render(<LoginPage />);
  expect(screen.getByTestId('booking-summary-strip')).toBeInTheDocument();
  expect(screen.getByTestId('booking-summary-address')).toHaveTextContent(mockIntent.listingData.address);
});

test('does NOT show booking summary strip when no intent present', () => {
  sessionStorage.clear();
  Object.defineProperty(window, 'location', { value: { search: '' }, writable: true });
  render(<LoginPage />);
  expect(screen.queryByTestId('booking-summary-strip')).not.toBeInTheDocument();
});

test('after login with intent: navigates to /checkout, not dashboard', async () => {
  sessionStorage.setItem('bookingIntent', JSON.stringify(mockIntent));
  render(<LoginPage />);
  await performLogin();
  expect(mockRouter.push).toHaveBeenCalledWith(
    expect.stringContaining('/checkout?listingId=listing-abc')
  );
  expect(mockRouter.push).not.toHaveBeenCalledWith('/dashboard/guest');
});

test('after login without intent: navigates to /search (previous landing page behaviour removed)', async () => {
  sessionStorage.clear();
  Object.defineProperty(window, 'location', { value: { search: '' }, writable: true });
  render(<LoginPage />);
  await performLogin();
  // No intent → /search (not /dashboard/guest)
  expect(mockRouter.push).toHaveBeenCalledWith('/search');
});
```

**Booking summary strip component:**
```tsx
// components/BookingSummaryStrip.tsx
interface BookingSummaryStripProps {
  intent: BookingIntent;
}

export function BookingSummaryStrip({ intent }: BookingSummaryStripProps) {
  if (!intent.listingData) return null;

  const formattedPrice = intent.listingData.pricePerHour
    ? `from €${intent.listingData.pricePerHour.toFixed(2)}/hr`
    : `from €${intent.listingData.pricePerDay}/day`;

  return (
    <div
      data-testid="booking-summary-strip"
      className="flex items-center gap-3 bg-[#EBF7F1] border-l-2 border-[#004526] rounded-lg px-4 py-3 mb-6"
    >
      {intent.listingData.primaryPhotoUrl ? (
        <img
          src={intent.listingData.primaryPhotoUrl}
          alt="Spot"
          className="w-12 h-12 rounded-md border border-[#C8DDD2] object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded-md bg-[#B8E6D0] flex items-center justify-center flex-shrink-0">
          <ParkingCircle size={20} className="text-[#004526]" />
        </div>
      )}
      <div className="min-w-0">
        <p
          data-testid="booking-summary-address"
          className="text-sm font-medium text-[#1C2B1A] truncate"
        >
          {intent.listingData.address}
        </p>
        <p className="text-xs text-[#4B6354]">
          {formatDateRange(intent.startTime, intent.endTime)}
        </p>
        <p className="text-xs font-semibold text-[#004526]">{formattedPrice}</p>
      </div>
    </div>
  );
}
```

**Post-login redirect logic in `app/auth/login/page.tsx`:**
```typescript
const { readIntent, clearIntent } = useBookingIntent();

const handleLoginSuccess = () => {
  const intent = readIntent();
  if (intent) {
    clearIntent(); // clean up after reading
    router.push(
      `/checkout?listingId=${intent.listingId}&start=${intent.startTime}&end=${intent.endTime}`
    );
  } else {
    router.push('/search'); // no intent — go to search (not dashboard)
  }
};
```

---

### A4 — Register page — intent params carry through

**Tests first — update `__tests__/pages/register.test.tsx`:**
```typescript
test('intent params preserved in URL through registration redirect', () => {
  Object.defineProperty(window, 'location', {
    value: { search: '?next=checkout&listingId=listing-abc&start=...&end=...' },
    writable: true,
  });
  render(<RegisterPage />);
  fireEvent.click(screen.getByTestId('persona-guest'));
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  // Profile form URL should still carry intent params
  expect(mockRouter.push).toHaveBeenCalledWith(
    expect.stringContaining('listingId=listing-abc')
  );
});

test('after Guest registration with intent: redirects to /checkout not /search', async () => {
  sessionStorage.setItem('bookingIntent', JSON.stringify(mockIntent));
  // Complete Guest registration
  await completeGuestRegistration();
  expect(mockRouter.push).toHaveBeenCalledWith(
    expect.stringContaining('/checkout?listingId=listing-abc')
  );
  expect(mockRouter.push).not.toHaveBeenCalledWith('/search');
});

test('after Host registration with intent: redirects to /checkout not /listings/new', async () => {
  sessionStorage.setItem('bookingIntent', JSON.stringify(mockIntent));
  // Complete Host registration (Stripe success)
  await completeHostRegistration({ stripeResult: 'success' });
  // Intent takes priority over the normal Host redirect to /listings/new
  expect(mockRouter.push).toHaveBeenCalledWith(
    expect.stringContaining('/checkout?listingId=listing-abc')
  );
  expect(mockRouter.push).not.toHaveBeenCalledWith('/listings/new');
});
```

**Update post-registration redirect in `auth-register-complete`:**
The Lambda returns `redirectTo`. Update the frontend to check for booking intent FIRST before using `redirectTo`:
```typescript
// After registration success:
const intent = readIntent();
if (intent) {
  clearIntent();
  router.push(`/checkout?listingId=${intent.listingId}&start=${intent.startTime}&end=${intent.endTime}`);
} else {
  router.push(data.redirectTo); // /listings/new for Host, /search for Guest
}
```

---

### A5 — Checkout page — intent hydration

**Tests first — update `__tests__/pages/checkout.test.tsx`:**
```typescript
test('checkout renders listing data from sessionStorage intent — no API call', async () => {
  sessionStorage.setItem('bookingIntent', JSON.stringify(mockIntent));
  // Mock fetch to verify it's NOT called for listing data
  render(<CheckoutPage searchParams={{ listingId: 'listing-abc', start: '...', end: '...' }} />);
  await waitFor(() => {
    expect(screen.getByText(mockIntent.listingData.address)).toBeInTheDocument();
  });
  // listing-get API should NOT have been called
  expect(global.fetch).not.toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/listings/listing-abc'), expect.anything()
  );
});

test('checkout fetches listing from API if sessionStorage is empty', async () => {
  sessionStorage.clear();
  render(<CheckoutPage searchParams={{ listingId: 'listing-abc', start: '...', end: '...' }} />);
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/listings/listing-abc'), expect.anything()
    );
  });
});

test('checkout clears sessionStorage intent after successful hydration', async () => {
  sessionStorage.setItem('bookingIntent', JSON.stringify(mockIntent));
  render(<CheckoutPage searchParams={{ listingId: 'listing-abc', start: '...', end: '...' }} />);
  await waitFor(() => screen.getByText(mockIntent.listingData.address));
  expect(sessionStorage.getItem('bookingIntent')).toBeNull();
});
```

**Update `app/checkout/page.tsx`:**
```typescript
const { readIntent, clearIntent } = useBookingIntent();

useEffect(() => {
  const intent = readIntent();
  if (intent?.listingData && intent.listingId === searchParams.listingId) {
    // Use cached data — no API call
    setListingData(intent.listingData);
    clearIntent(); // clean up
  } else {
    // Fallback: fetch from API
    fetchListing(searchParams.listingId).then(setListingData);
  }
}, []);
```

---

### A6 — Intent-expired toast

```typescript
// In /app/search/page.tsx — show toast when redirected after expired intent
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('reason') === 'intent_expired') {
    showToast({
      message: 'Your session expired — please select a spot again.',
      icon: 'clock',
      duration: 4000,
      style: 'forest', // Forest green background, white text
    });
  }
}, []);
```

---

## PART B — Quick Access Cards (UC-QA01)

### B1 — QuickAccessCards component

**Tests first: `__tests__/components/QuickAccessCards.test.tsx`**
```typescript
test('unauthenticated: shows Search Spots, Sign in, Create account', () => {
  mockUseAuth({ user: null });
  render(<QuickAccessCards />);
  expect(screen.getByText('Search Spots')).toBeInTheDocument();
  expect(screen.getByText('Sign in')).toBeInTheDocument();
  expect(screen.getByText('Create account')).toBeInTheDocument();
  expect(screen.getAllByTestId('quick-card')).toHaveLength(3);
});

test('Guest-only: shows Search Spots, List your Spot, My Bookings', () => {
  mockUseAuth({ user: { stripeConnectEnabled: false } });
  render(<QuickAccessCards />);
  expect(screen.getByText('Search Spots')).toBeInTheDocument();
  expect(screen.getByText('List your Spot')).toBeInTheDocument();
  expect(screen.getByText('My Bookings')).toBeInTheDocument();
});

test('Host: shows Search Spots, Add a listing, My Bookings', () => {
  mockUseAuth({ user: { stripeConnectEnabled: true } });
  render(<QuickAccessCards />);
  expect(screen.getByText('Search Spots')).toBeInTheDocument();
  expect(screen.getByText('Add a listing')).toBeInTheDocument();
  expect(screen.getByText('My Bookings')).toBeInTheDocument();
});

test('always renders exactly 3 cards', () => {
  for (const user of [null, { stripeConnectEnabled: false }, { stripeConnectEnabled: true }]) {
    mockUseAuth({ user });
    const { unmount } = render(<QuickAccessCards />);
    expect(screen.getAllByTestId('quick-card')).toHaveLength(3);
    unmount();
  }
});

test('Host "My Bookings" links to /dashboard/host', () => {
  mockUseAuth({ user: { stripeConnectEnabled: true } });
  render(<QuickAccessCards />);
  const myBookingsLink = screen.getByRole('link', { name: /my bookings/i });
  expect(myBookingsLink).toHaveAttribute('href', '/dashboard/host');
});

test('Guest "My Bookings" links to /dashboard/guest', () => {
  mockUseAuth({ user: { stripeConnectEnabled: false } });
  render(<QuickAccessCards />);
  const myBookingsLink = screen.getByRole('link', { name: /my bookings/i });
  expect(myBookingsLink).toHaveAttribute('href', '/dashboard/guest');
});

test('Guest "List your Spot" links to /become-host (not /listings/new)', () => {
  mockUseAuth({ user: { stripeConnectEnabled: false } });
  render(<QuickAccessCards />);
  const listLink = screen.getByRole('link', { name: /list your spot/i });
  expect(listLink).toHaveAttribute('href', '/become-host');
});

test('cards update immediately when auth state changes (no page reload)', async () => {
  const { rerender } = render(<QuickAccessCards />, { user: null });
  expect(screen.getByText('Sign in')).toBeInTheDocument();
  // Simulate login
  mockUseAuth({ user: { stripeConnectEnabled: false } });
  rerender(<QuickAccessCards />);
  await waitFor(() => expect(screen.getByText('List your Spot')).toBeInTheDocument());
  expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
});
```

**Implementation: `components/QuickAccessCards.tsx`**
```tsx
import { MapPin, LogIn, UserPlus, Car, Calendar, Plus } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';

interface QuickCard {
  icon: React.ComponentType<{ size: number; className: string }>;
  label: string;
  href: string;
  brickIcon?: boolean; // signals this leads to a setup step, not direct action
}

function getCards(user: User | null): QuickCard[] {
  if (!user) return [
    { icon: MapPin, label: 'Search Spots', href: '/search' },
    { icon: LogIn, label: 'Sign in', href: '/auth/login' },
    { icon: UserPlus, label: 'Create account', href: '/auth/register' },
  ];
  if (user.stripeConnectEnabled) return [
    { icon: MapPin, label: 'Search Spots', href: '/search' },
    { icon: Plus, label: 'Add a listing', href: '/listings/new' },
    { icon: Calendar, label: 'My Bookings', href: '/dashboard/host' },
  ];
  // Guest only
  return [
    { icon: MapPin, label: 'Search Spots', href: '/search' },
    { icon: Car, label: 'List your Spot', href: '/become-host', brickIcon: true },
    { icon: Calendar, label: 'My Bookings', href: '/dashboard/guest' },
  ];
}

export function QuickAccessCards() {
  const { user } = useAuth();
  const cards = getCards(user);

  return (
    <div className="grid grid-cols-3 gap-4 w-full max-w-2xl mx-auto">
      {cards.map((card) => (
        <Link
          key={card.label}
          href={card.href}
          data-testid="quick-card"
          className="flex flex-col items-center gap-3 p-5 bg-[#EBF7F1] rounded-xl
                     border-[1.5px] border-transparent cursor-pointer
                     transition-[border-color,background,transform,box-shadow]
                     duration-300
                     hover:border-[#004526] hover:bg-[#dff2ea]
                     hover:shadow-[0_6px_20px_rgba(0,69,38,0.12)]"
          style={{
            transitionProperty: 'transform, box-shadow, border-color, background-color',
            transitionDuration: '1.5s, 1.5s, 0.3s, 0.3s',
            transitionTimingFunction: 'cubic-bezier(0.34,1.56,0.64,1)',
            transitionDelay: '0.5s, 0.5s, 0s, 0s',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.045)')}
          onMouseLeave={e => {
            e.currentTarget.style.transitionDelay = '0s';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <div
            className="w-11 h-11 rounded-[10px] flex items-center justify-center shadow-sm"
            style={{ backgroundColor: card.brickIcon ? '#AD3614' : '#004526' }}
          >
            <card.icon size={20} className="text-white" />
          </div>
          <span className="text-[15px] font-semibold text-[#1C2B1A] text-center leading-tight">
            {card.label}
          </span>
        </Link>
      ))}
    </div>
  );
}
```

---

## PART C — E2E additions

**`e2e/journeys/booking-intent.spec.ts`**
```typescript
test('New user: unauthenticated booking attempt → register → lands on checkout', async ({ page }) => {
  // Start unauthenticated
  await page.goto('/search');
  await selectSpotAndDates(page);
  await page.click('[data-testid="book-this-spot"]');

  // Should be on login page — not dashboard
  await expect(page).toHaveURL(/\/auth\/login/);
  await expect(page.url()).toContain('listingId=');
  await expect(page.getByTestId('booking-summary-strip')).toBeVisible();

  // Click create account
  await page.click('[data-testid="create-account-link"]');
  await expect(page).toHaveURL(/\/auth\/register/);
  await expect(page.url()).toContain('listingId=');

  // Complete registration
  await page.click('[data-testid="persona-guest"]');
  await fillProfileForm(page);
  await fillOtp(page);

  // Should land on checkout — not dashboard or search
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.url()).toContain('listingId=');
  await expect(page.getByTestId('checkout-listing-address')).toBeVisible();
});

test('Existing user: unauthenticated booking → login → lands on checkout', async ({ page }) => {
  await page.goto('/search');
  await selectSpotAndDates(page);
  await page.click('[data-testid="book-this-spot"]');

  await expect(page).toHaveURL(/\/auth\/login/);
  await expect(page.getByTestId('booking-summary-strip')).toBeVisible();

  await loginExistingUser(page);

  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.url()).toContain('listingId=');
});

test('Old behaviour REMOVED: login without intent goes to /search not /dashboard', async ({ page }) => {
  await page.goto('/auth/login');
  await loginExistingUser(page);
  await expect(page).toHaveURL('/search');
  await expect(page).not.toHaveURL('/dashboard/guest');
  await expect(page).not.toHaveURL('/dashboard');
});

test('Intent expired: toast shown, redirected to /search', async ({ page }) => {
  // Simulate expired intent by going to /search?reason=intent_expired
  await loginExistingUser(page);
  await page.goto('/search?reason=intent_expired');
  await expect(page.getByText(/your session expired/i)).toBeVisible();
});
```

**`e2e/journeys/quick-access-cards.spec.ts`**
```typescript
test('Unauthenticated: landing page shows Search Spots, Sign in, Create account', async ({ page }) => {
  await page.goto('/');
  const cards = page.getByTestId('quick-card');
  await expect(cards).toHaveCount(3);
  await expect(page.getByText('Search Spots')).toBeVisible();
  await expect(page.getByText('Sign in')).toBeVisible();
  await expect(page.getByText('Create account')).toBeVisible();
});

test('Guest: landing page shows Search Spots, List your Spot, My Bookings', async ({ page }) => {
  await loginAsGuest(page);
  await page.goto('/');
  await expect(page.getByText('List your Spot')).toBeVisible();
  await expect(page.getByText('My Bookings')).toBeVisible();
  await expect(page.getByText('Sign in')).not.toBeVisible();
});

test('Host: landing page shows Search Spots, Add a listing, My Bookings', async ({ page }) => {
  await loginAsHost(page);
  await page.goto('/');
  await expect(page.getByText('Add a listing')).toBeVisible();
  await expect(page.getByRole('link', { name: /my bookings/i }))
    .toHaveAttribute('href', '/dashboard/host');
});

test('Guest "List your Spot" card leads to /become-host', async ({ page }) => {
  await loginAsGuest(page);
  await page.goto('/');
  await page.click('[data-testid="quick-card"]:nth-child(2)');
  await expect(page).toHaveURL('/become-host');
});
```
