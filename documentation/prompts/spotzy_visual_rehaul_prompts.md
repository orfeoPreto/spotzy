# Spotzy Visual Rehaul — Claude Code Prompts

> **Source**: Gap analysis (24 Apr 2026) comparing live landing at localhost:3001 against the mockup in `Spotzy Visual Rehaul.html`.
> **Nature**: Visual identity flip — NOT a rebuild. The structure is already correct. We're flipping from "clean government portal" to "premium consumer brand".
> **Key moves**: dark forest surfaces, yellow (sun) CTAs, photography slots, bold DM Sans hero type, multi-column dark footer, new signup block.
> **Pre-req**: CLAUDE.md in repo root. The mockup HTML file should be accessible for visual reference.

---

## Prompt 1 — Design Tokens + CTA System + Typography

**Must land first. Everything else depends on these tokens.**

```
Visual rehaul step 1/7. We're flipping Spotzy's identity from light-surface sage-green to dark-forest premium. This commit adds tokens only — no layout changes yet.

1. ADD to globals.css — new brand tokens:

:root {
  --forest-deep: #0B2418;    /* primary dark surface */
  --forest-card: #0F2E1F;    /* elevated card on dark */
  --sun: #F4C73B;            /* PRIMARY CTA on marketing surfaces */
  --sun-deep: #E5B520;       /* sun hover */
  --paper: #F7F5EE;          /* inset cards / form bgs on dark */
  --ink-on-sun: #0B2418;     /* dark text on yellow */
}

2. ADD theme-scoping class for dark marketing surfaces (landing, signup, footer). App-shell stays light for now:

.theme-forest {
  --background: var(--forest-deep);
  --foreground: var(--paper);
  --card: var(--forest-card);
  --border: rgba(247,245,238,0.10);
}

3. ADD .btn-sun CTA variant (DO NOT rename or remove existing .btn-gold or emerald buttons — add alongside):

.btn-sun {
  background: var(--sun);
  color: var(--ink-on-sun);
  font-family: 'DM Sans', sans-serif;
  font-weight: 700;
  letter-spacing: 0;
  border-radius: 12px;
  padding: 14px 22px;
  box-shadow: 0 6px 16px rgba(244,199,59,0.35);
  transition: background 150ms, transform 150ms;
}
.btn-sun:hover { background: var(--sun-deep); transform: translateY(-1px); }
.btn-sun:active { transform: scale(0.97); }

4. ADD .text-hero class for the landing hero headline:

.text-hero {
  font-family: 'DM Sans', sans-serif;
  font-weight: 700;
  font-size: clamp(40px, 6vw, 72px);
  line-height: 1.0;
  letter-spacing: -0.02em;
}

5. ADD yellow outline variant for nav CTA on dark backgrounds:

.btn-sun-outline {
  background: transparent;
  color: var(--sun);
  border: 1.5px solid var(--sun);
  font-family: 'DM Sans', sans-serif;
  font-weight: 600;
  border-radius: 10px;
  padding: 10px 18px;
  transition: background 150ms, color 150ms;
}
.btn-sun-outline:hover { background: var(--sun); color: var(--ink-on-sun); }

6. Also add these to tailwind.config.ts so they're available as utilities:
   colors: { 'forest-deep': '#0B2418', 'forest-card': '#0F2E1F', 'sun': '#F4C73B', 'sun-deep': '#E5B520', 'paper': '#F7F5EE', 'ink-on-sun': '#0B2418' }

No layout changes in this commit. Just tokens. Verify the build compiles and existing pages look unchanged.
```

---

## Prompt 2 — Nav Logo + CTA Restyle

