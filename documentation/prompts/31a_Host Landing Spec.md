# Session 31 — Host-centric pre-launch landing page

**Goal:** Replace the current spotter-intent landing (`app/[locale]/page.tsx` → `PreLaunchPageClient.tsx` / `page.full.tsx`) with a **host acquisition landing page** that matches the design in `Spotzy Visual Rehaul.html` (landing-desktop + landing-mobile artboards).

**Scope:** frontend only. No backend changes except (optionally) a lightweight lead-capture endpoint; otherwise the form posts to `/auth/register?intent=host` with prefilled params.

**Primary CTA:** convert visitors into **pre-launch host leads** (email + zip + parking type).

**Locales:** `fr-BE` (primary), `nl-BE`, `en` — all three live day one per localization runtime (Session 29).

---

## 1. What this replaces

| Today | After Session 31 |
|---|---|
| `app/[locale]/page.tsx` dynamically loads `page.full.tsx` (spotter-intent: "Trouvez un parking. Rapidement.") OR `PreLaunchPageClient.tsx` (depending on feature flag) | A single new `HostLandingClient.tsx` is loaded for **unauthenticated visitors** during pre-launch. Authenticated users continue to their dashboard. The old `page.full.tsx` spotter landing and `PreLaunchPageClient.tsx` are retired (moved to `_legacy/` folder, not deleted — may return post-launch). |

**Routing logic** in `app/[locale]/page.tsx`:

```
if (authLoading) → skeleton
else if (user && user.isHost) → redirect to /dashboard/host
else if (user && !user.isHost) → redirect to /search    ← post-launch behavior; pre-launch can also show host landing
else → render <HostLandingClient />
```

---

## 2. Page architecture

8 sections in vertical order. Every section full-bleed, content clamps to `max-w-[1200px] mx-auto` desktop, `px-5` mobile.

| # | Section | Background | Purpose |
|---|---|---|---|
| 1 | Top nav | `bg-[#0B2418]` (forest-deep) | Brand + 4 anchor links + "Devenir hôte" outline CTA + locale switcher |
| 2 | Hero | `bg-[#0B2418]` | H1 value prop, eyebrow, body, `btn-sun` CTA, status dot, hero photo right |
| 3 | Yellow ribbon | `bg-[#F4C73B]` | Full-bleed headline: "0 % commission pendant 3 mois · Puis seulement 10 %" |
| 4 | How it works | `bg-[#0B2418]` | 3-step walkthrough (emerald numbered circles with dashed connectors) |
| 5 | Benefit strip | `bg-[#F7F5EE]` (paper) | 3 benefits: "Vous fixez le prix" / "100 % flexible" / "Zéro tracas" |
| 6 | Signup block | `bg-[#0B2418]` | 2-column: left pitch + social proof, right white form card |
| 7 | FAQ (optional) | `bg-[#0F2E1F]` (forest) | 4–6 accordion items, anchor target for `#faq` |
| 8 | Footer | `bg-[#0B2418]` | 4-column: brand, Découvrir, Disponible à, Contact, socials, legal line |

Exact pixel/typography specs per section are in §5.

---

## 3. Component file map

Create a new folder `frontend/components/landing-host/` with these files:

```
frontend/components/landing-host/
├── HostLandingClient.tsx          # orchestrator — composes all sections
├── HostNav.tsx                    # top nav, sticky, forest-deep
├── Hero.tsx                       # H1 + photo
├── CommissionRibbon.tsx           # full-bleed yellow strip
├── HowItWorks.tsx                 # 3-step + connectors
├── BenefitStrip.tsx               # 3-up benefits on paper bg
├── SignupBlock.tsx                # 2-col, form inside
├── SignupForm.tsx                 # form logic + validation + POST
├── FAQ.tsx                        # accordion
├── HostFooter.tsx                 # multi-col dark footer
└── icons.tsx                      # 3 icons (TagPercent, Shield, Lock) as inline SVG
```

Route wiring (`app/[locale]/page.tsx`):

```tsx
import dynamic from 'next/dynamic';
const HostLandingClient = dynamic(
  () => import('@/components/landing-host/HostLandingClient'),
  { ssr: false },
);
export function generateStaticParams() { return [{}]; }
export default function Page() { return <HostLandingClient />; }
```

