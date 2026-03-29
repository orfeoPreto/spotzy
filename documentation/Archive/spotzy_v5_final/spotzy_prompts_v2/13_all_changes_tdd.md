# Session 13 — Complete Feature Delta (TDD)
## All changes from functional specs v3, UI/UX specs v2, and architecture v2

This session implements everything added or changed since the initial sessions 00–12. Feed it AFTER sessions 00–12 are complete.

## What this session builds
- Availability feature (if not completed in Session 12)
- Profile page + public profile
- Persistent navigation bar
- Listing management: remove/archive, edit photos (add/remove/reorder), min 1 photo
- Search screen: Brussels default, list-left/map-right layout, listing card content, pin tooltip, map refresh button
- Cancel booking auth fix (CancelModal.tsx)
- Design system v2: Forest green + Gold palette applied across all components
- New API routes: DELETE listing, photo management, availability CRUD, public profile, chat image URL
- DynamoDB schema additions: AvailabilityRule, AvailabilityBlock, photo index records

---

## PART A — Backend: New Lambda functions

### A1 — listing-delete (DELETE /api/v1/listings/{id})

**Tests first: `__tests__/listings/delete.test.ts`**
```typescript
test('listing with no bookings → hard delete', async () => {
  // Mock: no bookings for listing
  // Assert: listing record deleted, all AVAIL_RULE# records deleted
  // Assert: response 200 { deleted: true }
});
test('listing with any booking → archive instead of delete', async () => {
  // Mock: one CANCELLED booking exists
  // Assert: listing status set to ARCHIVED (not deleted)
  // Assert: response 200 { archived: true, reason: 'BOOKING_HISTORY_EXISTS' }
});
test('listing with CONFIRMED or ACTIVE booking → 409 ACTIVE_BOOKING_EXISTS', async () => {
  // Cannot archive OR delete while active booking exists
});
test('not the owner → 403', async () => { ... });
test('listing not found → 404', async () => { ... });
```

**Implementation:**
1. Verify ownership.
2. Query for any booking (all statuses) linked to listing. GSI query: PK=LISTING#{id}, SK begins_with BOOKING#.
3. Check for CONFIRMED or ACTIVE bookings → 409.
4. If bookings exist (but not active) → set listing status=ARCHIVED, return 200 archived.
5. If no bookings → batch-delete listing METADATA + all AVAIL_RULE# + all PHOTO# records → 200 deleted.

---

### A2 — listing-photo-delete (DELETE /api/v1/listings/{id}/photos/{index})

**Tests first: `__tests__/listings/photo-delete.test.ts`**
```typescript
test('deletes photo at given index and shifts remaining photos down', async () => {
  // Listing has 3 photos [0, 1, 2]
  // Delete index 1 → remaining: [0, 2] renumbered to [0, 1]
});
test('cannot delete if only 1 photo remains → 400 MINIMUM_PHOTO_REQUIRED', async () => { ... });
test('deletes from S3 spotzy-media-public as well as DynamoDB', async () => { ... });
test('not the owner → 403', async () => { ... });
```

**Implementation:** Remove photo at index from listing photos array. Renumber remaining photos. Delete from S3 public bucket. Update listing record.

---

### A3 — listing-photo-reorder (PUT /api/v1/listings/{id}/photos/order)

**Tests first: `__tests__/listings/photo-reorder.test.ts`**
```typescript
test('reorders photos array to new sequence', async () => {
  // Body: { order: [2, 0, 1] } — new index sequence
  // Assert: listing photos array reordered accordingly
  // Assert: photos[0] is now the previous photos[2]
});
test('order array must contain same indices as current photos → 400 if mismatch', async () => { ... });
test('not the owner → 403', async () => { ... });
```

**Implementation:** Accept `{ order: number[] }`. Validate it contains all current photo indices. Rearrange photos array. Index 0 = primary display photo. Update listing record.

---

### A4 — chat-image-url (POST /api/v1/chat/{bookingId}/image-url)

