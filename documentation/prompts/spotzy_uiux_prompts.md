# Spotzy UI/UX v7 — Claude Code Implementation Prompts

> **Source**: `spotzy_uiux_v7.docx` — the full design charter and per-UC screen specs.
> **Approach**: 8 prompts in dependency order. Each prompt is self-contained — paste it into Claude Code as-is. Each references the design tokens from Part 1 of the spec.
> **Prerequisite**: the CLAUDE.md supervisor file is in the repo root so Claude Code has the full architecture context.

---

## Prompt 1 — Design System Foundation

**Scope**: Part 1 of the UIUX spec. CSS custom properties, typography, component library, motion system.

```
Read spotzy_uiux_v7.docx Part 1 (Design Charter). Implement the full design system foundation:

1. THEME: Create/update frontend/src/styles/theme.css with ALL CSS custom properties from §1.2 (both light and dark mode values). Key colours: --primary=#006B3C (Emerald), Forest=#004526, Brick=#AD3614, Ink=#1C2B1A, Sage=#EBF7F1, Mint=#B8E6D0, Mist=#EFF5F1. Include --brick, --brick-light, --brick-mid, --brick-border variables (new).

2. TYPOGRAPHY: Configure DM Sans (display/headings, 600-700), Inter (body, 400-600), JetBrains Mono (codes/refs). Add @font-face or Google Fonts import. Map the type scale from §1.3: Display=32-48px, H1=24px, H2=20px, H3=16px (Brick colour #B8960C), Body=15px, Caption=13px, Price=20-32px Forest bold, Button=14-15px DM Sans 600, Code=13px JetBrains Mono.

3. SPACING: Add spacing tokens from §1.5 as CSS vars or Tailwind config: space-1(4px) through space-8(48px), radius-sm through radius-xl, shadow-sm through shadow-forest and shadow-brick (green-tinted and brick-tinted shadows).

4. COMPONENTS — create reusable components in frontend/src/components/ui/:
   - Button: 8 variants from §1.6 (Primary Forest, Primary Emerald, Primary Park, Brick, Secondary, Outline Forest, Outline Brick, Disabled). Primary Forest is highest-weight CTA — max one per screen.
   - Card: Mist or White bg, radius-lg, shadow-sm→shadow-md on hover. Left border accent variants (Forest, Emerald, Brick, Concrete, Mint, Red) from the card type table.
   - StatusBadge: 10 variants (Available, Booked, Pending, Completed, Cancelled, Disputed, Draft, Live, Under review, Archived) with exact bg/text/border colours from §1.6.
   - FormInput: 4 states (default, hover, focus, error, disabled) from §1.6 form inputs table. Sage bg, emerald focus ring.

5. MOTION: Implement the global grow/shrink rule from §1.7.
   .grow { transition: transform 1.5s cubic-bezier(0.34,1.56,0.64,1) 0.5s, box-shadow 1.5s ease 0.5s; }
   .grow:hover { transform: scale(1.045); }
   .grow:not(:hover) { transform: scale(1); transition-delay: 0s; }
   Button scale=1.07, card scale=1.045, chip scale=1.06. Active/press: scale(0.97) at 100ms (bypasses delay).
   Page enter: fade + 20px slide up, 600ms ease-out.
   All animations respect prefers-reduced-motion → 150ms simple fades.

6. ICONS: Configure Lucide Icons (outline, 1.5px stroke, 20px default). Map pin colours: Forest=available, Brick=selected, Slate=limited, Red=unavailable. Star ratings: Park green filled, Concrete unfilled.

7. ACCESSIBILITY: Verify all contrast ratios from §1.8 pass WCAG AA. Focus ring: 3px emerald at 20% opacity on all interactive elements. Touch targets: 44×44px minimum.

Apply the theme to the existing app shell. Every existing component should pick up the new tokens. Don't change business logic — design system only.
```

---

## Prompt 2 — Navigation + Auth Screens