Move the existing `page.full.tsx` and `PreLaunchPageClient.tsx` into `app/[locale]/_legacy/` — keep for rollback, exclude from build via `next.config.mjs` ignore patterns if needed.

---

## 4. Design tokens — prereq

Before building the page, land this in `app/globals.css`. These are additive; nothing existing changes.

```css
:root {
  /* Added — host landing palette */
  --forest-deep:  #0B2418;
  --forest-card:  #0F2E1F;
  --sun:          #F4C73B;
  --sun-deep:     #E5B520;
  --paper:        #F7F5EE;
  --ink-on-sun:   #0B2418;
  --paper-dim:    rgba(247,245,238,0.72);
  --paper-soft:   rgba(247,245,238,0.55);
}

.theme-forest {
  background: var(--forest-deep);
  color: var(--paper);
}

.btn-sun {
  display: inline-flex; align-items: center; gap: 10px;
  background: var(--sun); color: var(--ink-on-sun);
  font-family: 'DM Sans'; font-weight: 700; font-size: 15px;
  padding: 14px 22px; border-radius: 12px; border: 0;
  box-shadow: 0 6px 16px rgba(244,199,59,0.35);
  transition: background 150ms, transform 150ms, box-shadow 150ms;
}
.btn-sun:hover { background: var(--sun-deep); transform: translateY(-1px); box-shadow: 0 10px 22px rgba(244,199,59,0.45); }
.btn-sun:active { transform: scale(0.97); }

.btn-sun-outline {
  display: inline-flex; align-items: center; gap: 8px;
  background: transparent; color: var(--sun);
  border: 1.5px solid var(--sun);
  font-family: 'DM Sans'; font-weight: 600; font-size: 14px;
  padding: 9px 16px; border-radius: 10px;
  transition: background 150ms, color 150ms;
}
.btn-sun-outline:hover { background: var(--sun); color: var(--ink-on-sun); }

.text-hero {
  font-family: 'DM Sans'; font-weight: 700;
  font-size: clamp(40px, 6vw, 72px);
  line-height: 1.0; letter-spacing: -0.02em;
  color: var(--paper);
}
.text-eyebrow {
  font-family: 'DM Sans'; font-weight: 600;
  font-size: 12px; line-height: 1; letter-spacing: 0.18em;
  text-transform: uppercase; color: #3AD57A;   /* emerald bright */
}
```

Also in `tailwind.config.ts`, extend `colors.spotzy`:

```ts
spotzy: {
  ...existing,
  'forest-deep': '#0B2418',
  'forest-card': '#0F2E1F',
  sun:           '#F4C73B',
  'sun-deep':    '#E5B520',
  paper:         '#F7F5EE',
}
```

---

## 5. Section-by-section spec

Pixel targets are for desktop (≥1024px). Mobile collapses to a single column with section padding `py-16 px-5`.

### 5.1 HostNav (`HostNav.tsx`)

- Height: `64px`, sticky, `bg-[#0B2418]`, border-bottom `border-white/6`.
- Left: logo — **yellow teardrop pin `#F4C73B`** 28×36, white "P" centered in DM Sans 800 18px. Wordmark "Spotzy" DM Sans 700 20px paper.
- Center: 4 anchor links — `Comment ça marche` (`#how`), `Avantages` (`#benefits`), `Pour les hôtes` (`#signup`), `Questions fréquentes` (`#faq`). Inter 500 14px, paper-dim, hover paper, 24px gap.
- Right: `.btn-sun-outline` "Devenir hôte" (anchors to `#signup`), then `<LocaleSwitcher />`.
- Mobile <768px: collapse center links into a hamburger; keep CTA + locale visible.

### 5.2 Hero (`Hero.tsx`)