**Tests first: `__tests__/chat/image-url.test.ts`**
```typescript
test('generates pre-signed PUT URL for chat image', async () => {
  // Assert: S3 pre-signed URL generated for key chat/{bookingId}/{messageId}.jpg
  // Assert: expiry 300s
  // Returns: { uploadUrl, key, publicUrl }
});
test('only parties to the booking can request image URLs → 403 for unrelated user', async () => { ... });
```

**Implementation:** Verify sender is party to booking. Generate pre-signed PUT URL in spotzy-media-uploads. Key: `chat/{bookingId}/{messageId}.jpg`. On upload (no AI validation for chat images), Lambda copies directly to spotzy-media-public. Return `{ uploadUrl, key, publicUrl }`.

---

### A5 — user-public-get (GET /api/v1/users/{id}/public)

**Tests first: `__tests__/users/public-get.test.ts`**
```typescript
test('returns public profile — name as first name + last initial', async () => {
  // User name: "Jean Dupont"
  // Assert: response name = "Jean D."
});
test('never returns email, phone, address, or stripeConnectAccountId', async () => {
  // Assert: response object does not contain these fields
});
test('for host: includes active listings (LIVE status only)', async () => { ... });
test('for spotter: listings array is empty or absent', async () => { ... });
test('only published reviews shown (published=true)', async () => { ... });
test('any authenticated user can access → 200', async () => { ... });
test('user not found → 404', async () => { ... });
```

**Implementation:** Fetch user profile. Format name as `firstName + ' ' + lastName[0] + '.'`. Strip all PII fields. If user has listings (query GSI1 by hostId, filter LIVE): include listing cards (address, primary photo, spot type, price, rating). Include published reviews. Return.

---

## PART B — Frontend: New screens and components

### B1 — Design system update (apply Forest green + Gold palette)

**Tests first: `__tests__/design/tokens.test.ts`**
```typescript
// Verify CSS custom properties are set correctly
test('--primary maps to Emerald green #006B3C', () => { ... });
test('--gold is #FFD700', () => { ... });
test('--ring (focus ring) is #FFD700 (gold)', () => { ... });
test('--sidebar is Forest green #004526', () => { ... });
```