```
Visual rehaul step 2/7. Two small changes to the navigation bar.

1. LOGO GLYPH: In Navigation.tsx (around lines 111-115), swap the current forest-green circle with white "P" to a YELLOW teardrop/pin shape with white "P". The pin should use --sun (#F4C73B) as fill, white "P" lettermark inside, roughly 36px tall. Keep the "Spotzy" wordmark beside it in DM Sans 700 white (desktop only, hide on mobile tab bar).

Here's the SVG for the yellow pin logo:
<svg viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 0C7.16 0 0 7.16 0 16c0 11.2 14.4 23.2 15.04 23.76a1.36 1.36 0 001.92 0C17.6 39.2 32 27.2 32 16 32 7.16 24.84 0 16 0z" fill="#F4C73B"/>
  <text x="16" y="22" text-anchor="middle" font-family="DM Sans" font-weight="700" font-size="18" fill="white">P</text>
</svg>

Adjust as needed to match the existing logo size. The pin should have the same 360° spin animation on hover that the current circle has.

2. NAV CTA BUTTON: The "Devenir Gestionnaire de Spots" (or "Devenir hôte") button in the nav bar is currently emerald-filled. Change it to use the .btn-sun-outline class (yellow outline, transparent bg, yellow fill on hover). This ensures it's visible against the forest-green nav bar without competing with the page's primary CTA.

That's it for this commit. Two small visual changes, big brand impact.
```

---

## Prompt 3 — Hero Rebuild (Dark, Two-Column, Yellow CTA)

**Biggest single change. The hero IS the brand impression.**

```
Visual rehaul step 3/7. Rebuild the hero section. This is the biggest visual change.

CURRENT: Mist (#F0F7F3) bg, centered text, single emerald CTA, no imagery.
TARGET: Full-bleed forest-deep bg, two-column layout (text left, photo right), yellow CTA, status dot.

In page.full.tsx (or wherever the Hero component lives), replace the hero section:

WRAPPER:
- Add class="theme-forest" to the hero <section>
- bg-[#0B2418] (or bg-forest-deep if Tailwind is configured)
- Full viewport width, generous vertical padding (py-20 lg:py-28)
- Inner container max-w-7xl mx-auto px-6

LAYOUT:
- grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-12 items-center

LEFT COLUMN (text):
- Eyebrow: uppercase tracking-widest text-sm text-[#3AD57A] (emerald-green), e.g. "PARKING MARKETPLACE"
- H1: Use .text-hero class (clamp 40-72px, DM Sans 700, -0.02em tracking). Color: var(--paper) / text-paper. Keep existing i18n keys t('hero.title_1') / t('hero.title_2') for now.
- Subheadline: text-[#3AD57A] Inter 500 text-lg, below H1
- Body: text-paper/60 Inter 400, max-w-lg, mt-4
- CTA: .btn-sun class, large size (text-lg px-8 py-4). Keep existing t('hero.cta') binding.
- Status line below CTA: small flex row with a pulsing green dot (w-2 h-2 rounded-full bg-[#3AD57A] animate-pulse) + "Bientôt en ligne — places limitées" in text-paper/50 text-sm. Add i18n key hero.status_live.

RIGHT COLUMN (photo):
- aspect-[16/10] rounded-2xl overflow-hidden bg-forest-card
- For now, use a placeholder: a dark gradient div with a centered Lucide Camera icon in paper/20 and small text "Photo à venir" in paper/30. The code path for <img> should be ready — just swap the src later.
- On mobile (<lg): photo column goes below text, aspect-video, full width

Keep all existing i18n bindings. Don't change any API calls or routing. This is purely visual.

Also add the new i18n key to locales/fr-BE/landing.yaml:
hero:
  status_live: "Bientôt en ligne — places limitées"

And to en/landing.yaml:
hero:
  status_live: "Coming soon — limited spots"
```

---

## Prompt 4 — Yellow Ribbon + Benefits Strip