**Scope**: Top bar, bottom tabs, UC-A01 (Host registration), UC-A02 (Guest registration), UC-A03 (booking intent preservation), UC-H18/H19 (List Your Spot / Become a Host interstitial).

```
Implement the navigation and auth screens from spotzy_uiux_v7.docx:

NAVIGATION (§ Navigation — Top Bar):
- Desktop: Forest green (#004526) full-width top bar. Logo = circular forest green icon with white P lettermark, 360° spin on hover (0.68s spring). Wordmark "Spotzy" in DM Sans 700 beside it. Nav links = white text, brick red underline on active, mint fill on hover. Messages = Lucide MessageCircle, brick red unread badge. Profile = white avatar circle, top right.
- Mobile: White bottom tab bar, 64px height, Forest 1px top border. Tabs left→right: Search, Bookings, Messages, Profile. Active = brick red underline + Forest label. Inactive = Slate. Icons 24px, labels Inter 11px.
- Unauth desktop: 'Sign in' ghost white + 'Register' small Emerald button.
- Messages badge: brick red filled circle (#AD3614) with white count, '9+' for >9.

UC-A02 GUEST REGISTRATION:
- Step 1 (persona): 3 large cards (Host, Guest, Spot Manager). Selected: Forest bg + white text + checkmark. Spot Manager: Concrete bg + 'Coming soon' brick badge.
- Step 2 (profile): White card max 440px, Forest border inputs, emerald focus rings. Fields: first name, last name (mandatory), pseudo (optional with helper text), email, phone + country code dropdown (+32 default), password.
- Step 3 (OTP): 6 input boxes, Forest border, emerald focus on active, auto-advance on digit entry.
- Step 4 (photo upload): 120px circular placeholder with Camera icon, 'Upload a photo' Forest CTA, 'Skip for now' ghost link.

UC-A01 HOST REGISTRATION:
- Same as Guest but intercepts after persona selection with Stripe Connect screen.
- Stripe gate: White card max 480px, 64px Forest icon with 360° spin, heading 'Set up your payout account' Forest, 'Continue to Stripe' Primary Forest CTA. 'Powered by Stripe Connect' note in 12px Muted.
- Return success: Park green flash + 'Payout account connected ✓' Mint badge above profile form.
- Return abandoned: Brick-bordered banner 'Payout setup incomplete'.
- Post-registration: Host+Stripe → /listings/new. Host+abandoned → /dashboard/guest.

UC-A03 BOOKING INTENT PRESERVATION:
- On unauthenticated 'Book this spot' tap: redirect to /auth/login?next=checkout&listingId={id}&start={}&end={}.
- Summary strip pinned above login/register form: 72px height, Sage bg, Forest 2px left border, listing photo 48×48, address, dates, price.
- Post-login redirect: instant to /checkout. Intent expired: redirect /search + Forest green toast (4s auto-dismiss).

UC-H18 LIST YOUR SPOT CTA: Emerald CTA in nav. Unauth → register with Host pre-selected. Guest-only → UC-H19. Host → /listings/new.

UC-H19 BECOME A HOST INTERSTITIAL: Full-screen card max 480px, Forest host icon with spin-360, 'Become a Host' heading, 'Set up payouts' Primary Emerald CTA. No skip — Stripe mandatory.

ROLE BADGES: Guest badge always active. Host badge activates on stripeConnectEnabled=true. Both shown simultaneously. Forest bg for Host, Emerald bg for Guest.
```

---

## Prompt 3 — Search + Map + Filters

**Scope**: UC-S01 (search screen), UC-S02 (filter panel), listing card component.