- Grid: `grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-12`, section `py-24 lg:py-32`.
- **Left column:**
  - Eyebrow (class `text-eyebrow`): `t('landing.hero.eyebrow')` → "Parking privé · à la demande" OR host-flipped "Bientôt · hôtes recherchés"
  - H1 (class `text-hero`): `t('landing.hero.title')` → **"Gagnez de l'argent avec votre place de parking"**. Render as 2-line display.
  - Subhead: emerald `#3AD57A`, Inter 500 18px, mt-4: `t('landing.hero.subtitle')` → "Votre place vaut plus que vous ne le pensez."
  - Body: paper-dim, Inter 400 16px, line-height 1.55, max-w-[480px], mt-5: `t('landing.hero.body')` → "Profitez de la demande de stationnement à Forest & Saint-Gilles. Réservations à l'heure, à la journée ou au mois — c'est vous qui décidez."
  - CTA (`btn-sun`), mt-8: `t('landing.hero.cta')` → "Devenir hôte" + arrow-right icon. onClick: smooth-scroll to `#signup`.
  - Status row mt-8: emerald dot (8px, `#3AD57A`, pulsing via CSS keyframes) + Inter 400 13px paper-dim: `t('landing.hero.status')` → "Bientôt en ligne — places limitées"
- **Right column:** hero image, object-cover, aspect-[4/5], rounded-[20px], `shadow-[0_24px_60px_rgba(0,0,0,0.4)]`. Placeholder until real photo ships: striped SVG 800×1000 with monospace caption `hero photo · garage + car · Bruxelles 1400x1800`.
- **Mobile:** image stacks below text, aspect-[4/3], reduced height.

### 5.3 CommissionRibbon (`CommissionRibbon.tsx`)

- Full-bleed `bg-[#F4C73B]`, `py-6`, centered flex-row gap-5.
- Icon: `<TagPercent>` 24×24 stroke ink-on-sun, stroke-width 2.
- Text block:
  - Headline DM Sans 700 20px ink: `t('landing.ribbon.head')` → "0 % de commission pendant 3 mois"
  - Sub Inter 500 14px ink/70: `t('landing.ribbon.sub')` → "Puis seulement 10 %"
- Mobile: stack icon above text, py-5.

### 5.4 HowItWorks (`HowItWorks.tsx`)

- Section id `how`, `py-24`, `bg-[#0B2418]`.
- Header, centered, mb-16:
  - Eyebrow "text-eyebrow": "C'est aussi simple que ça"
  - H2 DM Sans 700 42px paper: "Comment ça marche ?"
- 3 steps in `grid grid-cols-3 gap-0 lg:gap-8` on desktop, `space-y-12` mobile.
- Each step (centered, no card chrome):
  - **Numbered circle** 56×56, `bg-[#1DB76A]` (emerald), white DM Sans 700 20px number "1"/"2"/"3"
  - Icon 32px below, stroke-paper, stroke-width 1.5 — Heroicons: UserPlus / Car / Euro
  - Title DM Sans 600 18px paper, mt-6
  - Body Inter 400 14px paper-dim, line-height 1.55, max-w-[260px], mt-2, text-center
- **Dashed connector** between steps 1→2 and 2→3 (desktop only): `border-t-2 border-dashed border-white/20`, absolutely positioned from right-edge of step N circle to left-edge of step N+1 circle, vertical center of circles. Hide <lg.
- Copy keys: `landing.how.step1.title`, `...step1.desc`, step2, step3. Already provided in the Visual Rehaul mock's COPY.FR object.

### 5.5 BenefitStrip (`BenefitStrip.tsx`)

- `py-16`, `bg-[#F7F5EE]` (paper), color ink (`#0B2418`).
- `grid grid-cols-3 gap-8` desktop, `space-y-10` mobile, max-w-[1000px] mx-auto.
- Each benefit (row on desktop: icon-left + text-right):
  - Icon circle 48×48, `bg-[#0B2418]` (forest-deep), icon stroked in sun `#F4C73B`. Icons: Shield (prix), Calendar (flex), Check (tracas).
  - Title DM Sans 600 18px forest-deep
  - Body Inter 400 14px, color `#5A6B5E` (slate), line-height 1.55

### 5.6 SignupBlock (`SignupBlock.tsx` + `SignupForm.tsx`)

- Section id `signup`, `py-24`, `bg-[#0B2418]`.
- Grid `grid-cols-1 lg:grid-cols-[1fr_1fr] gap-16` max-w-[1100px] mx-auto.