```
Visual rehaul step 4/7. Two new presentational components between hero and "Comment ça marche".

1. YELLOW RIBBON — new component, insert right after hero:

Full-width bg-[#F4C73B] (--sun) py-5 text-center.
Content: Lucide TagPercent icon (20px, forest-deep color) inline + "0 % de commission pendant 3 mois" in DM Sans 700 text-lg text-forest-deep. Below: "Puis seulement 10 %" in Inter 400 text-sm text-forest-deep/70.

Create as <YellowRibbon /> component or inline in page.full.tsx.

Add i18n keys to fr-BE/landing.yaml:
ribbon:
  head: "0 % de commission pendant 3 mois"
  sub: "Puis seulement 10 %"

And en/landing.yaml:
ribbon:
  head: "0% commission for 3 months"
  sub: "Then only 10%"

2. BENEFITS STRIP — 3 short value props, insert after "Comment ça marche" section:

Light bg (bg-[#EBF7F1] sage) py-12. Inner: max-w-5xl mx-auto, grid grid-cols-1 md:grid-cols-3 gap-8 text-center.
Each benefit: Lucide icon in emerald (#059669) 28px above, DM Sans 600 16px forest title, Inter 400 14px slate description below.

Benefits:
- Shield icon → "Vous fixez le prix" / "Contrôle total sur votre tarif et vos disponibilités."
- Clock icon → "100 % flexible" / "Louez quand vous voulez, sans engagement."
- Sparkles icon → "Zéro tracas" / "Nous gérons les paiements et la communication."

Add i18n keys to fr-BE/landing.yaml:
benefits:
  price_title: "Vous fixez le prix"
  price_desc: "Contrôle total sur votre tarif et vos disponibilités."
  flex_title: "100 % flexible"
  flex_desc: "Louez quand vous voulez, sans engagement."
  easy_title: "Zéro tracas"
  easy_desc: "Nous gérons les paiements et la communication."

And en/landing.yaml equivalents.
```

---

## Prompt 5 — "Comment ça marche" Dark Reskin + Signup Block

```
Visual rehaul step 5/7. Two sections: reskin the existing "how it works" and build the new signup block.

1. "COMMENT ÇA MARCHE" — reskin (not rebuild):

CURRENT: White bg, 3 sage cards with line-icons, brick mono numbers.
TARGET: Dark bg, no card chrome, emerald numbered circles, dashed connectors.

Changes:
- Section bg: bg-white → bg-[#0B2418] text-[#F7F5EE] (add class="theme-forest")
- Section heading: keep DM Sans 700, but color paper instead of forest
- Remove the card wrappers (bg-[#F0F7F3] rounded-lg p-6 etc). Steps sit directly on the dark bg.
- Step numbers: replace the current mono brick text with 32px emerald (#059669) filled circles containing white digits (w-8 h-8 rounded-full bg-[#059669] flex items-center justify-center text-white font-bold)
- Between the 3 steps on desktop (horizontal layout): add a dashed border-t-2 border-dashed border-[#059669]/30 connecting them (absolute positioned line between circles)
- Icons: keep Lucide icons but color them emerald (#059669) instead of forest
- Step text: title in DM Sans 600 paper, description in Inter 400 paper/60

2. SIGNUP BLOCK — new section replacing "Accès rapide":

REMOVE the "Accès rapide" section entirely (the 3 sage tiles — "Rechercher", "Ajouter une annonce", "Mes réservations"). These duplicate nav items.

INSERT a new <SignupBlock /> section at the same position (before footer):

Full-width bg-[#0B2418] (theme-forest) py-20. Inner: max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center.

LEFT COLUMN:
- Eyebrow: text-[#3AD57A] uppercase tracking-widest text-sm → "PRÊT·E À GAGNER ?"
- H2: .text-hero or text-4xl DM Sans 700 paper → "Devenez hôte Spotzy dès aujourd'hui."
- 3 bullet points: each with a Lucide Check icon in emerald + paper text
  → "Aucun frais de démarrage"
  → "0 % de commission pendant 3 mois"
  → "Commencez à gagner quand vous voulez"
- Social proof row: 4 small avatar circles (32px, overlapping -ml-2, use placeholder gray circles with initials for now) + 5 yellow star icons (Lucide Star filled in #F4C73B, 16px) + "Déjà 30+ hôtes à Forest & Saint-Gilles" in paper/60 text-sm

RIGHT COLUMN:
- White card (bg-paper rounded-2xl p-8 shadow-xl)
- Form heading: DM Sans 600 18px forest-deep → "Inscrivez-vous gratuitement"
- Fields (all with sage bg, forest border, emerald focus ring — existing FormInput style):
  - Row 1: Prénom + Nom (two inputs side by side, gap-3)
  - Row 2: Adresse e-mail (full width)
  - Row 3: Code postal + Type de parking dropdown (side by side, gap-3)
    - Type dropdown options: "Garage", "Carport", "Allée", "Espace ouvert"
- CTA: .btn-sun full-width → "Inscription gratuite"
- Privacy microcopy below CTA: Lucide Lock icon (14px, slate) + "Vos données sont 100 % sécurisées et ne sont jamais partagées." in Inter 400 12px slate

The form doesn't need to submit to a real endpoint yet — wire it to console.log for now or to the existing registration flow. The important thing is the visual.

Add ALL i18n keys to fr-BE/landing.yaml under signup.* (eyebrow, title, bullet_1/2/3, social, form_title, form_first, form_last, form_email, form_zip, form_type, form_cta, form_privacy) and en/landing.yaml equivalents.
```