```
Implement the search screen from spotzy_uiux_v7.docx:

UC-S01 SEARCH SCREEN:
- Default centre: Brussels Grand Place (50.8467, 4.3525), 2km radius.
- Desktop: listings panel LEFT (40%) + Mapbox map RIGHT (60%).
- Mobile: full-screen Mapbox map + draggable bottom sheet for listing list.
- Map style: Mapbox light-v11.

Search bar (floating top):
- White pill, Forest green border, emerald focus ring, Lucide Search icon in Forest.
- Mapbox Geocoding autocomplete, debounced 300ms. Suggestions: white dropdown, Emerald left accent on hover.
- Date/time row: two compact pills (start/end). Active: Forest border + emerald ring. Selected: Mint fill.
- Filter button: Lucide SlidersHorizontal, Slate. When active: Forest bg + white icon + count badge.

Map pins:
- Custom SVG circles 32px. Forest=#004526 available, Brick=#AD3614 selected (scales to 40px + Forest shadow), Slate=#4B6354 limited, Red=#DC2626 booked.
- Clusters: Forest circle + white count label.
- 'Search this area' button: white pill + Forest border + Lucide RefreshCw, appears after pan/zoom.

Pin tooltip: White card, radius-lg, shadow-md, Forest 4px top border. Photo 60×60, address, type icon, price Forest bold, stars Park green, 'View' small Emerald CTA.

LISTING CARD (in list panel):
- Photo 60×60 thumbnail, radius-md, Forest 1px border.
- Address: Inter 500 14px Ink, 1 line truncated.
- Type: Lucide icon Forest + Inter 13px Slate label.
- EV badge: Park green Zap + 'EV' in Forest (only if evCharging=true).
- Free spots: Mint bg + Forest text badge.
- Walking distance: Lucide Footprints Slate + distance label.
- Stars: Park green filled + average Forest bold (hidden if 0 reviews).
- Price: "from €X.XX/hr" in Forest DM Sans 700. With period selected: "€X.XX total" in 20px.
- Host footer: 28px avatar (Forest ring) + "by Jean D." Inter 13px Slate. Clickable → /users/{hostId}. Hidden on own listings.

UC-S02 FILTER PANEL:
- Mobile: bottom sheet 70%. Desktop: right sidebar 360px fixed.
- Header: Forest bg, white 'Filters' title, white × close.
- Spot type chips: Mint bg + Forest border → selected: Forest bg + white text + checkmark.
- Price range: dual-handle slider, Forest track, Forest handles.
- Feature toggles: Forest green switches, emerald ring on focus.
- 'Apply filters' Primary Forest full-width with count: 'Show 14 spots'.
- 'Clear all': ghost Slate, top-right.
```

---

## Prompt 4 — Listing Wizard (Host)

**Scope**: UC-H01 (create listing), UC-H02 (availability), UC-H04 (publish), UC-H05 (edit availability), UC-H15 (remove/archive), UC-H16 (edit photos).

