# Session 07 — Frontend: Scaffold + Search Screen (tests first)

## What this session does
Sets up Vitest + React Testing Library + MSW, writes component tests for the search screen, then implements the components.

## Feed to Claude Code
This file only.

---

## Test setup (create once)

**`frontend/vitest.config.ts`**
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: { provider: 'v8', thresholds: { branches: 75, functions: 85, lines: 85 } },
  },
});
```

**`frontend/src/__tests__/setup.ts`**
```typescript
import '@testing-library/jest-dom';
import { server } from './mocks/server';
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

**`frontend/src/__tests__/mocks/server.ts`** — MSW server with handlers for all API routes:
```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

export const server = setupServer(
  http.get('/api/v1/listings/search', () => HttpResponse.json({
    listings: [
      { listingId: 'l1', address: 'Rue Neuve 1, Brussels', spotType: 'COVERED_GARAGE',
        pricePerHour: 3.50, addressLat: 50.850, addressLng: 4.352,
        covered: true, avgRating: 4.5, status: 'LIVE' },
    ],
    total: 1,
  })),
  http.get('/api/v1/listings/:id', ({ params }) => HttpResponse.json({
    listingId: params.id, address: 'Rue Neuve 1, Brussels',
    spotType: 'COVERED_GARAGE', pricePerHour: 3.50,
    covered: true, avgRating: 4.5, status: 'LIVE', photos: [],
  })),
);
```

---

## Component tests — SearchBar

### Tests first: `__tests__/components/SearchBar.test.tsx`

**Rendering:**
- Renders destination input field
- Renders date/time inputs
- Renders filter button with funnel icon

**Autocomplete:**
- User types 3+ characters → Mapbox Geocoding API called (mock the fetch)
- Suggestions dropdown appears with returned results
- Selecting a suggestion → `onDestinationSelect` callback called with `{ label, lat, lng }`
- Typing fewer than 3 chars → no API call

**Filter button:**
- Clicking filter button → `onFilterOpen` callback called
- Active filter count badge shown when `activeFilterCount > 0`
- Badge not shown when `activeFilterCount === 0`

**Date inputs:**
- End date cannot be before start date (validation)
- Changing dates → `onDatesChange` callback called

---

## Component tests — FilterPanel

### Tests first: `__tests__/components/FilterPanel.test.tsx`

**Rendering:**
- Renders all filter sections: Availability, Price, Spot type, Features
- Renders 4 spot type chips
- "Apply filters" button shows result count: "Show N spots"

**Interactions:**
- Selecting spot type chip → chip gets selected state (amber border)
- Selecting same chip again → deselects it (toggle behaviour)
- Price range slider → min/max values update
- "Clear all" → all filters reset to defaults, `onClear` callback called
- "Apply filters" → `onApply` callback called with current filter state

**State:**
- Can select multiple spot type chips simultaneously
- Selecting "Privately owned" feature toggle → it becomes active

---

## Component tests — SpotMap (mock Mapbox)

### Tests first: `__tests__/components/SpotMap.test.tsx`

```typescript
// Mock Mapbox GL JS — it requires canvas which jsdom doesn't support
jest.mock('mapbox-gl', () => ({
  Map: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    addSource: jest.fn(),
    addLayer: jest.fn(),
    flyTo: jest.fn(),
    remove: jest.fn(),
  })),
  Marker: jest.fn().mockImplementation(() => ({
    setLngLat: jest.fn().mockReturnThis(),
    addTo: jest.fn().mockReturnThis(),
    remove: jest.fn(),
  })),
  Popup: jest.fn().mockImplementation(() => ({
    setLngLat: jest.fn().mockReturnThis(),
    setHTML: jest.fn().mockReturnThis(),
    addTo: jest.fn().mockReturnThis(),
  })),
}));
```

**Tests:**
- Renders map container div
- Receives `spots` prop → creates a marker for each spot
- Spot clicked → `onSpotSelect` callback called with the spot object
- `selectedSpotId` prop → the selected marker has navy colour class

---

## Component tests — SpotSummaryCard

### Tests first: `__tests__/components/SpotSummaryCard.test.tsx`

**Rendering:**
- Renders spot address
- Renders price (€X.XX/hr format)
- Shows covered badge when `covered=true`
- Does NOT show covered badge when `covered=false`
- Shows walking distance when `walkingDistance` prop provided (e.g. "5 min walk")
- Shows star rating

**Interactions:**
- "Book this spot" button click → navigates to `/listing/{listingId}`
- Entire card click → same navigation

---

## Search page integration test

### Tests first: `__tests__/pages/search.test.tsx`

**Initial render:**
- Search bar renders
- Map renders (mocked)
- Results list is empty initially

**After search:**
- User enters destination and submits → API called with lat/lng
- Listing cards render from API response
- Loading state shown while fetching

**Filter integration:**
- User opens filter panel, selects "Covered" → filter applied, API re-called with `covered=true`

---

## Implementation (after all tests written and confirmed failing)

Build the following in order, making tests pass:

1. `app/layout.tsx` — root layout with fonts, AuthProvider, Navigation, Toast provider
2. `components/SearchBar.tsx`
3. `components/FilterPanel.tsx`
4. `components/SpotMap.tsx` — Mapbox GL JS integration
5. `components/SpotSummaryCard.tsx`
6. `app/search/page.tsx` — assembles all components, manages search state
7. `app/page.tsx` — static home/marketing page (SSG)
8. `lib/api.ts` — authenticated fetch wrapper
9. `lib/mapbox.ts` — Mapbox geocoding + directions helpers

Apply the Spotzy design system throughout:
- Colors: `--navy: #1A3C5E`, `--amber: #E8A020`, `--green: #1E8A5E`, etc.
- Fonts: DM Sans (headings), Inter (body), JetBrains Mono (codes)
- Shadows: shadow-sm at rest, shadow-md on hover
- Border radius: radius-lg (16px) for cards