---

## Prompt 6 — Footer Rebuild + Bug Fixes

```
Visual rehaul step 6/7. Rebuild the footer and fix 3 cheap bugs.

FOOTER REBUILD (components/Footer.tsx):

CURRENT: Single thin row, mist bg, wordmark + 6 links + copyright.
TARGET: Multi-column dark footer with socials, availability markers, contact.

Structure:
- Full-width bg-[#0B2418] border-t border-paper/10
- Inner: max-w-6xl mx-auto py-16 px-6
- Grid: grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10

Column 1 — Brand:
- Yellow pin logo (same SVG as nav, 32px) + "Spotzy" DM Sans 700 paper beside it
- Tagline: "Votre place. Vos revenus." Inter 400 14px paper/50 mt-3
- Social icons row (mt-6): 3-4 Lucide icons (Instagram, Linkedin, Twitter/X, Facebook) in paper/40, 20px, hover: paper/80. Link to # for now.

Column 2 — Découvrir:
- Heading: "Découvrir" DM Sans 600 14px paper/40 uppercase tracking-wider mb-4
- Links: "Comment ça marche", "Devenir hôte", "Rechercher un spot", "FAQ" — Inter 400 14px paper/70, block, py-1.5, hover: paper

Column 3 — Disponible à:
- Heading: "Disponible à" same heading style
- Each location: Lucide MapPin icon (14px, emerald) + city name in paper/70 — "Forest", "Saint-Gilles", "Ixelles", "Uccle"

Column 4 — Contact:
- Heading: "Contact" same heading style
- Email: Lucide Mail icon + "hello@spotzy.be" paper/70
- Phone: Lucide Phone icon + "+32 2 123 45 67" paper/70

Bottom bar:
- border-t border-paper/10 mt-12 pt-6
- Flex justify-between (stack on mobile)
- Left: "© 2026 Spotzy SRL. Tous droits réservés." Inter 400 12px paper/30
- Right: "Politique de confidentialité" · "CGU" links in Inter 400 12px paper/40, hover: paper/70

Add footer i18n keys to fr-BE/landing.yaml:
footer:
  tagline: "Votre place. Vos revenus."
  discover: "Découvrir"
  how_it_works: "Comment ça marche"
  become_host: "Devenir hôte"
  search_spot: "Rechercher un spot"
  faq: "FAQ"
  available_in: "Disponible à"
  contact: "Contact"
  copyright: "© 2026 Spotzy SRL. Tous droits réservés."
  privacy: "Politique de confidentialité"
  terms: "CGU"

And en/landing.yaml equivalents.

BUG FIXES (land in the same commit — all are 1-line fixes):

1. "undefined réservations" on host dashboard listing row → null-coalesce to 0:
   Change `${listing.bookingCount} réservations` to `${listing.bookingCount ?? 0} ${t('dashboard.reservations')}` (or just `?? 0`).

2. fr-BE number formatting (€8.07 should be 8,07 €) → ensure all Intl.NumberFormat calls pass the active locale, not a hardcoded 'en-US'. Search for `new Intl.NumberFormat` and `toFixed` calls and replace with the locale-aware formatter. The locale is available from next-intl's useLocale() hook.

3. Rating "0.0" when no reviews → show "—" or "Pas encore noté" instead:
   In the rating display component, add: if (rating === 0 || reviewCount === 0) return <span className="text-slate">—</span>
```