```
Implement the listing creation and management screens from spotzy_uiux_v7.docx:

UC-H01 CREATE LISTING — 4-step wizard:
- Progress bar: thin Forest green line filling left-to-right.

Step 1 Location: Full-width Mapbox Geocoding autocomplete. Forest border on focus + emerald ring. Dropdown: white card, Forest left accent on hover, Emerald checkmark selected. Confirmed: mini Mapbox static map 240px, Forest pin, Forest border. 'I can't find my address' ghost link in Slate.

Step 2 Spot details: 4 icon tiles for spot type. Default: Sage bg, Forest border. Selected: Forest bg, white icon, thin brick inner ring. Dimensions toggle (Standard/Large): pill toggle, active=Emerald bg+white, inactive=Mist+Slate. EV toggle same pattern, Park green Zap on Yes. Description textarea: Sage bg, emerald focus ring, Forest char counter.

Step 3 Photos: Min 1, max 5. Dashed border cards: Concrete default → Emerald on drag → Forest when photo present. AI states: spinner(Slate) → green tick 'Looks good'(Park) → amber warning → red × + reason. First photo: brick crown badge 'Primary'. Drag reorder: Forest shadow + scale 1.3. Drop target: dashed Brick border.

Step 4 Availability & pricing: ALWAYS toggle (large pill, Forest bg+white+checkmark). Weekly grid: selected cells = Mint bg + Emerald border. Time inputs below. Price inputs: brick red left border accent on price fields. 'Save as draft' secondary. 'Publish' Primary Forest.

States: Loading geocode=Emerald spinner. Photo AI fail=Red border+×+reason. Photo review=Brick border+amber clock. Form incomplete=disabled CTA+tooltip. Draft saved=Forest green toast+white checkmark.

UC-H02 AVAILABILITY: ALWAYS/WEEKLY mode toggle cards (active=Forest bg+white+checkmark). Weekly grid: 7 day columns in Forest. Multiple slots: 'Add time slot' Emerald link, Mint left accent per slot. Overlap error: red dashed + inline error. 14-day preview: Mint/Park=available, Forest=booked, Mist=unavailable. 'Save schedule' Primary Emerald.

UC-H04 PUBLISH: Checklist: Forest tick (complete) / Red × (incomplete with deep-link). 'Go live' Primary Forest, activates when all checked. Success animation: map pin draws in Forest → fills brick ring → 'Your spot is live!' Forest DM Sans 700 32px.

UC-H15 REMOVE/ARCHIVE: Kebab menu (⋮) ghost button Slate. Items: Edit/Photos/Availability in Forest, divider, 'Remove listing' Red. Delete modal: red warning icon, 'Permanently delete?' Red heading, Red CTA. Archive modal: Brick Light bg, brick border, Forest archive icon, 'Archive instead?' Brick heading, Forest CTA. Archived: 50% opacity, Concrete badge, 'Unarchive' Emerald link.

UC-H16 EDIT PHOTOS: 2-col mobile, 3-col desktop grid. Forest 1px border, radius-lg. Hover: drag handle top-left, red × top-right. Primary: brick crown badge. Drag: Forest shadow + scale 1.3. Add zone: dashed Concrete → Emerald on hover. 'Save changes' Primary Emerald (only when changes pending).
```

---

## Prompt 5 — Booking Flow + Cancellation

**Scope**: UC-S04 (booking flow), UC-S06 (cancel booking), UC-S07 (rate host).

```
Implement the booking flow screens from spotzy_uiux_v7.docx:

UC-S04 BOOKING FLOW — 3 steps:
Step indicator: 3 pills (Review · Payment · Confirmation). Active: Forest bg + white text. Completed: Emerald bg + white checkmark. Pending: Mist + Slate.

Step 1 Review:
- Spot summary card: Forest 4px left accent, white body, photo thumbnail left.
- Price breakdown table: subtotal in Ink, '15% platform fee' in Slate italic, 'Total' in DM Sans 700 Forest — brick top border separator.
- Cancellation policy: Brick Light info box, Brick text, brick info icon.
- 'Proceed to payment' Primary Emerald full-width.

Step 2 Payment:
- Stripe Elements card form: Forest border, emerald focus ring.
- Order summary: collapsed accordion mobile, sidebar desktop. Total in DM Sans 700 Forest.
- 'Pay €X.XX' Primary Forest full-width, shadow-forest glow on hover.

Step 3 Confirmation:
- Map pin animation: draws in Forest → brick red ring pulse → subtle confetti (Forest + Brick). 600ms.
- 'You're all parked!' DM Sans 700 32px Forest.
- Booking ref: JetBrains Mono, Forest bg, white text, radius-md.
- Quick actions (secondary): Get directions, Message host, Add to calendar.
- 'View booking' Primary Emerald.

UC-S06 CANCEL BOOKING:
- Modal: bottom sheet mobile, 480px centred desktop.
- Refund amount: DM Sans 700 28px Park green (positive) or Slate (none). Most prominent.
- Countdown timer (within 48h): red pill with urgency.
- 'Yes, cancel my booking' full-width Destructive Red (requires deliberate gesture).
- 'Keep my booking' ghost Forest green — clearly the safe option.
- Auth error state: red inline banner + 'Try again' Emerald. Loading spinner always clears in finally block.

UC-S07 RATE HOST: Same pattern as UC-H10. 4 sections. Stars: Park green filled, Concrete unfilled, bounce + fill on tap. Submit: Primary Forest (activates when ≥1 section rated). Success: all stars fill Park green with scale-up sweep left-to-right.
```

