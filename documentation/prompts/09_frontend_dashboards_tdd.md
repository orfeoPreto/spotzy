# Session 09 — Frontend: Dashboards (TDD)

## What this session does
Component tests first, then implementation for Host and Guest dashboards.

## Feed to Claude Code
This file only.

---

## Component tests — Host Dashboard

### Tests first: `__tests__/pages/host-dashboard.test.tsx`

**Metrics row:**
- Renders 4 metric cards: Active bookings, MTD earnings, Live listings, Avg rating
- Values populated from API response
- Loading skeleton shown while fetching

**Listings section:**
- Empty state shown when no listings → "Add your first spot" CTA renders
- Listing card renders with address, status badge, booking count
- Status badge: LIVE = green, DRAFT = grey, UNDER_REVIEW = amber

**Booking cards:**
- Shows upcoming bookings with guest name and dates
- "Message guest" link renders correctly
- Amber warning banner shown for bookings ending within 24h

---

## Component tests — Listing creation wizard

### Tests first: `__tests__/pages/listing-wizard.test.tsx`

**Step navigation:**
- "Next" button disabled until current step is valid
- Can navigate back to previous step
- Step indicator shows current step

**Step 1 — Location:**
- Address input renders
- Selecting a geocoding result → mini map updates, "Next" activates

**Step 2 — Spot details:**
- Spot type tiles render (4 tiles)
- Selecting a tile → amber border appears
- No tile selected → "Next" button disabled
- Price input: no price entered → "Next" disabled

**Step 3 — Photos:**
- Two upload zones render
- Uploading a file → thumbnail shown
- PASS validation status → green tick shown
- FAIL validation status → red × + reason text shown
- "Next" disabled until both photos have PASS status

**Step 4 — Availability:**
- Weekly grid renders
- Tapping a cell → cell fills green
- "Publish listing" button shown
- Pre-publish checklist shows all items as ticked

---

## Component tests — Guest Dashboard

### Tests first: `__tests__/pages/guest-dashboard.test.tsx`

**Tabs:**
- "Upcoming" tab active by default
- Switching tabs → shows correct bookings

**Booking card:**
- Shows address, dates, total paid, status badge
- "Modify" and "Cancel" buttons shown on upcoming bookings
- "Leave a review" CTA shown on completed bookings without a review

**Rating modal:**
- Opens on "Leave a review" click
- 4 star sections render
- Clicking 4 stars on first section → 4 stars fill amber
- "Submit rating" disabled until ≥2 sections rated
- After submit → modal closes, "Leave a review" CTA disappears

---

## Component tests — Cancel booking modal

### Tests first: `__tests__/components/CancelModal.test.tsx`

**Rendering:**
- Shows refund amount prominently in green
- Shows "€0.00 refund" in grey when no refund applies
- Countdown timer shown when within 48h of start time
- "Yes, cancel" and "Keep my booking" buttons both render

**Interactions:**
- "Keep my booking" → modal closes, no API call
- "Yes, cancel" → API call made, success state shown
- During API call → spinner shown, buttons disabled

**Refund display accuracy:**
- `refundAmount=7.00` → "€7.00 refund" shown
- `refundAmount=3.50` → "€3.50 refund" shown
- `refundAmount=0` → "No refund applies" shown

---

## Component tests — Modify booking modal

### Tests first: `__tests__/components/ModifyModal.test.tsx`

**Rendering:**
- Two options: "Change start time" / "Change end time"
- Time picker shown after selecting an option
- Price difference badge shown when time changes

**Price difference badge:**
- New duration longer → "+€3.50" in amber
- New duration shorter → "−€3.50 refund" in green
- Same duration → no badge

---

## Implementation (after all tests confirmed failing)

Build in order:

1. `app/dashboard/host/page.tsx`
2. `app/listings/new/page.tsx` — 4-step wizard
3. `app/dashboard/guest/page.tsx`
4. `components/RatingModal.tsx`
5. `components/CancelModal.tsx`
6. `components/ModifyModal.tsx`
7. `components/BookingCard.tsx` — shared between dashboards
8. `components/StatusBadge.tsx`