---

## Prompt 7 — Search Page Reskin + Map Pins

```
Visual rehaul step 7/7. Reskin the search page to match the new identity. Structure stays identical — just visual changes.

1. MAP PINS — highest-impact change on this page:

CURRENT: Green rounded rectangles showing cluster count numbers ("12").
TARGET: Yellow rounded pills showing the PRICE (e.g. "€2,40"), white pill for inactive, yellow + dark text when selected/hovered.

In SpotMap.tsx (or wherever Mapbox markers are created):

Create a <PricePin /> component:
- Default: bg-white text-forest-deep rounded-full px-3 py-1 text-xs font-bold shadow-md border border-paper/20
  Shows: formatted price "2,40 €" (use locale-aware formatter)
- Hovered/selected: bg-[#F4C73B] text-[#0B2418] rounded-full px-3 py-1 text-xs font-bold shadow-lg scale-110
  Add a small downward triangle/notch pointing to the map location
- Cluster: bg-[#059669] text-white rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold → keep showing count

Render the PricePin as a Mapbox Marker element. Use ReactDOMServer.renderToString() or create a DOM element and pass it to new mapboxgl.Marker({ element }).

2. LISTING CARDS (SpotSummaryCard.tsx):

Keep the structure. Visual changes only:
- Price: ensure DM Sans 700 in forest (#004526). Verify locale formatting: "2,40 €/h" not "€2.40/h" in fr-BE.
- EV tag: if currently brick, change to emerald (#059669) bg with white "VE" text
- Shadow: soften to shadow-sm → shadow-md on hover (the current shadow might be too heavy)
- Host footer: ensure the avatar ring is forest green, name clickable

3. SEARCH BAR:

Keep the structure. If you're going full-dark on the search page header:
- Bar bg: forest-deep with paper/10 input backgrounds
- "Filtrer" button: .btn-sun-outline (yellow outline) instead of emerald outline
- Active filter chips: sun bg + forest text instead of emerald

If staying light (theme-scoped approach — recommended for now):
- Keep the current mist bg
- Just change the "Filtrer" pill to use DM Sans 600 forest text instead of emerald
- Active filter chips: sun fill + ink-on-sun text

4. "Rechercher dans cette zone" pill:
- Keep white bg
- Text: DM Sans 600 forest (not emerald)
- Add subtle shadow-sm

5. COPY FIX: The card shows "À partir de €8.07/h (frais et TVA inclus)" — verify this uses the locale-aware number formatter. In fr-BE it should render as "À partir de 8,07 €/h (frais et TVA inclus)". The € sign goes AFTER the number with a non-breaking space in Belgian French.

Run `npm run i18n:translate` after all changes to pick up any new keys. Then do a visual QA pass on mobile (375px) and desktop (1440px) — the map/list split should work correctly at both breakpoints.
```

---

## Implementation order

```
Prompt 1 → tokens (30 min, everything depends on this)
Prompt 2 → nav logo + CTA (30 min)
Prompt 3 → hero rebuild (2-3 hours, highest visual impact)
Prompt 4 → ribbon + benefits (1 hour)
Prompt 5 → how-it-works reskin + signup block (3-4 hours)
Prompt 6 → footer + bug fixes (2 hours)
Prompt 7 → search page reskin + map pins (3-4 hours)
```

Total: ~2-3 dev days for the full landing + search rehaul.

---

## Open decisions (from the gap analysis, still need your call)

1. **Hero copy: host-first or spotter-first?** Mockup says "Gagnez de l'argent avec votre place de parking" (host-intent). Current says "Trouvez un parking" (spotter-intent). Which wins?

2. **Agent API section**: keep + restyle dark, move to /developers, or drop?

3. **Photography**: ship with placeholder SVGs now, swap in real photos later? Or block on sourcing photos first?

4. **Theme scope**: .theme-forest on marketing surfaces only (landing, signup, footer) and keep app-shell (dashboard, search, booking) light? Or dark everywhere?

5. **Host dashboard**: Path A (reskin only, 1 day) or Path B (expanded with sparklines + upcoming bookings, 3-4 days)?