---

## Prompt 6 — Chat + Messages + Disputes

**Scope**: UC-H09 (chat with guest), UC-S09 (messages section), UC-H10 (rate guest), UC-H11 (dispute).

```
Implement chat and messaging screens from spotzy_uiux_v7.docx:

UC-H09 / UC-S09 CHAT:
- Full-screen mobile, right panel desktop.
- Booking context banner: Forest bg, white text, 48px, pinned at top.
- Host messages (right): Forest bg, white text, radius-lg flat bottom-right.
- Guest messages (left): Mist bg, Ink text, radius-lg flat bottom-left.
- Timestamps: Inter 11px Slate.
- Image thumbnails: 200px max width, Forest 1px border, brick border on hover.
- Input bar: Sage bg, Forest send button (Lucide Send white).

UC-S09 MESSAGES SECTION (/messages):
- Desktop: conversation list LEFT (400px) + chat thread RIGHT.
- Mobile: list view OR thread view (single column).
- Header: 'Messages' DM Sans 700 Forest. Unread count '(3)' if present.

Conversation list item (72px height):
- Left: avatar 40px circle Forest ring. Right of avatar: two lines.
- Line 1: spot address Inter 500 14px Ink (left) + relative timestamp Inter 12px Slate (right).
- Line 2: other party name Inter 500 13px Slate + last message preview Inter 400 13px Muted (truncated).
- Unread: brick red circle on avatar top-right, white numeral.
- Hover: Sage bg fill 0.3s.
- Thin Sage dividers between rows.
- 'View archived conversations →' Inter 13px Emerald pinned at bottom.
- Empty state: Forest speech bubble SVG, 'No active conversations' DM Sans 600 Forest, CTA: 'Find a spot' or 'View your listings' Emerald.

States: Unread = brick badge + nav icon badge, clears on open. New message = row slides to top (smooth reorder). Deep-linked from booking = opens thread directly, back → booking card.

UC-H10 RATE GUEST:
- Modal: bottom sheet mobile, 480px desktop.
- 3 sections: Communication, Respect of rules, State.
- Stars: Lucide Star, unfilled=Concrete, filled=Park green, tap=bounce+fill.
- Submit: Primary Forest (activates on ≥1 rated).
- Success: all stars fill Park green simultaneously, scale-up sweep left-to-right.

UC-H11 DISPUTE:
- Full-screen mobile, 560px centred desktop.
- Forest green tinted overlay (rgba(0,69,38,0.05)) signals support mode.
- 'Spotzy Support' header: Forest shield icon, DM Sans 600 Forest.
- AI messages: Brick Light bg, Brick text.
- User messages: Sage bg, Ink text.
- Quick reply chips: Mint bg, Forest text, Emerald border on hover. Tap: Forest bg, white text.
- Reference number: JetBrains Mono, Forest bg, white text.
```

---

## Prompt 7 — Profile + Dashboards + Backoffice

**Scope**: UC-H14 (profile), UC-H17 (public profile), UC-H12 (payouts), UC-ID01 (user identity), UC-QA01 (quick access cards), UC-BO01/02/03 (backoffice), UC-GDPR01/02/03.