**Left column:**
- Eyebrow emerald: "Prêt·e à gagner ?"
- H2 DM Sans 700 44px paper, line-height 1.05, letter-spacing -0.01em: "Devenez hôte Spotzy dès aujourd'hui."
- Bullet list mt-8, space-y-3: each = emerald checkmark (20px, `bg-[#1DB76A]/20 text-[#3AD57A]` rounded circle) + Inter 500 15px paper.
  - "Aucun frais de démarrage"
  - "0 % de commission pendant 3 mois"
  - "Commencez à gagner quand vous voulez"
- Social proof row mt-10: 4 overlapping 40px avatar thumbs (circular, `ring-2 ring-[#0B2418]`) + 5 sun stars + Inter 500 13px paper-dim: "Déjà 30+ hôtes à Forest & Saint-Gilles"

**Right column — white card form:**
- `bg-[#F7F5EE]`, padding 36px, rounded-[20px], shadow-[0_24px_60px_rgba(0,0,0,0.25)].
- H3 DM Sans 700 22px forest-deep: "Inscrivez-vous gratuitement"
- Form layout (grid, space-y-4):
  - Row 1 grid-cols-2 gap-3: Prénom, Nom
  - Row 2: Adresse e-mail (full)
  - Row 3 grid-cols-2 gap-3: Code postal, Type de parking (select — Garage / Carport / Driveway / Allée / Open space)
- Inputs: white bg, `border border-[#C8DDD2]`, rounded-[10px], h-12 px-4, Inter 400 14px forest-deep, placeholder slate/60, focus ring 3px `rgba(29,183,106,0.25)`.
- Select: same chrome + chevron icon right.
- Submit: `.btn-sun` full-width, h-14, centered text + arrow-right: "Inscription gratuite"
- Below submit: row with Lock icon 14px + Inter 400 12px slate: "Vos données sont 100 % sécurisées et ne sont jamais partagées."

**Form behavior:**
- Validate: firstName/lastName non-empty, email regex, zip 4 digits (Belgian), parking type selected.
- On submit:
  - `POST /api/lead-capture` with `{firstName, lastName, email, zip, parkingType, locale}` **OR** — simpler for pre-launch — redirect to `/{locale}/auth/register?intent=host&email=...&zip=...&parkingType=...` (existing register flow can pre-populate).
  - Show success state in-place: replace form contents with emerald check icon + "Merci ! Nous vous recontactons dès que Spotzy ouvre à votre code postal." + link to home.
- Error state: red border on invalid field + helper text below.

### 5.7 FAQ (`FAQ.tsx`) — optional first-pass

- Section id `faq`, `py-24`, `bg-[#0F2E1F]` (slightly lighter forest than the hero — creates subtle rhythm).
- Header centered: eyebrow + H2 "Questions fréquentes", DM Sans 700 38px paper.
- Accordion list max-w-[760px] mx-auto, space-y-3, each row:
  - `<button>` full-width, `bg-[#0B2418]`, rounded-[12px], px-6 py-5, border-white/8, flex-between.
  - Question: Inter 600 16px paper.
  - Chevron 20px sun, rotates 180° when open.
  - Answer (collapsed by default): mt-3 Inter 400 15px paper-dim line-height 1.6.
- 6 items (all keys in `landing.faq.q1`…`q6`):
  1. Comment fixez-vous mes revenus ?
  2. Qui est responsable si quelque chose arrive à mon parking ?
  3. Comment suis-je payé ?
  4. Puis-je bloquer des dates ?
  5. Quelles informations sont partagées publiquement ?
  6. Quand Spotzy ouvre-t-il dans ma commune ?
- Ship this section gated behind `NEXT_PUBLIC_SHOW_FAQ=true` if not written yet.

### 5.8 HostFooter (`HostFooter.tsx`)