**Implementation:**
1. Replace `styles/theme.css` with the updated version (provided in UI/UX specs v2 / theme.css file).
2. Update `components/ui/button.tsx` — add `gold` variant:
```typescript
gold: "bg-[#FFD700] text-[#004526] font-bold hover:shadow-[0_4px_16px_rgba(212,160,23,0.40)] hover:-translate-y-0.5 active:scale-[0.97]",
```
3. Update heading colours throughout: h1/h2 → Forest green, h3 → Gold Dark (#B8960C).
4. Update `components/ui/badge.tsx` — add `gold` variant (Gold Soft bg, Gold Dark text, Gold Mid border).
5. All monetary/price text: add `text-[#B8960C] font-bold` (Gold Dark DM Sans 700).
6. Focus ring: confirmed by `--ring: #FFD700` in theme.css — applies globally.

---

### B2 — Navigation component (component tests first)

**Tests first: `__tests__/components/Navigation.test.tsx`**
```typescript
test('renders top bar with Forest green background on desktop', async () => {
  render(<Navigation user={mockUser} />);
  expect(screen.getByRole('navigation')).toHaveClass('bg-[#004526]');
});
test('shows role-appropriate links — Host sees Dashboard link', () => {
  render(<Navigation user={{ ...mockUser, hasListings: true }} />);
  expect(screen.getByText('Dashboard')).toBeInTheDocument();
});
test('active link has gold underline indicator', () => { ... });
test('unauthenticated user sees Sign in + Register', () => {
  render(<Navigation user={null} />);
  expect(screen.getByText('Sign in')).toBeInTheDocument();
});
test('mobile: renders bottom tab bar not top bar', () => {
  // Set viewport to mobile width
  expect(screen.getByTestId('bottom-tabs')).toBeInTheDocument();
  expect(screen.queryByTestId('top-nav')).not.toBeInTheDocument();
});
test('Profile icon links to /profile', () => { ... });
```

**Implementation: `components/Navigation.tsx`**
- Desktop: `<nav>` with Forest green bg (#004526), white logo 'Spotzy' DM Sans 700, navigation links in white with gold active underline. 'List your spot' small Gold button top-right. Profile avatar icon far right.
- Mobile: bottom tab bar (white bg, 1px Forest top border, 64px height). 4–5 tabs with 24px Lucide icons + 11px Inter labels. Active tab: Gold icon fill + Forest label.
- Auth-aware: show/hide links based on user session and role.

---

### B3 — Profile page (component tests first)

**Tests first: `__tests__/pages/profile.test.tsx`**
```typescript
test('renders user name in Forest green DM Sans 700', () => { ... });
test('shows Host badge when user has active listings', () => {
  render(<ProfilePage user={{ ...mockUser, listingCount: 2 }} />);
  expect(screen.getByTestId('host-badge')).toBeInTheDocument();
});
test('hides Host badge when user has no listings', () => {
  render(<ProfilePage user={{ ...mockUser, listingCount: 0 }} />);
  expect(screen.queryByTestId('host-badge')).not.toBeInTheDocument();
});
test('My spots card shows count and links to /dashboard/host', () => {
  expect(screen.getByText('My spots: 2 active listings')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /view listings/i })).toHaveAttribute('href', '/dashboard/host');
});
test('My bookings card shows count and links to /dashboard/spotter', () => { ... });
test('Payment info row links to Stripe portal (external)', () => {
  expect(screen.getByText(/Manage via Stripe/i)).toBeInTheDocument();
});
test('Log out button calls signOut and redirects to /auth/login', async () => {
  fireEvent.click(screen.getByRole('button', { name: /log out/i }));
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
});
test('Edit name: pencil icon click converts to inline input', async () => {
  fireEvent.click(screen.getByTestId('edit-name'));
  expect(screen.getByRole('textbox', { name: /name/i })).toBeInTheDocument();
});
```

**Implementation: `app/profile/page.tsx`** (CSR)

Profile header, role badges, summary cards, edit section, payment row, log out — as specified in UC-H14.

---

### B4 — Public profile page (component tests first)

**Tests first: `__tests__/pages/public-profile.test.tsx`**
```typescript
test('shows name as first name + last initial only', () => {
  // API returns { name: 'Jean D.' }
  expect(screen.getByText('Jean D.')).toBeInTheDocument();
});
test('never shows email, phone or address', () => {
  expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  expect(screen.queryByTestId('phone')).not.toBeInTheDocument();
});
test('host profile shows active listings section', () => { ... });
test('spotter profile does not show listings section', () => { ... });
test('only published reviews are shown', () => { ... });
test('rating progress bars render with Emerald fill', () => { ... });
```

**Implementation: `app/users/[id]/page.tsx`** (ISR 60s)

Uses `user-public-get` Lambda via `GET /api/v1/users/{id}/public`.

---

### B5 — Booking card hyperlinks

**Tests first: `__tests__/components/BookingCard.test.tsx`** (add to existing)
```typescript
test('host name shown as hyperlink to public profile', () => {
  render(<BookingCard booking={mockBookingAsSpotter} />);
  const link = screen.getByRole('link', { name: mockBookingAsSpotter.hostName });
  expect(link).toHaveAttribute('href', `/users/${mockBookingAsSpotter.hostId}`);
});
test('spotter name shown as hyperlink on host booking card', () => {
  render(<BookingCard booking={mockBookingAsHost} role="host" />);
  const link = screen.getByRole('link', { name: mockBookingAsHost.spotterName });
  expect(link).toHaveAttribute('href', `/users/${mockBookingAsHost.spotterId}`);
});
```

**Implementation:** Update `components/BookingCard.tsx` to render host/spotter name as `<Link href={/users/{id}}>` wherever booking cards appear.

---

### B6 — Search screen updates (component tests first)

**Tests first: updates to `__tests__/pages/search.test.tsx`**
```typescript
test('on initial load without destination: map centred on Brussels (50.8467, 4.3525)', () => {
  render(<SearchPage />);
  expect(mockMapbox.flyTo).toHaveBeenCalledWith(
    expect.objectContaining({ center: [4.3525, 50.8467], zoom: 13 })
  );
});
test('listings load immediately without Spotter entering destination', async () => {
  render(<SearchPage />);
  await waitFor(() => expect(screen.getAllByTestId('listing-card').length).toBeGreaterThan(0));
});
test('desktop layout: listings panel left, map right', () => {
  // Set viewport to 1280px
  const panel = screen.getByTestId('listings-panel');
  expect(panel).toHaveStyle({ order: '-1' }); // or check flex direction
});
test('Refresh map button appears after map pan', () => {
  // Simulate map moveend event
  act(() => mapInstance.fire('moveend'));
  expect(screen.getByRole('button', { name: /search this area/i })).toBeInTheDocument();
});
test('Refresh map button re-queries API with new bounding box', async () => {
  act(() => mapInstance.fire('moveend'));
  fireEvent.click(screen.getByRole('button', { name: /search this area/i }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('swLat=')
  ));
});
test('listing card shows EV icon in Gold when evCharging=true', () => {
  render(<ListingCard listing={{ ...mockListing, evCharging: true }} />);
  expect(screen.getByTestId('ev-icon')).toHaveClass('text-[#FFD700]');
});
test('listing card shows price as Gold Dark DM Sans 700', () => {
  render(<ListingCard listing={mockListing} />);
  expect(screen.getByTestId('price')).toHaveClass('text-[#B8960C]', 'font-bold');
});
test('listing card shows walking distance in minutes if >500m', () => {
  render(<ListingCard listing={mockListing} destination={{ lat: 50.85, lng: 4.35 }} />);
  expect(screen.getByTestId('distance')).toHaveTextContent('min walk');
});
test('map pin tooltip shows on pin click', async () => {
  // Simulate marker click
  act(() => mockMarker.fire('click'));
  expect(screen.getByTestId('pin-tooltip')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /view/i })).toBeInTheDocument();
});
```

**Implementation changes to `app/search/page.tsx`:**
1. Default centre: `map.flyTo({ center: [4.3525, 50.8467], zoom: 13 })` on mount.
2. Load listings on mount without requiring destination input.
3. Layout: `flex-row-reverse` on desktop (listings div `order: -1`, map div fills remaining space). Listings panel: 40% max-width, scrollable.
4. Map `moveend` listener: sets `mapMoved=true`, shows 'Search this area' button.
5. Refresh button click: calls `map.getBounds()`, extracts SW/NE coords, calls `listing-search?swLat=...&swLng=...&neLat=...&neLng=...`.
6. Pin tooltip: custom HTML popup on Mapbox marker click.
7. Update `listing-search` Lambda to accept `swLat, swLng, neLat, neLng` params in addition to existing `lat/lng/radius` approach. When bbox params provided: query all geohash cells within the bounding box instead of radius-based expansion.

---

### B7 — ListingCard component (full update)

**Full listing card content as per UC-S01 spec:**
```typescript
interface ListingCardProps {
  listing: Listing;
  destination?: { lat: number; lng: number };
  selectedPeriod?: { start: Date; end: Date };
}
```

Render:
- Primary photo thumbnail (60×60px, radius-md, Forest border 1px)
- Address (Inter 500 14px Ink, 1 line truncated)
- Spot type icon (Lucide) + label (Inter 13px Slate)
- EV charger: `<Zap className="text-[#FFD700] fill-[#FFD700]" size={16} />` + 'EV' label in Gold Dark — shown only if `evCharging=true`
- Free spots: '1 spot' badge (Mint bg + Forest text)
- Walking distance: Lucide Footprints + calculated distance. '--' if no destination set
- Star rating: gold filled stars + numeric in Gold Dark bold. Hidden if 0 reviews
- Price: `from €X.XX/hr` OR `€X.XX total` (if period selected) — always Gold Dark DM Sans 700
- 'Available from' pill: Park green — only when no dates selected

---

### B8 — Listing photo management (edit page)

**Tests first: `__tests__/pages/listing-photos.test.tsx`**
```typescript
test('renders photo grid with drag handles on hover', () => { ... });
test('primary photo (index 0) has gold star badge', () => {
  render(<ListingPhotosPage listing={mockListing} />);
  expect(screen.getByTestId('primary-badge')).toBeInTheDocument();
  expect(screen.getAllByTestId('photo-cell')[0]).toContainElement(
    screen.getByTestId('primary-badge')
  );
});
test('remove button blocked when only 1 photo remains', async () => {
  render(<ListingPhotosPage listing={{ ...mockListing, photos: [mockPhoto] }} />);
  const removeBtn = screen.getByTestId('remove-photo-0');
  expect(removeBtn).toBeDisabled();
});
test('drag and drop reorders photos and calls reorder API', async () => { ... });
test('new photo upload shows validation status inline', async () => {
  // Simulate upload → poll for validation → show green tick on PASS
  ...
});
```

**Implementation: `app/listings/[id]/photos/page.tsx`** — reachable from listing management kebab menu.

---

### B9 — Cancel booking bug fix (CancelModal.tsx)

**Tests first: `__tests__/components/CancelModal.test.tsx`** (add to existing)
```typescript
test('includes Authorization header in cancel fetch call', async () => {
  render(<CancelModal booking={mockBooking} onCancelled={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /yes, cancel/i }));
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/cancel'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Bearer /),
        }),
      })
    );
  });
});
test('setLoading(false) called in finally block — always clears spinner', async () => {
  // Mock fetch to throw error
  global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
  render(<CancelModal booking={mockBooking} onCancelled={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /yes, cancel/i }));
  await waitFor(() => expect(screen.queryByTestId('spinner')).not.toBeInTheDocument());
});
test('error message shown inline on API failure', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
  render(<CancelModal booking={mockBooking} onCancelled={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /yes, cancel/i }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
});
```

**Corrected `components/CancelModal.tsx` fetch pattern:**
```typescript
const handleCancel = async () => {
  setLoading(true);
  setError(null);
  try {
    const token = await getAuthToken(); // from Amplify Auth
    const res = await fetch(`${API_URL}/api/v1/bookings/${booking.bookingId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.ok) {
      onCancelled();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? 'Cancellation failed. Please try again.');
    }
  } catch (e) {
    setError('Network error. Please check your connection and try again.');
  } finally {
    setLoading(false); // ALWAYS clears the spinner
  }
};
```

---

## PART C — Backend: listing-search bounding box support

**Tests: add to `__tests__/listings/search.test.ts`**
```typescript
test('accepts bbox params (swLat, swLng, neLat, neLng) and queries correct geohash cells', async () => {
  // Brussels area bounding box
  const event = mockEvent({ queryStringParameters: {
    swLat: '50.82', swLng: '4.30', neLat: '50.88', neLng: '4.40'
  }});
  // Assert: DynamoDB queried for geohash cells covering that bbox
  // Assert: only listings within bbox returned
});
test('bbox search and radius search are mutually exclusive — bbox takes priority', async () => { ... });
test('availability filtering still applied on bbox results', async () => { ... });
```

**Implementation changes to `functions/listings/search/index.ts`:**
- If `swLat, swLng, neLat, neLng` present: compute all geohash cells (precision 5) that intersect the bounding box using ngeohash. Query GSI2 for each cell.
- Existing `lat, lng` radius search unchanged.
- All availability filtering logic from Session 12 still applies.

---

## PART D — CDK: new routes and secrets

Add to ApiStack (`lib/api-stack.ts`):
```typescript
// Photo management
listings.addMethod('DELETE', listingDeleteIntegration, { authorizationType: cognito });
listingsById.addResource('photos')
  .addResource('{index}')
  .addMethod('DELETE', photoDeleteIntegration, { authorizationType: cognito });