```
Implement profile, dashboard, and backoffice screens from spotzy_uiux_v7.docx:

UC-H14 PROFILE (/profile):
- Photo: 80px circle, Forest 2px ring. Tap to upload.
- Name: DM Sans 700 20px Forest. Member since in Slate. Role badges below.
- Summary cards: 'My spots' (Mint bg, Forest accent, count, 'View listings →' Emerald). 'My bookings' (Sage bg, Emerald accent).
- Edit: read-only rows with pencil icon (Slate). Tap → inline input Forest border + emerald ring.
- Payment: emerald credit card icon + 'Manage via Stripe' Emerald → external.
- Privacy section (collapsible): 'Download my data' Forest outline, 'Delete my account' Brick outline at very bottom.
- 'Log out' destructive outline red, bottom with generous margin.

UC-ID01 USER IDENTITY:
- Registration: pseudo field optional, helper text 'This is what other users will see'. If blank: 'We'll use your first name'.
- Profile page: pseudo editable (DM Sans 700 Forest). Full name editable (Inter 400 Slate). Toggle 'Show my full name on my public profile' Forest switch, default OFF.
- Avatar: photo in Forest 2px ring. No photo: first letter of pseudo, DM Sans 700 white on Forest circle. Sizes: 80px profile, 40px messages, 28px listing footer, 36px booking card.

UC-H17 PUBLIC PROFILE (/users/{id}):
- Full-screen mobile, max 600px desktop.
- Photo 80px Forest ring. Name 'Jean D.' DM Sans 700 Forest. Member since Slate. Badges.
- Trust bar: 3 stat chips (rating, bookings, response rate) Sage bg, Forest text, grow on hover.
- Host sections: rating breakdown (4 bars Emerald on Mist), active listings grid (2-col cards), reviews (Park green stars, Slate text).
- Guest sections: rating breakdown (3 bars), reviews.

UC-H12 PAYOUTS: Prompt card (no banking): Brick Light bg, brick border, 'Set up payouts to start earning' Brick + Forest CTA. Post-setup: Park tick + 'Payout account connected' Forest + bank name. History table: alternating White/Mist rows, Forest bold amounts.

UC-QA01 QUICK ACCESS CARDS:
- Landing page hero, below search bar, above fold. 3 cards horizontal, gap 16px (stack <480px).
- Sage bg, radius-lg, Forest border on hover, grow animation.
- Icon: Lucide in Forest 44×44px circle, wiggle on hover. Label: DM Sans 600 15px Ink.
- Unauth: Search/Sign in/Create account. Guest: Search/List your Spot (brick Car icon)/My Bookings. Host: Search/Add a listing/My Bookings.
- Switches on auth state change (SWR-cached users/me).

UC-BO01 BACKOFFICE DISPUTE DASHBOARD: /backoffice. Forest nav 'Spotzy Admin'. Dispute cards: white, radius-lg. Unread: Brick 4px left border + 8px brick dot. AI summary: Brick Light bg, Brick border. Resolution panel: dropdown + refund input + Forest CTA.

UC-BO02 CUSTOMER LIST: Full-width table. Search: Lucide Search Forest. Filter chips: All/Hosts/Guests/Has disputes/Suspended. Active=Forest bg+white. Table header: Forest bg white labels.

UC-BO03 CUSTOMER PAGE: Large avatar 80px, full name DM Sans 700 Forest. Listings/Bookings sections with 'Show history' toggle. Admin booking detail: read-only chat + dispute accordion.

UC-GDPR01 ACCOUNT DELETION: 'Delete my account' Brick outline at bottom of profile. Blocking state: Brick Light banner with active booking cards. Confirmation: modal max 560px, 'Delete your account' Forest heading, type-email-to-confirm input, 'Confirm permanent deletion' Brick CTA.

UC-GDPR02 DATA EXPORT: 'Download my data' Forest outline. Loading: spinner + 'Preparing...'. Ready: 'Download ready' Emerald link (24h valid). Large: Forest toast 'We'll email you'.

UC-GDPR03 PRIVACY: Registration: 'By creating an account you agree to our Privacy Policy' Forest link below form. /privacy: static page, Forest headings, Ink body. Profile privacy section: download + delete + privacy link + 'Privacy policy accepted: date (version)' Slate.
```

---

## Prompt 8 — Empty States + Error States + UAT Fixes + Responsive

**Scope**: Empty states, error/offline states, UAT fix specs, responsive breakpoints.