- `bg-[#0B2418]`, `py-14`, border-top `border-white/8`.
- Grid desktop: `grid-cols-[2fr_1fr_1fr_1fr] gap-12`, mobile stacked.
- Col 1 (brand): logo + wordmark, tagline Inter 400 14px paper-dim "Votre place. Vos revenus.", social icons row mt-6 (Instagram, Facebook, TikTok — 32px paper-dim circles, hover sun).
- Col 2 (Découvrir): title DM Sans 600 13px paper uppercase tracking-wider mb-4. Links Inter 400 14px paper-dim. Entries: Comment ça marche, Pour les hôtes, FAQ, Contact.
- Col 3 (Disponible à): same title styling. Entries: Forest (pin icon sun 12px + Inter paper-dim), Saint-Gilles. (Post-launch: also Etterbeek, Ixelles, Bruxelles-Ville.)
- Col 4 (Contact): title, then `info@spotzy.be`, `+32 488 12 34 56`. Inter 400 14px paper-dim.
- Bottom bar mt-12 pt-6 border-top border-white/8 flex-between: "© 2026 Spotzy — Tous droits réservés" + 2 legal links "Politique de confidentialité" · "Conditions générales".

---

## 6. i18n — full key list

Add to `frontend/src/locales/en/landing.yaml`, then run `npm run i18n:translate` to fill `fr-BE/` + `nl-BE/`. Founder review required for FR (solo-founder is FR-native).

```yaml
landing:
  # Nav
  nav:
    how: "How it works"
    benefits: "Why Spotzy"
    hosts: "For hosts"
    faq: "FAQs"
    cta: "Become a host"
  # Hero
  hero:
    eyebrow: "Soon live · hosts wanted"
    title: "Earn money with your parking spot"
    subtitle: "Your spot is worth more than you think."
    body: "Tap into parking demand in Forest & Saint-Gilles. Rent by the hour, day, or month — you decide."
    cta: "Become a host"
    status: "Soon live — limited spots available"
  # Ribbon
  ribbon:
    head: "0% commission for 3 months"
    sub: "Then just 10%"
  # How it works
  how:
    eyebrow: "It's that simple"
    title: "How does it work?"
    step1:
      title: "Sign up for free"
      desc: "Fill out the form and become a host in minutes."
    step2:
      title: "List your spot online"
      desc: "Add details, set your price and availability."
    step3:
      title: "Earn money"
      desc: "Receive bookings and earn while we handle the rest."
  # Benefits
  benefits:
    price_title: "You set the price"
    price_desc: "Full control over your rate and availability."
    flex_title: "100% flexible"
    flex_desc: "Rent when you want, no commitment."
    easy_title: "Zero hassle"
    easy_desc: "We handle payments and communication."
  # Signup
  signup:
    eyebrow: "Ready to earn?"
    title: "Become a Spotzy host today."
    bullet_1: "No startup costs"
    bullet_2: "0% commission for 3 months"
    bullet_3: "Start earning when you want"
    social: "Already 30+ hosts in Forest & Saint-Gilles"
    form_title: "Sign up for free"
    form_first: "First name"
    form_last: "Last name"
    form_email: "Email address"
    form_zip: "Postcode"
    form_type: "Parking type"
    form_type_garage: "Garage"
    form_type_carport: "Carport"
    form_type_driveway: "Driveway"
    form_type_openspace: "Open space"
    form_cta: "Register for free"
    form_privacy: "Your data is 100% secure and never shared."
    success_title: "Thanks!"
    success_body: "We'll contact you as soon as Spotzy opens in your postcode."
  # FAQ (optional)
  faq:
    title: "Frequently asked questions"
    q1: { q: "How do you decide my earnings?", a: "..." }
    q2: { q: "Who is liable if something happens to my parking?", a: "..." }
    q3: { q: "How do I get paid?", a: "..." }
    q4: { q: "Can I block dates?", a: "..." }
    q5: { q: "What information is shared publicly?", a: "..." }
    q6: { q: "When does Spotzy open in my area?", a: "..." }
  # Footer
  footer:
    tagline: "Your spot. Your income."
    discover: "Discover"
    available: "Available in"
    contact: "Contact"
    rights: "All rights reserved"
    privacy: "Privacy policy"
    terms: "Terms & conditions"
```

Glossary check (`_glossary.yaml`): **Spotzy** never translated; **host** → `hôte` (fr-BE) / `gastheer` (nl-BE); **Forest** (commune) stays **Forest** in FR, **Vorst** in NL; **Saint-Gilles** stays **Saint-Gilles** in FR, **Sint-Gillis** in NL.