listingsById.addResource('photos')
  .addResource('order')
  .addMethod('PUT', photoReorderIntegration, { authorizationType: cognito });

// Availability
listingsById.addResource('availability')
  .addMethod('GET', availabilityGetIntegration); // public
listingsById.addResource('availability')
  .addMethod('PUT', availabilityPutIntegration, { authorizationType: cognito });

// Chat images
chatById.addResource('image-url')
  .addMethod('POST', chatImageUrlIntegration, { authorizationType: cognito });

// Public profile
users.addResource('{id}')
  .addResource('public')
  .addMethod('GET', userPublicGetIntegration, { authorizationType: cognito });
```

---

## PART E — E2E test additions (add to Session 11's Playwright suite)

Add to `e2e/journeys/`:

**`profile-and-navigation.spec.ts`**
```typescript
test('Navigation bar visible on all pages after login', async ({ page }) => {
  await loginAsSpotter(page);
  // Check nav on search, dashboard, profile pages
  for (const path of ['/search', '/dashboard/spotter', '/profile']) {
    await page.goto(path);
    await expect(page.locator('[data-testid="top-nav"]')).toBeVisible();
  }
});
test('Profile page shows role badges and summary cards', async ({ page }) => {
  await loginAsHost(page);
  await page.goto('/profile');
  await expect(page.locator('[data-testid="host-badge"]')).toBeVisible();
  await expect(page.locator('[data-testid="spotter-badge"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="spots-summary"]')).toContainText('My spots');
});
test('Clicking host name in booking navigates to public profile', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/dashboard/spotter');
  await page.click('[data-testid="host-name-link"]');
  await expect(page).toHaveURL(/\/users\//);
  await expect(page.locator('h1')).not.toContainText('@'); // no email shown
});
```

**`cancel-booking-auth.spec.ts`**
```typescript
test('Cancel booking completes without 401 error', async ({ page }) => {
  await loginAsSpotter(page);
  // Navigate to an upcoming booking
  await page.click('[data-testid="cancel-btn"]');
  await page.click('[data-testid="confirm-cancel"]');
  await expect(page.locator('[data-testid="cancel-success"]')).toBeVisible();
  // No error state
  await expect(page.locator('[data-testid="cancel-error"]')).not.toBeVisible();
});
```

**`listing-photo-management.spec.ts`**
```typescript
test('Host can upload, reorder, and delete photos', async ({ page }) => {
  await loginAsHost(page);
  await page.goto('/listings/test-listing-id/photos');
  // Upload a second photo
  await page.setInputFiles('[data-testid="add-photo-input"]', 'test-fixtures/parking.jpg');
  await expect(page.locator('[data-testid="validation-pass"]')).toBeVisible({ timeout: 15000 });
  // Verify primary badge on first photo
  await expect(page.locator('[data-testid="photo-cell"]:first-child [data-testid="primary-badge"]')).toBeVisible();
});
```

---

## PART F — theme.css replacement

Replace `styles/theme.css` entirely with the file provided in the UI/UX v2 deliverables (spotzy_claude_code_prompts_v2_updated.zip / theme.css). This is the complete CSS variable system for the Forest green + Gold palette. Key changes from previous:
- `--primary`: #006B3C (Emerald, was #059669)
- `--ring`: #FFD700 (Gold — applies gold focus ring globally)
- `--sidebar`: #004526 (Forest green)
- New: `--gold`, `--gold-dark`, `--gold-mid`, `--gold-soft`, `--forest`
- New utility classes: `.shadow-gold`, `.btn-gold`, `.price`, `.price-large`, `.nav-forest`

After replacing theme.css, run the full unit and component test suites to catch any colour-dependent test assertions that need updating.