```
Implement remaining UI patterns from spotzy_uiux_v7.docx:

EMPTY STATES (6 screens):
- Search no results: parking sign + magnifying glass Forest green. 'Expand search area' Emerald CTA.
- Host no listings: garage door brick + icon. 'List your first spot' Primary Forest CTA.
- Bookings none: calendar + Forest leaf. 'Find a spot' Emerald (Guest) or 'Share your listing' Emerald (Host).
- Messages none: Forest speech bubble + clock. Informational only, no CTA.
- Notifications none: Forest bell + brick check. No CTA.
- Profile no reviews: Park green star outline, 'No reviews yet'. No CTA.

ERROR & OFFLINE STATES:
- Network error: Forest bg full-screen, white broken map pin illustration, 'Check your connection', Emerald retry.
- Server 500: Brick Light card, 'Something went wrong on our end', Emerald retry.
- Session expired: modal Forest header + white body, 'Please log in again', Emerald 'Log in'.
- Payment error: red inline error below Stripe form with Stripe error message.
- Spot taken: red banner 'This spot was just taken' + 'Find alternatives' Emerald.
- Outside availability: Brick Light card, available windows as Forest time chips, 'Choose another time' Emerald.

UAT FIXES — implement ALL of these:
- #01/#02: Booking cards read status from API. CONFIRMED=Emerald badge, ACTIVE=Park green, COMPLETED=Concrete.
- #03: Host booking cards show Guest "Jean D." as clickable link to /users/{id}.
- #04: Chat header shows other party name, clickable to /users/{id}.
- #05: Chat message area dynamic height, max 80vh, scroll at bottom, min 20% viewport.
- #06: Phone input split: country code dropdown (flag+dial code, default +32) + number field.
- #08: Back arrow + 'Back to bookings' pinned top-left of chat.
- #09: Booking detail reads dates from URL params (ISO 8601) or API, never browser history state.
- #12: Start time disabled when ACTIVE. Tooltip 'Start time cannot be changed once booking is active'.
- #13: End time enabled when ACTIVE. 'No refund applies' notice (Brick Light, Brick text) before confirm.
- #14: Listing card photos from primaryPhotoUrl. Fallback: Forest gradient + ParkingCircle icon.
- #15/#28: Spot type always human-readable: COVERED_GARAGE='Covered garage', etc. Global spotTypeDisplay util.
- #16: Mapbox autocomplete: dismiss dropdown on selection. onSelect: set value, close, blur.
- #17: 'Get directions' button removed from booking confirmation.
- #22: EV toggle (Yes/No pill) in listing wizard Step 2. Park green + Zap icon on Yes.
- #23: Host listing management: full edit access to all fields, not just availability.
- #24: Host listing card has 'View listing' Emerald link → /listing/{id}.
- #25: Nav links filtered by persona. Guest-only: Search/Bookings/Messages/Profile. Host: Dashboard/Listings/Messages/Profile.
- #26: 'Create account' hover = Sage bg + Emerald border (NOT dark Forest fill).
- #29/#30: EV badge + row spacing (gap-2) on listing cards.
- #31: Email + phone fields on profile page, editable inline with country code dropdown.
- #32/#33: Invoicing section: VAT number, company name, billing address. Optional but prompted for Hosts.

RESPONSIVE BREAKPOINTS:
- Mobile S (320-374): condensed type, single column, bottom sheets for modals, Forest status bar tint iOS.
- Mobile M (375-767): default mobile layout.
- Tablet (768-1279): 2-col grids, top nav replaces bottom nav, modals max 560px.
- Desktop (1280+): split views (list+map for search, booking+chat side-by-side). Forest top nav. Left panel max 480px.
```

---

## Implementation order

```
Prompt 1 → design system foundation (no business logic, just tokens + components)
Prompt 2 → navigation + auth (app shell, login/register flows)
Prompt 3 → search + map (core discovery experience)
Prompt 4 → listing wizard (host creation flow)
Prompt 5 → booking flow (core transaction)
Prompt 6 → chat + messages (communication)
Prompt 7 → profiles + dashboards + backoffice (management screens)
Prompt 8 → polish: empty states, errors, UAT fixes, responsive
```

Each prompt builds on the previous one's components. Prompt 1 must be done first — everything else depends on the design tokens and base components.