---

## 7. Lead capture (optional, defer if tight)

Simplest: the form submits to the existing `/auth/register?intent=host&email=X&zip=Y&parkingType=Z` flow. No new Lambda required. Pre-launch CTA conversions are tracked via the register step.

If you want a dedicated pre-launch leads table:

- New Lambda `leads/lead-create` (backend/src/functions/leads/).
- DynamoDB rows: `LEAD#{leadId}` / `METADATA` (firstName, lastName, email, zip, parkingType, locale, createdAt, source="prelaunch-landing").
- GSI1: `EMAIL#{email}` → `LEAD#{leadId}` — prevent duplicate signups.
- Fire EventBridge `lead.created` → SES notification to `info@spotzy.be` + welcome email `{lead-welcome}-{locale}` template.
- Rate-limit: 3 submissions / IP / hour.

---

## 8. Analytics (nice-to-have)

Fire these events via existing analytics provider (PostHog / Plausible — check codebase):

- `landing.viewed` — with `locale`, `referrer`, `utm_*`
- `landing.cta_clicked` — with `source: "hero" | "nav" | "signup"`
- `landing.form_submitted` — with `locale`, `parkingType`, `zip`
- `landing.form_error` — with `field`, `error`

---

## 9. Acceptance criteria

1. Unauthenticated visit to `/fr-BE/` renders the new host landing with all 8 sections.
2. Unauthenticated visit to `/nl-BE/` renders fully translated copy; zero English strings visible in DOM scan.
3. Hero photo placeholder renders if `NEXT_PUBLIC_HERO_PHOTO_URL` is unset; real photo renders when set.
4. Nav CTA + hero CTA both smooth-scroll to `#signup`.
5. Form validation blocks submission with empty fields and shows field-level errors.
6. Successful submit redirects to `/{locale}/auth/register?intent=host&...` with prefilled query params (or shows inline success if lead-capture endpoint is wired).
7. All numbers formatted via `Intl.NumberFormat(locale)` — never hardcoded `€8.07`.
8. Lighthouse: LCP <2.5s on 4G, CLS <0.1, a11y ≥95.
9. Authenticated hosts are redirected away from `/` to `/dashboard/host`.
10. `npm run lint:i18n` passes — all new keys present in all 3 locales.
11. Reduced-motion users don't see the pulsing status dot or scroll animations.
12. All text on forest-deep has AA contrast (paper on forest-deep = 14.2:1; paper-dim on forest-deep = 10.3:1 — both pass).

---

## 10. Out of scope (explicit)

- Spotter-intent landing (post-launch, probably a separate route `/search` or persona-toggle)
- FAQ content copywriting (placeholders acceptable, founder writes real answers)
- Photography (use placeholder until garage photo + 4 avatars ship)
- A/B testing infrastructure
- Email templates (covered by Session 29 `{family}-{locale}`)
- Referral codes / invite links
- Cookie consent banner (existing app-wide banner applies)

---

## 11. Dependencies

- Session 29 (localization runtime) — **must be live**
- Session 30 (localization workflow) — for `npm run i18n:translate`
- Existing `LocaleSwitcher`, `useTranslation`, `useLocalizePath` hooks
- Existing `.btn-sun` tokens from §4 — land these first
- Hero image asset (1 file, 1400×1800 min, dark-leaning, can be stock until commissioned)
- 4 avatar images (96×96 min, diverse representation of Brussels neighborhoods)

---

## 12. Risks

- **Copy review latency**: fr-BE is founder-native; nl-BE and en need review. Budget 1 day for copy polish before go-live.
- **Hero photo asset delay**: mitigation = ship with striped SVG placeholder, swap in via env var post-photo-day.
- **Form spam** if lead-capture endpoint is built: add honeypot field + Cloudflare Turnstile before go-live.
- **Pre-launch / post-launch toggle**: need a clean feature flag strategy. Recommended: `NEXT_PUBLIC_LAUNCH_MODE=prelaunch | live` env var drives the routing logic in `page.tsx`.
