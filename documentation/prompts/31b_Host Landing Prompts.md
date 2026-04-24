# Session 31 — Claude Code prompts

**How to use:** run these prompts in order against Claude Code inside the Spotzy repo. Each prompt is self-contained and references the spec at `Host Landing Spec.md`. TDD-first per project convention — each prompt expects tests red before implementation.

Prerequisite: read `spotzy-system-prompt.md` + `Host Landing Spec.md` before starting.

---

## Prompt 31.1 — Design tokens + CTA primitives

> Add the host-landing design tokens to the codebase. No visual changes to existing pages yet.
>
> **Touch:**
> - `app/globals.css` — add new `:root` vars (`--forest-deep`, `--forest-card`, `--sun`, `--sun-deep`, `--paper`, `--ink-on-sun`, `--paper-dim`, `--paper-soft`), `.theme-forest` class, `.btn-sun`, `.btn-sun-outline`, `.text-hero`, `.text-eyebrow` classes exactly as specified in §4 of `Host Landing Spec.md`.
> - `tailwind.config.ts` — extend `colors.spotzy` with `forest-deep`, `forest-card`, `sun`, `sun-deep`, `paper`.
>
> **Don't change:** any existing token, any existing component, any existing page.
>
> **Verify:** add a small Storybook / visual test that renders a button with `.btn-sun` on a `.theme-forest` background and snapshots it. Run `npm run lint:i18n` — should still pass (no string changes).

---

## Prompt 31.2 — Retire legacy landings + routing

> Move the current landings into a `_legacy` folder and wire the route to a stub for the new host landing.
>
> **Touch:**
> - Create `app/[locale]/_legacy/` folder.
> - Move `app/[locale]/page.full.tsx` → `app/[locale]/_legacy/page.full.tsx`.
> - Move `app/[locale]/PreLaunchPageClient.tsx` → `app/[locale]/_legacy/PreLaunchPageClient.tsx`.
> - Update `app/[locale]/page.tsx` to dynamically import `@/components/landing-host/HostLandingClient`.
> - Create `components/landing-host/HostLandingClient.tsx` as an empty stub returning `<main className="theme-forest min-h-screen" />`.
> - In `page.tsx`, add auth-based routing: `user.isHost` → `/dashboard/host`, `user && !user.isHost` → `/search` (gate behind `NEXT_PUBLIC_LAUNCH_MODE === 'live'` — during prelaunch, all users see the host landing).
> - Add `NEXT_PUBLIC_LAUNCH_MODE=prelaunch` to `.env.local` and `.env.production`.
>
> **Tests:** existing tests should still pass. Add a new test for `page.tsx` routing behavior with mocked `useAuth`.

---

## Prompt 31.3 — i18n key scaffold

> Add all new translation keys for the host landing to the source locale (`en`) and run the translate script.
>
> **Touch:**
> - `frontend/src/locales/en/landing.yaml` — add all keys from §6 of `Host Landing Spec.md`. Preserve existing keys.
> - `frontend/src/locales/_glossary.yaml` — verify entries for `host`, `Forest`, `Saint-Gilles`; add if missing.
>
> **Run:**
> - `npm run i18n:translate -- --namespace=landing` (fills `fr-BE/` and `nl-BE/` via Claude API).
> - `npm run lint:i18n` — must pass.
>
> **Then:** pause for founder review of `fr-BE/landing.yaml` before proceeding. Founder is fr-BE native — all copy must be reviewed.

---

## Prompt 31.4 — HostNav component

> Build `components/landing-host/HostNav.tsx` per §5.1 of `Host Landing Spec.md`.
>
> **Requirements:**
> - 64px sticky forest-deep nav.
> - Yellow-pin logo (inline SVG — teardrop shape `#F4C73B` with white "P" centered).
> - 4 anchor links (`#how`, `#benefits`, `#signup`, `#faq`) — smooth-scroll on click, Inter 500 14px paper-dim, hover paper.
> - `.btn-sun-outline` "Devenir hôte" CTA — anchors to `#signup`.
> - Existing `<LocaleSwitcher />` integrated on the right.
> - Mobile (<768px): collapse links into hamburger; keep CTA + locale visible.
>
> **TDD:** tests first — render at desktop + mobile widths, verify all 4 links have correct `href="#..."`, CTA has correct aria-label. Then implement.

---

## Prompt 31.5 — Hero section

> Build `components/landing-host/Hero.tsx` per §5.2 of `Host Landing Spec.md`.
>
> **Requirements:**
> - Two-column grid (`1.1fr 1fr`) on `lg:`, single column below.
> - Left: eyebrow / H1 (class `text-hero`) / emerald subhead / paper-dim body / `.btn-sun` CTA / status row with pulsing emerald dot.
> - Right: `<img>` pulling from `process.env.NEXT_PUBLIC_HERO_PHOTO_URL` with fallback to a striped SVG placeholder component.
> - Reduced-motion: disable the pulsing dot via `@media (prefers-reduced-motion: reduce)`.
> - All copy via `useTranslation('landing')`.
>
> **TDD:** tests for (1) all copy keys render, (2) CTA has `href="#signup"`, (3) placeholder renders when env var unset, (4) image renders when env var set.

---

## Prompt 31.6 — CommissionRibbon + HowItWorks + BenefitStrip

> Build three sections per §5.3, §5.4, §5.5 of `Host Landing Spec.md`.
>
> **CommissionRibbon:** full-bleed sun background, TagPercent inline SVG icon, headline + sub, mobile stacks.
>
> **HowItWorks:** section id `how`, forest-deep, emerald numbered circles, dashed connector lines (desktop only), 3 steps with Heroicon-style outline icons.
>
> **BenefitStrip:** paper bg, 3 benefits in a row on desktop, icon circles with sun-stroke icons on forest-deep fill.
>
> **Integrate:** compose all three into `HostLandingClient.tsx` in vertical order (hero, ribbon, how, benefits).
>
> **TDD:** per-section tests for copy keys, DOM structure, and one integration test that snapshots the full page composition.

---

## Prompt 31.7 — Signup block + form

> Build `components/landing-host/SignupBlock.tsx` and `SignupForm.tsx` per §5.6 of `Host Landing Spec.md`.
>
> **SignupBlock:** two-column on `lg:`, left = pitch + bullets + social proof, right = white form card.
>
> **SignupForm requirements:**
> - Controlled inputs: firstName, lastName, email, zip, parkingType.
> - Validation: all required; email regex; zip = 4 digits; parkingType from enum (garage|carport|driveway|openspace).
> - `onSubmit`:
>   - If `NEXT_PUBLIC_LEAD_CAPTURE_ENDPOINT` set → `POST` with JSON body, show inline success on 200.
>   - Else → redirect via `useLocalizedRouter` to `/auth/register?intent=host&email=...&zip=...&parkingType=...`.
> - Error state: red border `border-[#DC2626]` + helper text below.
> - Submit button: `.btn-sun` full-width with arrow-right icon.
>
> **TDD:**
> - Form rejects empty submission, shows errors.
> - Form rejects invalid email, invalid zip.
> - Form on valid submit either POSTs (mocked) or redirects (check `router.push` called with expected query).
> - Success state renders with check icon + success copy from i18n.
> - Accessibility: every input has a `<label>`, errors linked via `aria-describedby`.

---

## Prompt 31.8 — FAQ (gated) + HostFooter

> Build `components/landing-host/FAQ.tsx` and `HostFooter.tsx` per §5.7 and §5.8 of `Host Landing Spec.md`.
>
> **FAQ:**
> - Gated behind `process.env.NEXT_PUBLIC_SHOW_FAQ === 'true'`.
> - Accordion: single-expand (opening one closes others), smooth height transition, chevron rotates.
> - Reduced-motion: instant toggle, no height animation.
> - 6 Q/A items via `t('landing.faq.q1.q')` / `t('landing.faq.q1.a')`.
>
> **HostFooter:**
> - 4-column desktop grid, stacked mobile.
> - Brand col: yellow-pin logo + wordmark + tagline + 3 social icons.
> - Discover / Available in / Contact columns.
> - Bottom bar: copyright + 2 legal links.
>
> **Compose:** add both to `HostLandingClient.tsx` after SignupBlock.
>
> **TDD:** FAQ toggle behavior (ARIA `aria-expanded` flips correctly), footer renders all 3 locales correctly.

---

## Prompt 31.9 — Analytics + polish

> Wire analytics events per §8 of `Host Landing Spec.md`. Run a full responsive QA pass.
>
> **Events:** `landing.viewed`, `landing.cta_clicked` (hero/nav/signup), `landing.form_submitted`, `landing.form_error`. Use whatever analytics provider the codebase already uses (PostHog / Plausible — grep for existing `analytics.track` or similar).
>
> **QA checklist (all must pass):**
> - Lighthouse: LCP <2.5s on 4G throttle, CLS <0.1, a11y ≥95, SEO ≥95.
> - All copy present in all 3 locales; `npm run lint:i18n` green.
> - DOM scan on `/nl-BE/` returns zero English strings.
> - Authenticated host → redirected to `/dashboard/host`.
> - Reduced-motion respected.
> - 320px width renders without horizontal scroll.
> - All `Intl.NumberFormat` calls pass locale explicitly.
>
> **Fix anything that fails. Then ship behind `NEXT_PUBLIC_LAUNCH_MODE=prelaunch` feature flag.**

---

## Prompt 31.10 (optional) — Lead capture Lambda

> Only if founder decides we want a dedicated leads table instead of piggybacking the existing register flow. Skip otherwise.
>
> **Create `backend/src/functions/leads/lead-create/`:**
> - Handler POST `/leads` (public, rate-limited 3/IP/hour via API Gateway throttling).
> - Body schema: `{firstName, lastName, email, zip, parkingType, locale}`.
> - Write `LEAD#{leadId}` / `METADATA` to `spotzy-main`.
> - GSI1 `EMAIL#{email}` / `LEAD#{leadId}` to dedupe.
> - Fire EventBridge `lead.created`.
> - Return `{leadId}` on success, `{error: "LEAD_ALREADY_EXISTS"}` on duplicate.
>
> **EventBridge consumer:**
> - SES send to `info@spotzy.be` (internal notification).
> - SES send `{lead-welcome}-{locale}` template to the lead.
>
> **CDK:** add to existing API + Events + DB stacks. Update IAM.
>
> **TDD:** full unit + integration coverage per project convention.
>
> **Wire frontend:** set `NEXT_PUBLIC_LEAD_CAPTURE_ENDPOINT=/leads` — `SignupForm.tsx` from Prompt 31.7 will pick it up automatically.
