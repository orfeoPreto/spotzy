# Session 29 — Localization Runtime (v2.x)

## Schema extensions · next-intl + YAML loader · Locale resolution · listing-translate Lambda · Read-time translate Lambda · SES per-locale templates

> ⚠ **v2.x SCOPE** — Do not start until sessions 00–22, 26, 27, 28, and 21b are complete.
> Prerequisite sessions: 00–22, 26, 27, 28, 21b.
>
> **This session is the runtime half of the localization mechanism.** Session 30 (Localization Workflow) is its companion and builds the translation tooling (translation script, linters, git hook). Session 29 and Session 30 can be deployed in either order, but both must be in place before the v2.x localization launch.
>
> **Source of truth:** `spotzy_localization_v2.docx` — the Localization & Internationalization Specification. Every design decision in this prompt traces back to a specific section in that document. Specifically:
> - PART A (shared helpers) implements §2 (locale resolution) and §6 (frontend architecture)
> - PART B (schema extensions) implements §5 (data model extensions)
> - PART C (frontend integration) implements §6 (next-intl + YAML loader) and §13 (URL structure)
> - PART D (backend conventions) implements §7 (backend never speaks human languages) and §4.2 (error code structure)
> - PART E (UGC translation Lambdas) implements §9 (write-time + read-time pipelines)
> - PART F (email templates) implements §4.3 and §10 (SES per-locale templates)
> - PART G (CDK) wires everything together
> - PART H (integration tests + Playwright) covers §14 (testing strategy)

---

## What this session builds

This session implements the runtime mechanism for serving Spotzy in three locales (`en`, `fr-BE`, `nl-BE`) on day one, with a forward-compatible architecture that supports adding new locales without code changes.

The pieces:

1. **Schema extensions** to USER PROFILE, LISTING METADATA, BAY METADATA, and BOOKING (block reservation guests) for per-locale content storage. Plus the new `TRANSLATION_CACHE#` row pattern for read-time chat/review translation caching.

2. **Locale resolution helpers** (frontend middleware + backend shared library) implementing the 5-priority algorithm from spec §2.2: URL prefix → user profile → cookie → Accept-Language → fallback to `fr-BE`.

3. **next-intl integration** in the frontend with a custom YAML loader, the `[locale]` dynamic route segment, server vs. client component handling, and the locale switcher UI.

4. **Backend error code convention** — every Lambda returns `{ error: ERROR_CODE, details: {...} }` structured responses. The frontend localizes them via the `errors` namespace.

5. **listing-translate Lambda** (write-time UGC pipeline) that subscribes to `listing.translation_required` EventBridge events and uses Amazon Translate to populate the `*Translations` maps on LISTING# and BAY# rows.

6. **translate-on-demand Lambda** (read-time UGC pipeline) at `POST /api/v1/translate` for chat messages, reviews, and dispute messages, with TRANSLATION_CACHE# caching at 30-day TTL.

7. **SES per-locale email templates** — 87 templates total (29 families × 3 locales) deployed via a `LocalizedEmailTemplate` CDK construct that takes a family name + locale → template-content map and emits the per-locale `CfnTemplate` resources.

8. **Email-sending Lambda updates** — the existing Lambdas from sessions 03, 04, 05, 26, 27 that send emails are updated to read the recipient's `preferredLocale` and pick the matching template name.

This session does NOT cover:
- The translation script (`npm run i18n:translate`) and the git hook — that's Session 30
- The i18n linter — that's Session 30
- The legal document linter — that's Session 30
- The actual translation file content (the script in Session 30 generates the YAML translation files; this session only sets up the loader and the empty file structure)
- Backoffice localization (intentionally English-only for v2.x per spec §1.3)

---

## Critical constants

```typescript
// Supported locales — both frontend and backend reference this
export const SUPPORTED_LOCALES = ['en', 'fr-BE', 'nl-BE'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

// Final fallback when no other signal resolves
export const DEFAULT_LOCALE: SupportedLocale = 'fr-BE';

// Source locale for development — the canonical reference for translation files
export const SOURCE_LOCALE: SupportedLocale = 'en';

// Locale cookie name
export const LOCALE_COOKIE_NAME = 'spotzy_locale';
export const LOCALE_COOKIE_MAX_AGE_DAYS = 365;

// HTTP header for diagnostic locale propagation (set by frontend, read by backend for logs only)
export const ACTIVE_LOCALE_HEADER = 'Spotzy-Active-Locale';

// Translation cache TTL for read-time chat/review translations
export const TRANSLATION_CACHE_TTL_DAYS = 30;
export const DISPUTE_TRANSLATION_CACHE_TTL_DAYS = 90;

// Amazon Translate language code mapping (BCP 47 → ISO 639-1)
// Used to convert our locale codes to what Amazon Translate expects
export const TRANSLATE_LANGUAGE_CODE_MAP: Record<SupportedLocale, string> = {
  'en': 'en',
  'fr-BE': 'fr',
  'nl-BE': 'nl',
};

// Listing translation event type
export const LISTING_TRANSLATION_EVENT_TYPE = 'listing.translation_required';
```

These constants live in `backend/src/shared/locales/constants.ts` and `frontend/src/lib/locales/constants.ts`. The frontend file is hand-mirrored from the backend file — the same values, same types, same names. A unit test in PART A confirms they stay in sync.

---

## DynamoDB schema additions

All on the existing `spotzy-main` table. No new tables.

```
// === USER PROFILE extension ===
PK: USER#{userId}                        SK: PROFILE
  // Existing fields unchanged.
  // New fields:
  preferredLocale (string, BCP 47 code)        // e.g. "fr-BE"
  preferredLocaleSetAt (ISO timestamp | null)  // null until the user explicitly picks a locale

// === LISTING METADATA extension ===
PK: LISTING#{listingId}                  SK: METADATA
  // Existing fields unchanged.
  // New fields:
  originalLocale (string)                          // BCP 47 code; the locale the Host wrote in
  titleTranslations (map)                          // { "en": "Garage at Avenue Louise", "fr-BE": "Garage à Avenue Louise", "nl-BE": "Garage aan Louizalaan" }
  descriptionTranslations (map)                    // same shape, longer values
  accessInstructionsTranslations (map | null)      // same shape, may be null if no access instructions
  translationsLastComputedAt (ISO timestamp | null)

// === BAY METADATA extension ===
PK: LISTING#{poolListingId}              SK: BAY#{bayId}
  // Existing fields from Session 26 unchanged.
  // New fields:
  originalLocale (string)
  labelTranslations (map)
  accessInstructionsTranslations (map | null)
  translationsLastComputedAt (ISO timestamp | null)

// === BOOKING (block reservation guest) extension ===
PK: BLOCKREQ#{reqId}                     SK: BOOKING#{bookingId}
  // Existing fields from Session 27 unchanged.
  // New fields:
  guestPreferredLocale (string)                    // BCP 47, defaults to the Block Spotter's preferredLocale at upload time
  guestLocaleSource ('block_spotter_default' | 'header_detected' | 'manual_override')

// === Translation cache (one row per cached translation) ===
PK: TRANSLATION_CACHE#{sha256Hash}       SK: METADATA
  // sha256Hash = sha256(sourceText + sourceLocale + targetLocale).hex()
  sourceText (string)                              // the original text, stored for debugging and cache analysis
  sourceLocale (string)
  targetLocale (string)
  translatedText (string)                          // the Amazon Translate output
  computedAt (ISO timestamp)
  expiresAt (ISO timestamp)                        // also set as DynamoDB TTL attribute
  expiresAtTtl (number)                            // Unix timestamp (seconds) for DynamoDB TTL
  hitCount (number)                                // incremented on each cache hit
  contentType ('chat' | 'review' | 'dispute')      // for cache analytics
```

---

## PART A — Shared helpers (frontend + backend)

### A1 — Backend constants and types

Create `backend/src/shared/locales/constants.ts` with the constants from "Critical constants" above. Create `backend/src/shared/locales/types.ts`:

```typescript
import type { SupportedLocale } from './constants';

export interface LocaleResolutionInput {
  urlPathPrefix?: string;
  userProfileLocale?: string;
  localeCookie?: string;
  acceptLanguageHeader?: string;
}

export interface LocaleResolutionResult {
  locale: SupportedLocale;
  source: 'url' | 'profile' | 'cookie' | 'accept_language' | 'fallback';
}

export interface TranslationCacheKey {
  sourceText: string;
  sourceLocale: SupportedLocale;
  targetLocale: SupportedLocale;
}
```

### A2 — Locale resolution helper

Create `backend/src/shared/locales/resolve-locale.ts`:

```typescript
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, SupportedLocale } from './constants';
import type { LocaleResolutionInput, LocaleResolutionResult } from './types';

/**
 * Resolves the active locale for an HTTP request using the 5-priority algorithm
 * from the localization spec §2.2:
 *
 * 1. URL path prefix    (always wins if present and supported)
 * 2. User profile       (if authenticated)
 * 3. Locale cookie      (if set)
 * 4. Accept-Language    (parsed by quality value)
 * 5. Fallback           (DEFAULT_LOCALE = fr-BE)
 *
 * The same function runs on the backend (in Lambdas) and is mirrored on the
 * frontend (in middleware). Both implementations must agree.
 */
export function resolveLocale(input: LocaleResolutionInput): LocaleResolutionResult {
  // Step 1: URL path prefix
  if (input.urlPathPrefix && isSupported(input.urlPathPrefix)) {
    return { locale: input.urlPathPrefix as SupportedLocale, source: 'url' };
  }

  // Step 2: user profile
  if (input.userProfileLocale && isSupported(input.userProfileLocale)) {
    return { locale: input.userProfileLocale as SupportedLocale, source: 'profile' };
  }

  // Step 3: cookie
  if (input.localeCookie && isSupported(input.localeCookie)) {
    return { locale: input.localeCookie as SupportedLocale, source: 'cookie' };
  }

  // Step 4: Accept-Language
  if (input.acceptLanguageHeader) {
    const fromHeader = matchAcceptLanguage(input.acceptLanguageHeader);
    if (fromHeader) {
      return { locale: fromHeader, source: 'accept_language' };
    }
  }

  // Step 5: fallback
  return { locale: DEFAULT_LOCALE, source: 'fallback' };
}

function isSupported(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Parses an Accept-Language header and returns the best supported locale match.
 * Handles quality values (q=0.9, q=0.8, etc.) and falls through language families
 * to regional variants:
 *   "fr;q=0.9,en;q=0.8" → "fr-BE" (because fr matches fr-BE)
 *   "de;q=0.9,en;q=0.8" → "en" (because de has no supported variant, en matches)
 *   "pt-BR" → null (no supported variant; caller falls through to step 5)
 */
function matchAcceptLanguage(header: string): SupportedLocale | null {
  const entries = header
    .split(',')
    .map((entry) => {
      const [lang, ...params] = entry.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1.0;
      return { lang: lang.trim().toLowerCase(), q };
    })
    .sort((a, b) => b.q - a.q);

  for (const entry of entries) {
    // Exact match: "fr-BE" → "fr-BE"
    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === entry.lang);
    if (exact) return exact;

    // Language family match: "fr" → "fr-BE", "nl" → "nl-BE", "en" → "en"
    const familyMatch = SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(entry.lang + '-')) ??
      SUPPORTED_LOCALES.find((l) => l.toLowerCase() === entry.lang);
    if (familyMatch) return familyMatch;
  }

  return null;
}
```

### A3 — Tests for the locale resolution helper

**Tests first:** `backend/__tests__/shared/locales/resolve-locale.test.ts`

```typescript
import { resolveLocale } from '../../../src/shared/locales/resolve-locale';

describe('resolveLocale', () => {
  describe('URL prefix wins (priority 1)', () => {
    test('URL fr-BE wins over everything else', () => {
      const result = resolveLocale({
        urlPathPrefix: 'fr-BE',
        userProfileLocale: 'nl-BE',
        localeCookie: 'en',
        acceptLanguageHeader: 'de',
      });
      expect(result).toEqual({ locale: 'fr-BE', source: 'url' });
    });

    test('invalid URL prefix falls through to next priority', () => {
      const result = resolveLocale({
        urlPathPrefix: 'pt-BR',
        userProfileLocale: 'nl-BE',
      });
      expect(result).toEqual({ locale: 'nl-BE', source: 'profile' });
    });
  });

  describe('user profile (priority 2)', () => {
    test('profile locale wins over cookie and Accept-Language', () => {
      const result = resolveLocale({
        userProfileLocale: 'nl-BE',
        localeCookie: 'en',
        acceptLanguageHeader: 'fr;q=0.9',
      });
      expect(result).toEqual({ locale: 'nl-BE', source: 'profile' });
    });

    test('invalid profile locale falls through', () => {
      const result = resolveLocale({
        userProfileLocale: 'pt-BR',
        localeCookie: 'en',
      });
      expect(result).toEqual({ locale: 'en', source: 'cookie' });
    });
  });

  describe('cookie (priority 3)', () => {
    test('cookie wins over Accept-Language', () => {
      const result = resolveLocale({
        localeCookie: 'en',
        acceptLanguageHeader: 'fr;q=0.9',
      });
      expect(result).toEqual({ locale: 'en', source: 'cookie' });
    });
  });

  describe('Accept-Language (priority 4)', () => {
    test('exact match wins', () => {
      const result = resolveLocale({ acceptLanguageHeader: 'fr-BE,en;q=0.8' });
      expect(result).toEqual({ locale: 'fr-BE', source: 'accept_language' });
    });

    test('language family match: "fr" → "fr-BE"', () => {
      const result = resolveLocale({ acceptLanguageHeader: 'fr;q=0.9,en;q=0.8' });
      expect(result).toEqual({ locale: 'fr-BE', source: 'accept_language' });
    });

    test('language family match: "nl" → "nl-BE"', () => {
      const result = resolveLocale({ acceptLanguageHeader: 'nl;q=0.9' });
      expect(result).toEqual({ locale: 'nl-BE', source: 'accept_language' });
    });

    test('quality values respected: highest q wins', () => {
      const result = resolveLocale({ acceptLanguageHeader: 'en;q=0.5,fr;q=0.9' });
      expect(result).toEqual({ locale: 'fr-BE', source: 'accept_language' });
    });

    test('unsupported language: "de" → falls through to fallback', () => {
      const result = resolveLocale({ acceptLanguageHeader: 'de;q=0.9' });
      expect(result).toEqual({ locale: 'fr-BE', source: 'fallback' });
    });

    test('mixed supported and unsupported: picks highest-q supported', () => {
      const result = resolveLocale({ acceptLanguageHeader: 'de;q=0.95,nl;q=0.9' });
      expect(result).toEqual({ locale: 'nl-BE', source: 'accept_language' });
    });
  });

  describe('fallback (priority 5)', () => {
    test('no inputs → fr-BE fallback', () => {
      const result = resolveLocale({});
      expect(result).toEqual({ locale: 'fr-BE', source: 'fallback' });
    });

    test('all inputs invalid → fr-BE fallback', () => {
      const result = resolveLocale({
        urlPathPrefix: 'invalid',
        userProfileLocale: 'invalid',
        localeCookie: 'invalid',
        acceptLanguageHeader: 'pt;q=0.9',
      });
      expect(result).toEqual({ locale: 'fr-BE', source: 'fallback' });
    });
  });
});
```

Run the tests — they must fail (red). Implement `resolve-locale.ts`. Run again — they must pass (green).

### A4 — Frontend mirror of constants and resolution helper

The frontend needs the same constants and the same resolution logic, in TypeScript that can run in Next.js middleware (Edge runtime) and in client components. Create `frontend/src/lib/locales/constants.ts` and `frontend/src/lib/locales/resolve-locale.ts` with the same content as the backend versions. They are intentionally hand-mirrored, not imported across the frontend/backend boundary, because the frontend and backend are separate packages with separate build pipelines.

**Sync test:** `frontend/__tests__/lib/locales/constants-sync.test.ts`. This test reads the backend `constants.ts` file (via `fs.readFileSync` at test time) and the frontend `constants.ts`, parses the exports, and asserts they have identical values. If a developer updates one file without the other, the test fails.

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

describe('frontend/backend locale constants are in sync', () => {
  test('SUPPORTED_LOCALES, DEFAULT_LOCALE, SOURCE_LOCALE, LOCALE_COOKIE_NAME match', () => {
    const backendPath = join(__dirname, '../../../../backend/src/shared/locales/constants.ts');
    const frontendPath = join(__dirname, '../../../src/lib/locales/constants.ts');

    const backend = readFileSync(backendPath, 'utf-8');
    const frontend = readFileSync(frontendPath, 'utf-8');

    // Extract the relevant lines and compare
    const extract = (source: string, name: string) => {
      const match = source.match(new RegExp(`export const ${name}\\s*=\\s*([^;]+);`));
      return match?.[1].trim();
    };

    for (const constant of [
      'SUPPORTED_LOCALES',
      'DEFAULT_LOCALE',
      'SOURCE_LOCALE',
      'LOCALE_COOKIE_NAME',
      'LOCALE_COOKIE_MAX_AGE_DAYS',
      'ACTIVE_LOCALE_HEADER',
    ]) {
      expect(extract(frontend, constant)).toBe(extract(backend, constant));
    }
  });
});
```

The frontend resolution helper has the identical implementation. The frontend test file mirrors the backend test file with the same coverage.

### A5 — YAML loader for next-intl

Create `frontend/src/lib/locales/yaml-loader.ts`:

```typescript
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import path from 'path';

/**
 * Loads YAML translation files for a given locale and namespace list.
 *
 * Returns an object keyed by namespace, where each value is the parsed
 * YAML content. next-intl consumes this structure directly.
 *
 * Example:
 *   loadLocaleMessages('fr-BE', ['common', 'listings'])
 *   →
 *   {
 *     common: { save: 'Enregistrer', cancel: 'Annuler', ... },
 *     listings: { create: { title: 'Créer une annonce', ... }, ... }
 *   }
 */
export async function loadLocaleMessages(
  locale: string,
  namespaces: string[]
): Promise<Record<string, unknown>> {
  const messages: Record<string, unknown> = {};
  for (const ns of namespaces) {
    const filePath = path.join(process.cwd(), 'src/locales', locale, `${ns}.yaml`);
    try {
      const content = await readFile(filePath, 'utf-8');
      messages[ns] = parse(content);
    } catch (err: unknown) {
      // Missing file → empty namespace. The i18n linter (Session 30) catches
      // this in CI; here we degrade gracefully so a missing file doesn't crash
      // the page in production.
      console.warn(`[i18n] Missing translation file: ${filePath}`);
      messages[ns] = {};
    }
  }
  return messages;
}
```

Add `yaml` and `@types/yaml` to `frontend/package.json` dependencies.

**Tests:** `frontend/__tests__/lib/locales/yaml-loader.test.ts`. Cover:
- Loading a single namespace returns the parsed object
- Loading multiple namespaces returns a map keyed by namespace name
- Missing file returns empty object for that namespace and logs a warning (not an error)
- Malformed YAML throws (because that's a development bug worth catching)
- Nested YAML keys preserved (e.g., `listings.create.title` is accessible as `messages.listings.create.title`)

### A6 — Backend translate language code helper

Create `backend/src/shared/locales/translate-language-code.ts`:

```typescript
import { TRANSLATE_LANGUAGE_CODE_MAP, SupportedLocale } from './constants';

/**
 * Converts a Spotzy locale code (BCP 47) to the language code Amazon Translate expects.
 *
 *   "fr-BE" → "fr"
 *   "nl-BE" → "nl"
 *   "en"    → "en"
 *
 * Used when calling the Amazon Translate API from the listing-translate
 * and translate-on-demand Lambdas.
 */
export function toTranslateLanguageCode(locale: SupportedLocale): string {
  return TRANSLATE_LANGUAGE_CODE_MAP[locale];
}
```

Trivial helper but worth a unit test for symmetry.

---

## PART B — Schema migrations and entity helpers

### B1 — USER PROFILE additive migration

The `preferredLocale` and `preferredLocaleSetAt` fields are additive on the existing `USER#{userId}/PROFILE` row. No migration script is needed because Spotzy launches greenfield (per the localization spec §15.1) — there is no existing user data to backfill.

The fields are written by:
- The registration Lambda (existing in Session 06) — updated in B2 to capture `preferredLocale` from the active locale of the registration request
- The `users-update-preferences` Lambda (existing in Session 06) — updated in B3 to accept locale changes
- The locale switcher in the frontend — calls the same `users-update-preferences` Lambda

### B2 — Update the registration Lambda to capture preferredLocale

The existing `register-user` Lambda from Session 06 (or wherever the Spotter registration is implemented) needs one change: read the `Spotzy-Active-Locale` header from the request, validate it against `SUPPORTED_LOCALES`, and store it on the new USER PROFILE row.

**Tests first:** add new test cases to the existing Session 06 test file:

```typescript
describe('register-user — preferredLocale capture', () => {
  test('Spotzy-Active-Locale header → stored on profile', async () => {
    const result = await handler({
      headers: { 'Spotzy-Active-Locale': 'fr-BE' },
      body: JSON.stringify({ email: 'a@b.com', password: 'xxxxxxxx' }),
    });
    expect(result.statusCode).toBe(201);

    const profile = await getDynamoItem(`USER#${getUserId(result)}`, 'PROFILE');
    expect(profile.preferredLocale).toBe('fr-BE');
    expect(profile.preferredLocaleSetAt).toBeNull();   // null because the user didn't explicitly pick — the system inferred from the URL
  });

  test('missing header → defaults to fr-BE (final fallback)', async () => {
    const result = await handler({
      headers: {},
      body: JSON.stringify({ email: 'a@b.com', password: 'xxxxxxxx' }),
    });
    const profile = await getDynamoItem(`USER#${getUserId(result)}`, 'PROFILE');
    expect(profile.preferredLocale).toBe('fr-BE');
  });

  test('invalid header value → defaults to fr-BE', async () => {
    const result = await handler({
      headers: { 'Spotzy-Active-Locale': 'pt-BR' },
      body: JSON.stringify({ email: 'a@b.com', password: 'xxxxxxxx' }),
    });
    const profile = await getDynamoItem(`USER#${getUserId(result)}`, 'PROFILE');
    expect(profile.preferredLocale).toBe('fr-BE');
  });
});
```

The implementation reads the header, calls `resolveLocale({ urlPathPrefix: header })` (treating the header as if it were a URL prefix because the validation is identical), and stores the result. This is a 5-line addition to the existing handler.

### B3 — Update users-update-preferences Lambda to accept locale changes

The existing preferences endpoint is extended to accept a `preferredLocale` field. When a user picks a locale via the frontend switcher, the frontend sends a `PATCH /api/v1/users/me/preferences` request with `{ preferredLocale: 'fr-BE' }`.

**Tests first:**
- Happy path: valid locale → updates profile + sets `preferredLocaleSetAt = now`
- Invalid locale → 400 INVALID_LOCALE
- Profile not found → 404 USER_NOT_FOUND

### B4 — LISTING METADATA additive migration

Same as USER PROFILE — no migration script needed for greenfield. The new fields (`originalLocale`, `titleTranslations`, `descriptionTranslations`, `accessInstructionsTranslations`, `translationsLastComputedAt`) are populated by:
- The existing `listing-create` Lambda from Session 02 (and the Session 28 update for tiered pricing) — extended in B5 to capture `originalLocale` and emit the translation event
- The existing `listing-update` Lambda — extended in B5 to detect changed fields and emit a translation event for those fields

### B5 — Update listing-create and listing-update to emit translation events

The existing `listing-create` Lambda from Session 02 needs two changes:

1. **Capture `originalLocale`** from the `Spotzy-Active-Locale` header at create time. Store it on the new LISTING# field. The `*Translations` maps are initialized as `{ [originalLocale]: <original text> }` — i.e. they contain only the source text. The other locale entries are populated later by the listing-translate Lambda asynchronously.

2. **Publish a `listing.translation_required` EventBridge event** after the LISTING# row is written. The event detail includes:
   - `listingId`
   - `originalLocale`
   - `fieldsChanged`: `['title', 'description', 'accessInstructions']` (all three on create)
   - `isPool`: from the Session 26 `isPool` flag

```typescript
// After the existing TransactWriteItems that creates the LISTING# row
await eventBridge.send(new PutEventsCommand({
  Entries: [{
    Source: 'spotzy.listings',
    DetailType: 'listing.translation_required',
    Detail: JSON.stringify({
      listingId: newListingId,
      originalLocale: activeLocale,
      fieldsChanged: ['title', 'description', 'accessInstructions'],
      isPool: body.isPool === true,
    }),
    EventBusName: process.env.EVENT_BUS_NAME!,
  }],
}));
```

The EventBridge call is OUTSIDE the TransactWriteItems — it happens after the DynamoDB write succeeds. If the EventBridge call fails, the listing exists in DynamoDB but has no translations yet. The listing-translate Lambda is also triggered by a manual retry endpoint (not exposed in v2.x but documented as a follow-up) so the founder can re-trigger translation if needed.

The `listing-update` Lambda has the same change but with `fieldsChanged` populated only for the fields that actually changed in the update (computed by diffing the old and new values). If only the price changed, no translation event is emitted.

**Tests first:** add new test cases to the existing Session 02 / Session 28 test files:
- Listing create → `originalLocale` stored, `*Translations` maps initialized with source text only, EventBridge event published with the right shape
- Listing update — title only → event published with `fieldsChanged: ['title']`
- Listing update — price only → no event published
- Pool listing create (Session 26) → event includes `isPool: true`

### B6 — BAY METADATA additive

Same pattern. The existing `pool-listing-create` and `pool-bay-update` Lambdas from Session 26 capture `originalLocale` for each bay and publish translation events for bay-specific content (label, access instructions). The bay translation can be batched into the parent listing's translation event by including the bay IDs in the event detail — the listing-translate Lambda handles bays as part of the same run for pool listings.

### B7 — BLOCKREQ guest extension

The Block Spotter guest upload flow from Session 27 (`block-guest-upload` Lambda or equivalent) is extended to capture `guestPreferredLocale` per uploaded guest. The Block Spotter UI in the frontend (Session 27) gets a new "Language" dropdown column in the guest CSV upload flow with three options (Auto / fr-BE / nl-BE / en); "Auto" stores the Block Spotter's own `preferredLocale`.

**Tests first:** add new test cases to the existing Session 27 test files:
- Guest upload with explicit locale per row → stored on the BOOKING# row
- Guest upload with "Auto" → defaults to Block Spotter's `preferredLocale`
- Guest upload with no locale column → defaults to Block Spotter's `preferredLocale`

### B8 — TRANSLATION_CACHE# helpers

Create `backend/src/shared/locales/translation-cache.ts`:

```typescript
import { createHash } from 'crypto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { SupportedLocale } from './constants';
import { TRANSLATION_CACHE_TTL_DAYS, DISPUTE_TRANSLATION_CACHE_TTL_DAYS } from './constants';

export function buildCacheKey(sourceText: string, sourceLocale: SupportedLocale, targetLocale: SupportedLocale): string {
  return createHash('sha256').update(`${sourceText}\u0000${sourceLocale}\u0000${targetLocale}`).digest('hex');
}

export async function getCachedTranslation(
  client: DynamoDBDocumentClient,
  tableName: string,
  sourceText: string,
  sourceLocale: SupportedLocale,
  targetLocale: SupportedLocale
): Promise<string | null> {
  const cacheKey = buildCacheKey(sourceText, sourceLocale, targetLocale);
  const result = await client.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `TRANSLATION_CACHE#${cacheKey}`, SK: 'METADATA' },
  }));
  if (!result.Item) return null;

  // Async hit count update — fire and forget, don't block the read path
  client.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `TRANSLATION_CACHE#${cacheKey}`, SK: 'METADATA' },
    UpdateExpression: 'ADD hitCount :one',
    ExpressionAttributeValues: { ':one': 1 },
  })).catch((err) => console.error('Failed to increment translation cache hit count', err));

  return result.Item.translatedText as string;
}

export async function putCachedTranslation(
  client: DynamoDBDocumentClient,
  tableName: string,
  sourceText: string,
  sourceLocale: SupportedLocale,
  targetLocale: SupportedLocale,
  translatedText: string,
  contentType: 'chat' | 'review' | 'dispute'
): Promise<void> {
  const cacheKey = buildCacheKey(sourceText, sourceLocale, targetLocale);
  const ttlDays = contentType === 'dispute' ? DISPUTE_TRANSLATION_CACHE_TTL_DAYS : TRANSLATION_CACHE_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 3600 * 1000);

  await client.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `TRANSLATION_CACHE#${cacheKey}`,
      SK: 'METADATA',
      sourceText,
      sourceLocale,
      targetLocale,
      translatedText,
      computedAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      expiresAtTtl: Math.floor(expiresAt.getTime() / 1000),
      hitCount: 0,
      contentType,
    },
  }));
}
```

**Tests first:** `backend/__tests__/shared/locales/translation-cache.test.ts`

- `buildCacheKey` is deterministic (same inputs → same hash)
- `buildCacheKey` is sensitive to all three inputs (different source text, source locale, or target locale → different hash)
- `getCachedTranslation` returns null on miss
- `getCachedTranslation` returns the cached text on hit
- `getCachedTranslation` async-increments hit count (verify with a follow-up Get)
- `putCachedTranslation` writes the row with the right TTL (chat = 30d, dispute = 90d)
- TTL attribute is set as a Unix timestamp in seconds (for DynamoDB TTL feature)


---

## PART C — Frontend integration: next-intl + YAML + locale routing

### C1 — Install next-intl and yaml

```bash
cd frontend
npm install next-intl yaml
npm install --save-dev @types/yaml
```

### C2 — next-intl configuration

Create `frontend/src/i18n.ts`:

```typescript
import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { SUPPORTED_LOCALES, SupportedLocale } from './lib/locales/constants';
import { loadLocaleMessages } from './lib/locales/yaml-loader';

// Every namespace defined in §4.1 of the localization spec
export const NAMESPACES = [
  'common', 'auth', 'listings', 'pricing', 'availability', 'search',
  'booking', 'chat', 'reviews', 'disputes', 'profile', 'payments',
  'dashboard', 'notifications', 'gdpr', 'spot_manager', 'block_spotter',
  'magic_link', 'errors', 'validation', 'time_date', 'landing', 'footer',
] as const;

export default getRequestConfig(async ({ locale }) => {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    notFound();
  }

  const messages = await loadLocaleMessages(locale, [...NAMESPACES]);

  return {
    messages,
    timeZone: 'Europe/Brussels',
    now: new Date(),
  };
});
```

### C3 — Next.js middleware for locale routing

Create `frontend/src/middleware.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { resolveLocale } from './lib/locales/resolve-locale';
import { SUPPORTED_LOCALES, LOCALE_COOKIE_NAME, ACTIVE_LOCALE_HEADER } from './lib/locales/constants';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static assets, API routes, and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/static') ||
    pathname.includes('.')   // files with extensions like .png, .ico
  ) {
    return NextResponse.next();
  }

  // Extract the first path segment to check if it's a locale prefix
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  const hasLocalePrefix = firstSegment && (SUPPORTED_LOCALES as readonly string[]).includes(firstSegment);

  if (hasLocalePrefix) {
    // URL already has a valid locale prefix; pass through but set the locale header for downstream Lambdas
    const response = NextResponse.next();
    response.headers.set(ACTIVE_LOCALE_HEADER, firstSegment);
    return response;
  }

  // No valid locale prefix → resolve and 308-redirect
  const result = resolveLocale({
    userProfileLocale: undefined,   // middleware doesn't have access to the auth context; the profile locale check happens in the page-level loader
    localeCookie: request.cookies.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguageHeader: request.headers.get('accept-language') ?? undefined,
  });

  const redirectUrl = new URL(`/${result.locale}${pathname}${request.nextUrl.search}`, request.url);
  return NextResponse.redirect(redirectUrl, 308);
}

export const config = {
  matcher: [
    // Match every path except _next, api, static, and files with extensions
    '/((?!_next|api|static|.*\\..*).*)',
  ],
};
```

**Tests first:** `frontend/__tests__/middleware.test.ts`

```typescript
import { middleware } from '../src/middleware';
import { NextRequest } from 'next/server';

describe('locale middleware', () => {
  test('URL with valid locale prefix passes through', () => {
    const req = new NextRequest('https://spotzy.be/fr-BE/listings/123', {
      headers: { 'accept-language': 'en' },
    });
    const res = middleware(req);
    expect(res.headers.get('Spotzy-Active-Locale')).toBe('fr-BE');
    expect(res.status).not.toBe(308);
  });

  test('bare URL → 308 redirect to resolved locale', () => {
    const req = new NextRequest('https://spotzy.be/listings/123', {
      headers: { 'accept-language': 'fr;q=0.9' },
    });
    const res = middleware(req);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://spotzy.be/fr-BE/listings/123');
  });

  test('cookie wins over Accept-Language', () => {
    const req = new NextRequest('https://spotzy.be/listings/123', {
      headers: { 'accept-language': 'nl;q=0.9', cookie: 'spotzy_locale=en' },
    });
    const res = middleware(req);
    expect(res.headers.get('location')).toBe('https://spotzy.be/en/listings/123');
  });

  test('static asset request passes through unchanged', () => {
    const req = new NextRequest('https://spotzy.be/_next/static/chunk.js');
    const res = middleware(req);
    expect(res.status).not.toBe(308);
  });

  test('API request passes through unchanged', () => {
    const req = new NextRequest('https://spotzy.be/api/v1/listings');
    const res = middleware(req);
    expect(res.status).not.toBe(308);
  });
});
```

### C4 — `[locale]` dynamic route segment

Wrap the existing `frontend/src/app/` content in a `[locale]` dynamic segment. This is a one-time refactor: every existing page moves from `frontend/src/app/{path}` to `frontend/src/app/[locale]/{path}`.

```
frontend/src/app/
  [locale]/
    layout.tsx                    // wraps every page in NextIntlClientProvider
    page.tsx                      // landing page
    listings/
      page.tsx                    // search results
      [id]/
        page.tsx                  // listing detail
      new/
        page.tsx                  // create listing
    account/
      ... (rest of existing app)
```

The new root layout (`frontend/src/app/[locale]/layout.tsx`):

```typescript
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { SUPPORTED_LOCALES } from '@/lib/locales/constants';

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

The `generateStaticParams` function tells Next.js to pre-render every locale variant of every static page at build time, which gives the fastest first-byte latency for users.

### C5 — Page-level translation usage

Server components use `getTranslations` from `next-intl/server`:

```typescript
// frontend/src/app/[locale]/listings/[id]/page.tsx
import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function ListingDetailPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations({ locale: params.locale, namespace: 'listings' });
  const tCommon = await getTranslations({ locale: params.locale, namespace: 'common' });
  // ... fetch listing data
  return (
    <div>
      <h1>{t('detail.title')}</h1>
      <button>{tCommon('buttons.book')}</button>
    </div>
  );
}
```

Client components use `useTranslations`:

```typescript
'use client';
import { useTranslations } from 'next-intl';

export function CheaperAlternativesBanner({ savings }: { savings: number }) {
  const t = useTranslations('pricing');
  return <div>{t('cheaperAlternatives.message', { savings })}</div>;
}
```

The migration of every existing component to use these hooks is a mechanical refactor — not detailed here, but the developer (the founder) walks through each component and replaces hard-coded strings with `t()` calls plus an entry in the appropriate `en/{namespace}.yaml` file. Session 30's translation script then fills in fr-BE and nl-BE.

### C6 — Empty translation file scaffolding

Create the directory structure with empty (but valid) YAML files:

```bash
mkdir -p frontend/src/locales/en
mkdir -p frontend/src/locales/fr-BE
mkdir -p frontend/src/locales/nl-BE

for ns in common auth listings pricing availability search booking chat reviews disputes profile payments dashboard notifications gdpr spot_manager block_spotter magic_link errors validation time_date landing footer; do
  for locale in en fr-BE nl-BE; do
    echo "# Spotzy $ns translations ($locale)" > frontend/src/locales/$locale/$ns.yaml
  done
done
```

These empty files allow next-intl to start up. As the founder migrates components, they add real keys to the `en/` files first. Session 30's translation script then fills in the `fr-BE/` and `nl-BE/` versions.

The empty `_glossary.yaml` is also created at this stage:

```yaml
# frontend/src/locales/_glossary.yaml
version: "1.0"
lastUpdated: "2026-04-10"

terms:
  Spotzy:
    rule: never_translate
    all_locales: Spotzy

  Spotter:
    rule: never_translate
    all_locales: Spotter

  Block Spotter:
    rule: never_translate
    all_locales: Block Spotter

  Bay:
    rule: never_translate
    all_locales: Bay

  Spot Pool:
    rule: translate
    fr-BE: Pool de Stationnement
    nl-BE: Parkeerpool
    en: Spot Pool

  Spot Manager:
    rule: translate
    fr-BE: Gestionnaire de Spots
    nl-BE: Spotbeheerder
    en: Spot Manager

  Block Reservation:
    rule: translate
    fr-BE: Réservation Bloc
    nl-BE: Blokreservering
    en: Block Reservation

  Block Allocation:
    rule: translate
    fr-BE: Allocation Bloc
    nl-BE: Blokallocatie
    en: Block Allocation
```

The full glossary from spec §3 is committed at this stage. The translation script in Session 30 reads it and passes it to Claude on every translation call.

### C7 — Locale switcher component

Create `frontend/src/components/LocaleSwitcher.tsx`:

```typescript
'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { SUPPORTED_LOCALES, LOCALE_COOKIE_NAME, LOCALE_COOKIE_MAX_AGE_DAYS } from '@/lib/locales/constants';
import { Globe } from 'lucide-react';
import { useState } from 'react';

const LOCALE_NATIVE_NAMES: Record<string, string> = {
  'en': 'English',
  'fr-BE': 'Français',
  'nl-BE': 'Nederlands',
};

export function LocaleSwitcher() {
  const currentLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const t = useTranslations('common');

  const switchTo = async (newLocale: string) => {
    // 1. Set the cookie
    document.cookie = `${LOCALE_COOKIE_NAME}=${newLocale}; max-age=${LOCALE_COOKIE_MAX_AGE_DAYS * 24 * 3600}; path=/; SameSite=Lax`;

    // 2. If authenticated, persist to user profile (fire-and-forget)
    fetch('/api/v1/users/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredLocale: newLocale }),
    }).catch(() => {});

    // 3. Navigate to the new locale's URL
    const newPathname = pathname.replace(/^\/[^\/]+/, `/${newLocale}`);
    router.push(newPathname);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-slate-600 hover:text-forest"
        aria-label={t('localeSwitcher.label')}
      >
        <Globe size={20} />
        <span>{LOCALE_NATIVE_NAMES[currentLocale]}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded shadow-lg z-50">
          {SUPPORTED_LOCALES.map((locale) => (
            <button
              key={locale}
              onClick={() => switchTo(locale)}
              className={`block w-full text-left px-4 py-2 hover:bg-mint ${
                locale === currentLocale ? 'font-semibold text-forest' : 'text-slate-700'
              }`}
            >
              {LOCALE_NATIVE_NAMES[locale]}
              {locale === currentLocale && ' ✓'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

Add the `LocaleSwitcher` to the existing navigation component. The tests verify:
- Renders three locale options
- Currently active locale is checkmarked
- Clicking a locale sets the cookie, fires the PATCH request, and navigates
- Closes the dropdown on selection

### C8 — Type generation for translation keys

Create `frontend/scripts/generate-i18n-types.ts`. This script reads all `frontend/src/locales/en/*.yaml` files at build time, parses them, and emits a TypeScript declaration file that next-intl uses to type-check `t()` calls.

```typescript
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';
import { NAMESPACES } from '../src/i18n';

const localesDir = join(__dirname, '../src/locales/en');
const outputPath = join(__dirname, '../src/locales/types.d.ts');

const messages: Record<string, unknown> = {};
for (const ns of NAMESPACES) {
  const filePath = join(localesDir, `${ns}.yaml`);
  const content = readFileSync(filePath, 'utf-8');
  messages[ns] = parse(content) ?? {};
}

const tsContent = `// AUTO-GENERATED — do not edit by hand. Run \`npm run i18n:generate-types\` to regenerate.
type Messages = ${JSON.stringify(messages, null, 2)};
declare global {
  interface IntlMessages extends Messages {}
}
export {};
`;

writeFileSync(outputPath, tsContent);
console.log(`Generated ${outputPath}`);
```

Add `i18n:generate-types` to `frontend/package.json` scripts and wire it into `npm run dev` and `npm run build` so the types are always fresh.

---

## PART D — Backend error code convention

### D1 — Error response helper

Create `backend/src/shared/errors/error-response.ts`:

```typescript
import type { APIGatewayProxyResult } from 'aws-lambda';

/**
 * Standard error response shape used by every Spotzy Lambda.
 *
 * Per the localization spec §7.1, the backend never returns human-readable strings.
 * It returns a machine-readable errorCode and a structured details object that the
 * frontend uses to render the localized message.
 */
export function errorResponse(
  statusCode: number,
  errorCode: string,
  details?: Record<string, unknown>
): APIGatewayProxyResult {
  return {
    statusCode,
    body: JSON.stringify({
      error: errorCode,
      ...(details ? { details } : {}),
    }),
    headers: {
      'Content-Type': 'application/json',
    },
  };
}

export function successResponse<T>(data: T, statusCode: number = 200): APIGatewayProxyResult {
  return {
    statusCode,
    body: JSON.stringify({ data }),
    headers: {
      'Content-Type': 'application/json',
    },
  };
}
```

### D2 — Audit existing Lambdas for human-readable strings

The backend "no human languages" rule (spec §7.1) is the architectural foundation of the localization mechanism. This section requires auditing every Lambda from sessions 02-22, 26, 27, 28, and 21b for any place that returns a human-readable error message and replacing it with the error code + details pattern.

The audit checklist for each Lambda:
1. Search for any `body: JSON.stringify({ error: '<text with spaces>' })` — these are human-readable strings, must be converted to SCREAMING_SNAKE_CASE codes
2. Search for any `message: '<text>'` in error responses — same treatment
3. Search for hardcoded English strings used in `throw new Error('...')` that are exposed to the API response — replace with structured exceptions
4. For each error code introduced, add a corresponding entry to `frontend/src/locales/en/errors.yaml` with the human-readable English message

The audit is mechanical but tedious. The founder runs a single grep across the codebase as a starting point:

```bash
grep -rn "error:.*['\"][A-Za-z ][^_]*['\"]" backend/src/functions/
```

Any match where the value contains a space, lowercase letters, or punctuation is a candidate for conversion. The audit produces a CSV file listing every (Lambda, error string, suggested error code) tuple, which the founder reviews and applies.

**Tests first:** the existing Lambda test files are updated to assert the new error response shape:

```typescript
// Before (existing test)
expect(JSON.parse(result.body).error).toBe('Window cannot exceed 7 days');

// After
expect(JSON.parse(result.body).error).toBe('WINDOW_EXCEEDS_7_DAYS');
expect(JSON.parse(result.body).details).toEqual({ maxDays: 7, actualDays: 12 });
```

The test changes are committed alongside the Lambda changes. CI catches any drift.

### D3 — Inventory error codes per Lambda

For each session that defines Lambdas, the new error codes are documented in a comment block at the top of the Lambda file:

```typescript
// Error codes returned by this Lambda:
// - WINDOW_EXCEEDS_7_DAYS: details = { maxDays, actualDays }
// - BAY_COUNT_TOO_HIGH: details = { maxCount, actualCount }
// - INVALID_VAT_NUMBER: details = { providedValue }
// - STRIPE_AUTH_FAILED: details = { stripeErrorCode }
```

This serves as inline documentation and as a reference for the founder when populating `errors.yaml`. The docstring also helps Claude Code understand the error contract when working on the Lambda.

### D4 — Frontend error renderer

Create `frontend/src/lib/errors/localize-error.ts`:

```typescript
import { useTranslations } from 'next-intl';

export interface ApiErrorResponse {
  error: string;
  details?: Record<string, unknown>;
}

/**
 * Hook that returns a function to convert a Lambda error response into a
 * localized human-readable string.
 *
 * Usage in a client component:
 *   const localize = useLocalizeError();
 *   const message = localize(errorResponse);
 *   toast.error(message);
 */
export function useLocalizeError() {
  const t = useTranslations('errors');
  return (response: ApiErrorResponse): string => {
    try {
      return t(response.error, response.details ?? {});
    } catch {
      // Fallback if the error code isn't in the translation file
      console.warn(`[i18n] Missing translation for error code: ${response.error}`);
      return t('UNKNOWN_ERROR');
    }
  };
}
```

The fallback `UNKNOWN_ERROR` key is added to `errors.yaml` for all locales:

```yaml
# en/errors.yaml
UNKNOWN_ERROR: "An unexpected error occurred. Please try again or contact support."
```

```yaml
# fr-BE/errors.yaml (populated by translation script in Session 30)
UNKNOWN_ERROR: "Une erreur inattendue s'est produite. Veuillez réessayer ou contacter le support."
```

```yaml
# nl-BE/errors.yaml
UNKNOWN_ERROR: "Er is een onverwachte fout opgetreden. Probeer het opnieuw of neem contact op met de ondersteuning."
```

Server components use a parallel non-hook version (`localizeErrorServer(t, response)`) that takes the `t` function from `getTranslations` instead of pulling it from React context.

---

## PART E — UGC translation Lambdas

### E1 — `listing-translate` Lambda

**Trigger:** EventBridge rule subscribed to `listing.translation_required` events from `spotzy.listings`
**Implements:** Localization spec §9.2 — write-time translation pipeline

**Tests first:** `backend/__tests__/listings/listing-translate.test.ts`

```typescript
import { handler } from '../../src/functions/listings/listing-translate';
import { resetDynamoMock, getDynamoItem, seedListing } from '../helpers/dynamo-mock';
import { resetTranslateMock, mockTranslateText } from '../helpers/translate-mock';

beforeEach(() => {
  resetDynamoMock();
  resetTranslateMock();
});

describe('listing-translate Lambda', () => {
  test('translates title, description, accessInstructions into all non-source locales', async () => {
    await seedListing('listing-1', {
      title: 'Garage Avenue Louise',
      description: 'Garage spacieux et sécurisé.',
      accessInstructions: 'Entrez par la porte arrière, code 4521.',
      originalLocale: 'fr-BE',
      titleTranslations: { 'fr-BE': 'Garage Avenue Louise' },
      descriptionTranslations: { 'fr-BE': 'Garage spacieux et sécurisé.' },
      accessInstructionsTranslations: { 'fr-BE': 'Entrez par la porte arrière, code 4521.' },
    });

    mockTranslateText({
      'fr→en': { 'Garage Avenue Louise': 'Avenue Louise Garage' },
      'fr→nl': { 'Garage Avenue Louise': 'Garage Louizalaan' },
      // ... mocks for the other strings
    });

    await handler({
      detail: {
        listingId: 'listing-1',
        originalLocale: 'fr-BE',
        fieldsChanged: ['title', 'description', 'accessInstructions'],
        isPool: false,
      },
    } as any);

    const updated = await getDynamoItem('LISTING#listing-1', 'METADATA');
    expect(updated.titleTranslations).toEqual({
      'fr-BE': 'Garage Avenue Louise',
      'en': 'Avenue Louise Garage',
      'nl-BE': 'Garage Louizalaan',
    });
    // ... similar for description and accessInstructions
    expect(updated.translationsLastComputedAt).toBeDefined();
  });

  test('skips the originalLocale (no self-translation)', async () => {
    // The Translate API should never be called with sourceLanguageCode == targetLanguageCode
    await seedListing('listing-1', { originalLocale: 'fr-BE', /* ... */ });
    await handler({ detail: { listingId: 'listing-1', originalLocale: 'fr-BE', fieldsChanged: ['title'], isPool: false } } as any);

    const calls = getMockTranslateCalls();
    expect(calls.find((c) => c.SourceLanguageCode === 'fr' && c.TargetLanguageCode === 'fr')).toBeUndefined();
  });

  test('only translates the changed fields, not the entire listing', async () => {
    await seedListing('listing-1', { originalLocale: 'en', /* ... */ });
    await handler({ detail: { listingId: 'listing-1', originalLocale: 'en', fieldsChanged: ['title'], isPool: false } } as any);

    const calls = getMockTranslateCalls();
    // Only title was translated, not description or access instructions
    expect(calls.length).toBe(2); // 1 title × 2 target locales (fr-BE, nl-BE)
  });

  test('pool listing → also translates BAY# children', async () => {
    await seedListing('pool-1', { isPool: true, originalLocale: 'fr-BE', /* ... */ });
    await seedBay('pool-1', 'bay-1', { label: 'Garage A', originalLocale: 'fr-BE', /* ... */ });
    await seedBay('pool-1', 'bay-2', { label: 'Garage B', originalLocale: 'fr-BE', /* ... */ });

    await handler({ detail: { listingId: 'pool-1', originalLocale: 'fr-BE', fieldsChanged: ['title', 'description'], isPool: true } } as any);

    const bay1 = await getDynamoItem('LISTING#pool-1', 'BAY#bay-1');
    expect(bay1.labelTranslations).toEqual(expect.objectContaining({
      'fr-BE': 'Garage A',
      'en': expect.any(String),
      'nl-BE': expect.any(String),
    }));
  });

  test('Translate API throttle → retries with backoff and eventually succeeds', async () => {
    mockTranslateThrottle(2); // first 2 calls throttle, 3rd succeeds
    await seedListing('listing-1', { originalLocale: 'en', /* ... */ });
    await handler({ detail: { listingId: 'listing-1', originalLocale: 'en', fieldsChanged: ['title'], isPool: false } } as any);

    const updated = await getDynamoItem('LISTING#listing-1', 'METADATA');
    expect(updated.titleTranslations['fr-BE']).toBeDefined();
  });

  test('Translate API permanent failure → falls back to source text in target locale entry', async () => {
    mockTranslateError(new Error('Persistent failure'));
    await seedListing('listing-1', { title: 'Garage', originalLocale: 'en', /* ... */ });
    await handler({ detail: { listingId: 'listing-1', originalLocale: 'en', fieldsChanged: ['title'], isPool: false } } as any);

    const updated = await getDynamoItem('LISTING#listing-1', 'METADATA');
    // The fr-BE and nl-BE entries fall back to the English source text rather than being missing
    expect(updated.titleTranslations).toEqual({
      'en': 'Garage',
      'fr-BE': 'Garage',
      'nl-BE': 'Garage',
    });
  });

  test('skips translation for very short labels (≤ 3 chars)', async () => {
    // Auto-generated labels like "A-3" don't translate meaningfully
    await seedListing('pool-1', { isPool: true, originalLocale: 'en', /* ... */ });
    await seedBay('pool-1', 'bay-1', { label: 'A-3', originalLocale: 'en', /* ... */ });

    await handler({ detail: { listingId: 'pool-1', originalLocale: 'en', fieldsChanged: ['title'], isPool: true } } as any);

    const bay1 = await getDynamoItem('LISTING#pool-1', 'BAY#bay-1');
    expect(bay1.labelTranslations).toEqual({ 'en': 'A-3', 'fr-BE': 'A-3', 'nl-BE': 'A-3' });
    // Translate API should NOT have been called for this bay
    expect(getMockTranslateCalls().find((c) => c.Text === 'A-3')).toBeUndefined();
  });
});
```

**Implementation:** `backend/src/functions/listings/listing-translate/index.ts`

```typescript
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SUPPORTED_LOCALES, SupportedLocale } from '../../shared/locales/constants';
import { toTranslateLanguageCode } from '../../shared/locales/translate-language-code';

const translate = new TranslateClient({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.DYNAMODB_TABLE!;

const SHORT_TEXT_THRESHOLD = 4; // skip translation for strings ≤ 3 chars

interface TranslationEvent {
  detail: {
    listingId: string;
    originalLocale: SupportedLocale;
    fieldsChanged: string[];
    isPool: boolean;
  };
}

export const handler = async (event: TranslationEvent) => {
  const { listingId, originalLocale, fieldsChanged, isPool } = event.detail;

  // 1. Translate the parent listing fields
  await translateEntity(`LISTING#${listingId}`, 'METADATA', originalLocale, fieldsChanged);

  // 2. If it's a pool, translate the BAY# children too
  if (isPool) {
    const bays = await dynamo.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `LISTING#${listingId}`, ':prefix': 'BAY#' },
    }));
    for (const bay of bays.Items ?? []) {
      const bayOriginalLocale = (bay.originalLocale as SupportedLocale) ?? originalLocale;
      await translateEntity(bay.PK as string, bay.SK as string, bayOriginalLocale, ['label', 'accessInstructions']);
    }
  }
};

async function translateEntity(
  pk: string,
  sk: string,
  originalLocale: SupportedLocale,
  fields: string[]
): Promise<void> {
  const item = await dynamo.send(new GetCommand({ TableName: TABLE, Key: { PK: pk, SK: sk } }));
  if (!item.Item) return;

  const updates: Record<string, Record<string, string>> = {};

  for (const field of fields) {
    const sourceText = item.Item[field] as string | undefined;
    if (!sourceText) continue;

    const translations: Record<string, string> = { [originalLocale]: sourceText };

    // Skip translation for very short content
    if (sourceText.length < SHORT_TEXT_THRESHOLD) {
      for (const target of SUPPORTED_LOCALES) {
        translations[target] = sourceText;
      }
      updates[`${field}Translations`] = translations;
      continue;
    }

    for (const target of SUPPORTED_LOCALES) {
      if (target === originalLocale) continue;
      translations[target] = await translateWithRetry(sourceText, originalLocale, target);
    }

    updates[`${field}Translations`] = translations;
  }

  if (Object.keys(updates).length === 0) return;

  // Build the UpdateExpression
  const updateParts: string[] = [];
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, unknown> = {};

  for (const [field, translations] of Object.entries(updates)) {
    const namePh = `#${field.replace(/[^a-zA-Z]/g, '_')}`;
    const valuePh = `:${field.replace(/[^a-zA-Z]/g, '_')}`;
    updateParts.push(`${namePh} = ${valuePh}`);
    exprNames[namePh] = field;
    exprValues[valuePh] = translations;
  }
  updateParts.push('#tlcat = :tlcat');
  exprNames['#tlcat'] = 'translationsLastComputedAt';
  exprValues[':tlcat'] = new Date().toISOString();

  await dynamo.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: pk, SK: sk },
    UpdateExpression: 'SET ' + updateParts.join(', '),
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
  }));
}

async function translateWithRetry(
  text: string,
  source: SupportedLocale,
  target: SupportedLocale,
  maxRetries: number = 3
): Promise<string> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const result = await translate.send(new TranslateTextCommand({
        Text: text,
        SourceLanguageCode: toTranslateLanguageCode(source),
        TargetLanguageCode: toTranslateLanguageCode(target),
      }));
      return result.TranslatedText ?? text;
    } catch (err: any) {
      attempt++;
      if (err.name === 'ThrottlingException' && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
        continue;
      }
      // Permanent failure → fall back to source text
      console.error(`Translation failed for ${source}→${target}`, err);
      return text;
    }
  }
  return text;
}
```

### E2 — `translate-on-demand` Lambda

**Endpoint:** `POST /api/v1/translate`
**Auth:** Required (any persona)
**Implements:** Localization spec §9.3 — read-time translation with cache

**Request body:**
```typescript
{
  contentType: 'chat' | 'review' | 'dispute',
  sourceText: string,
  sourceLocale: SupportedLocale,
  targetLocale: SupportedLocale,
}
```

**Response:**
```typescript
{
  data: {
    translatedText: string,
    sourceLocale: string,
    cached: boolean,
  }
}
```

**Tests first:** `backend/__tests__/translate/translate-on-demand.test.ts`

- Cache hit → returns cached translation immediately, increments hit count
- Cache miss → calls Amazon Translate, writes to cache, returns
- Source locale equals target locale → no-op, returns source text
- Invalid locale → 400 INVALID_LOCALE
- Translate API failure → 503 TRANSLATION_UNAVAILABLE (NOT a fallback to source text — caller should retry or display original)
- Unauthenticated request → 401 UNAUTHENTICATED
- Dispute content uses 90-day TTL instead of 30-day

**Implementation:**

```typescript
import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SUPPORTED_LOCALES, SupportedLocale } from '../../shared/locales/constants';
import { toTranslateLanguageCode } from '../../shared/locales/translate-language-code';
import { getCachedTranslation, putCachedTranslation } from '../../shared/locales/translation-cache';
import { errorResponse, successResponse } from '../../shared/errors/error-response';
import type { APIGatewayProxyEvent } from 'aws-lambda';

const translate = new TranslateClient({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.DYNAMODB_TABLE!;

export const handler = async (event: APIGatewayProxyEvent) => {
  const body = JSON.parse(event.body ?? '{}');
  const { contentType, sourceText, sourceLocale, targetLocale } = body;

  // Validation
  if (!['chat', 'review', 'dispute'].includes(contentType)) {
    return errorResponse(400, 'INVALID_CONTENT_TYPE');
  }
  if (!SUPPORTED_LOCALES.includes(sourceLocale) || !SUPPORTED_LOCALES.includes(targetLocale)) {
    return errorResponse(400, 'INVALID_LOCALE', { providedSource: sourceLocale, providedTarget: targetLocale });
  }
  if (typeof sourceText !== 'string' || sourceText.length === 0) {
    return errorResponse(400, 'EMPTY_SOURCE_TEXT');
  }

  // No-op: source equals target
  if (sourceLocale === targetLocale) {
    return successResponse({ translatedText: sourceText, sourceLocale, cached: true });
  }

  // Cache check
  const cached = await getCachedTranslation(dynamo, TABLE, sourceText, sourceLocale, targetLocale);
  if (cached !== null) {
    return successResponse({ translatedText: cached, sourceLocale, cached: true });
  }

  // Translate
  let translatedText: string;
  try {
    const result = await translate.send(new TranslateTextCommand({
      Text: sourceText,
      SourceLanguageCode: toTranslateLanguageCode(sourceLocale),
      TargetLanguageCode: toTranslateLanguageCode(targetLocale),
    }));
    translatedText = result.TranslatedText ?? sourceText;
  } catch (err) {
    console.error('Translate API failure', err);
    return errorResponse(503, 'TRANSLATION_UNAVAILABLE');
  }

  // Cache write (don't await — fire and forget so we return fast to the user)
  putCachedTranslation(dynamo, TABLE, sourceText, sourceLocale, targetLocale, translatedText, contentType)
    .catch((err) => console.error('Failed to write translation cache', err));

  return successResponse({ translatedText, sourceLocale, cached: false });
};
```

### E3 — `users-update-preferences` Lambda extension

The existing Session 06 Lambda is updated to accept `preferredLocale` in the body. Validation rejects unsupported locales with 400 INVALID_LOCALE. On success, the profile is updated with the new locale and `preferredLocaleSetAt = now`.

### E4 — Frontend chat translation toggle

The chat UI (existing in Session 10) gets a small "Translate" link below each message that's in a different locale than the user's current locale. Clicking it calls `POST /api/v1/translate` and swaps the message text inline. A "View original" toggle is shown after the swap.

```typescript
// frontend/src/components/chat/MessageBubble.tsx
'use client';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

export function MessageBubble({ message }: { message: { id: string; body: string; originalLocale: string } }) {
  const currentLocale = useLocale();
  const t = useTranslations('chat');
  const [showTranslated, setShowTranslated] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const needsTranslation = message.originalLocale !== currentLocale;

  const handleTranslate = async () => {
    if (translatedText) {
      setShowTranslated(true);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentType: 'chat',
          sourceText: message.body,
          sourceLocale: message.originalLocale,
          targetLocale: currentLocale,
        }),
      });
      const data = await res.json();
      setTranslatedText(data.data.translatedText);
      setShowTranslated(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="message-bubble">
      <p>{showTranslated && translatedText ? translatedText : message.body}</p>
      {needsTranslation && (
        <div className="text-xs text-slate-500 mt-1">
          {showTranslated ? (
            <>
              <span>{t('translatedFrom', { locale: message.originalLocale })}</span>
              <button onClick={() => setShowTranslated(false)} className="ml-2 underline">
                {t('viewOriginal')}
              </button>
            </>
          ) : (
            <button onClick={handleTranslate} disabled={loading} className="underline">
              {loading ? t('translating') : t('translate', { locale: message.originalLocale })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

The same pattern applies to review cards and dispute messages.


---

## PART F — SES per-locale email templates

### F1 — `LocalizedEmailTemplate` CDK construct

Create `infrastructure/lib/constructs/localized-email-template.ts`:

```typescript
import { Construct } from 'constructs';
import * as ses from 'aws-cdk-lib/aws-ses';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SUPPORTED_LOCALES, SupportedLocale } from '../../../backend/src/shared/locales/constants';

export interface LocalizedEmailTemplateProps {
  family: string; // e.g. 'booking-confirmed'
  templatesDir: string; // path to the directory containing the per-locale files
}

/**
 * CDK construct that creates one SES template per supported locale.
 *
 * Reads HTML and text content from `{templatesDir}/{family}.{locale}.html`
 * and `{templatesDir}/{family}.{locale}.txt`, plus a subject line from
 * `{templatesDir}/{family}.{locale}.subject.txt`.
 *
 * Emits one CfnTemplate per locale, named `{family}-{locale}`.
 *
 * Usage:
 *   new LocalizedEmailTemplate(this, 'BookingConfirmed', {
 *     family: 'booking-confirmed',
 *     templatesDir: 'infrastructure/email-templates/booking-confirmed',
 *   });
 */
export class LocalizedEmailTemplate extends Construct {
  constructor(scope: Construct, id: string, props: LocalizedEmailTemplateProps) {
    super(scope, id);

    for (const locale of SUPPORTED_LOCALES) {
      const html = this.tryReadFile(join(props.templatesDir, `${props.family}.${locale}.html`));
      const text = this.tryReadFile(join(props.templatesDir, `${props.family}.${locale}.txt`));
      const subject = this.tryReadFile(join(props.templatesDir, `${props.family}.${locale}.subject.txt`));

      if (!html || !text || !subject) {
        throw new Error(
          `LocalizedEmailTemplate: missing template files for ${props.family}-${locale}. ` +
          `Expected: ${props.family}.${locale}.{html,txt,subject.txt} in ${props.templatesDir}`
        );
      }

      new ses.CfnTemplate(this, `Template-${locale}`, {
        template: {
          templateName: `${props.family}-${locale}`,
          subjectPart: subject.trim(),
          htmlPart: html,
          textPart: text,
        },
      });
    }
  }

  private tryReadFile(path: string): string | null {
    try {
      return readFileSync(path, 'utf-8');
    } catch {
      return null;
    }
  }
}
```

The construct enforces that every supported locale has a complete template set (HTML + text + subject). If any file is missing, CDK synth fails — which is the right behavior because deploying with a partial template set would silently break emails for the missing locale.

### F2 — Template directory structure

```
infrastructure/email-templates/
  welcome-spotter/
    welcome-spotter.en.html
    welcome-spotter.en.txt
    welcome-spotter.en.subject.txt
    welcome-spotter.fr-BE.html
    welcome-spotter.fr-BE.txt
    welcome-spotter.fr-BE.subject.txt
    welcome-spotter.nl-BE.html
    welcome-spotter.nl-BE.txt
    welcome-spotter.nl-BE.subject.txt
  booking-confirmed/
    booking-confirmed.en.html
    ... (9 files total)
  ... (29 family directories)
```

The English versions are written by the founder (in Claude Code). The fr-BE and nl-BE versions are generated by Session 30's translation script in batch mode against the email-templates directory. The script is aware of the file naming convention and produces the right output paths.

### F3 — Initial scaffold of all 29 template families

For the initial deployment, create empty placeholder files for all 87 templates (29 families × 3 locales × 3 file types = 261 files). The English versions can be filled in by the founder over the course of development; the fr-BE and nl-BE versions will be auto-generated by Session 30.

```bash
# infrastructure/scripts/scaffold-email-templates.sh
#!/usr/bin/env bash
set -e

FAMILIES=(
  welcome-spotter welcome-host welcome-spot-manager email-verification password-reset
  booking-confirmed booking-reminder booking-cancelled-by-host booking-cancelled-by-spotter booking-completed
  review-request dispute-opened dispute-resolved payout-sent
  rc-submission-confirmation rc-submission-approved rc-submission-rejected rc-submission-clarification-requested
  rc-expiry-reminder-30d rc-expiry-reminder-7d rc-expiry-suspended bay-swap-notification
  block-confirmation block-magic-link block-auth-success block-auth-failed
  block-auto-cancelled block-cancellation-receipt block-settlement
)

for family in "${FAMILIES[@]}"; do
  mkdir -p "infrastructure/email-templates/$family"
  for locale in en fr-BE nl-BE; do
    [ -f "infrastructure/email-templates/$family/$family.$locale.html" ] || \
      echo "<html><body><p>TODO: $family ($locale)</p></body></html>" > \
      "infrastructure/email-templates/$family/$family.$locale.html"
    [ -f "infrastructure/email-templates/$family/$family.$locale.txt" ] || \
      echo "TODO: $family ($locale)" > \
      "infrastructure/email-templates/$family/$family.$locale.txt"
    [ -f "infrastructure/email-templates/$family/$family.$locale.subject.txt" ] || \
      echo "TODO: $family ($locale) subject" > \
      "infrastructure/email-templates/$family/$family.$locale.subject.txt"
  done
done
```

The placeholders let CDK synth succeed from day one. The founder fills in real content as features land.

### F4 — Email template format with Handlebars-style interpolation

SES templates use `{{paramName}}` interpolation. Example template structure:

```html
<!-- infrastructure/email-templates/booking-confirmed/booking-confirmed.fr-BE.html -->
<!DOCTYPE html>
<html lang="fr-BE">
<head>
  <meta charset="UTF-8">
  <title>Réservation confirmée</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background:#004526;padding:20px;text-align:center;">
    <img src="https://spotzy.be/logo-white.png" alt="Spotzy" height="32"/>
  </div>
  <div style="padding:24px;">
    <h1 style="color:#004526;">Bonjour {{firstName}},</h1>
    <p>Votre réservation à <strong>{{listingName}}</strong> est confirmée.</p>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td><strong>Début</strong></td><td>{{startDate}}</td></tr>
      <tr><td><strong>Fin</strong></td><td>{{endDate}}</td></tr>
      <tr><td><strong>Total</strong></td><td>{{totalEur}} €</td></tr>
    </table>
    <p><a href="{{bookingUrl}}" style="background:#004526;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;">Voir ma réservation</a></p>
  </div>
  <div style="padding:16px;font-size:12px;color:#666;border-top:1px solid #eee;">
    Spotzy SRL · Bruxelles · <a href="https://spotzy.be/fr-BE/legal/terms-of-service">Conditions générales</a>
  </div>
</body>
</html>
```

```
# booking-confirmed.fr-BE.subject.txt
Réservation confirmée pour {{listingName}}
```

```
# booking-confirmed.fr-BE.txt
Bonjour {{firstName}},

Votre réservation à {{listingName}} est confirmée.
Début : {{startDate}}
Fin : {{endDate}}
Total : {{totalEur}} €

Voir ma réservation : {{bookingUrl}}

—
Spotzy SRL · Bruxelles
```

### F5 — Email-sending Lambda update pattern

Every Lambda from sessions 02-22, 26, 27 that sends an email is updated to:
1. Look up the recipient's `preferredLocale` from their profile (or use `guestPreferredLocale` for block reservation guests)
2. Compose the SES template name as `{family}-{locale}`
3. Pass interpolation parameters as the `TemplateData` JSON

Example update to the existing Session 26 RC submission confirmation Lambda:

```typescript
// In rc-submission-create Lambda, after the DynamoDB write
const profile = await getUserProfile(userId);
const locale = profile.preferredLocale ?? 'fr-BE';

await ses.send(new SendTemplatedEmailCommand({
  Source: 'noreply@spotzy.be',
  Destination: { ToAddresses: [profile.email] },
  Template: `rc-submission-confirmation-${locale}`,
  TemplateData: JSON.stringify({
    firstName: profile.firstName,
    submissionId: submissionId,
    expectedReviewDate: formatDateForLocale(addBusinessHours(now, 72), locale),
    dashboardUrl: `https://spotzy.be/${locale}/account/spot-manager`,
  }),
}));
```

The `formatDateForLocale` helper is added to `backend/src/shared/locales/format.ts`:

```typescript
import type { SupportedLocale } from './constants';

export function formatDateForLocale(date: Date | string, locale: SupportedLocale): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(d);
}

export function formatCurrencyForLocale(amount: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(amount);
}

export function formatTimeForLocale(date: Date | string, locale: SupportedLocale): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(d);
}
```

Tests cover all three helpers with each supported locale.

The pattern is mechanical: every email-sending Lambda gets the same 5-line treatment. The audit checklist:
1. Read `recipient.preferredLocale` (or `guestPreferredLocale`)
2. Default to `fr-BE` if missing
3. Compose `{family}-{locale}` template name
4. Pass typed interpolation parameters
5. URLs in the params include the locale prefix

---

## PART G — CDK additions

### G1 — Lambda function definitions

Add the new Lambdas to the appropriate stacks:

```typescript
// lib/api-stack.ts
const listingTranslateFn = mkLambda('ListingTranslate', 'functions/listings/listing-translate', {
  EVENT_BUS_NAME: eventBus.eventBusName,
});
mainTable.grantReadWriteData(listingTranslateFn);
listingTranslateFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['translate:TranslateText'],
  resources: ['*'],
}));

const translateOnDemandFn = mkLambda('TranslateOnDemand', 'functions/translate/translate-on-demand', {});
mainTable.grantReadWriteData(translateOnDemandFn);
translateOnDemandFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['translate:TranslateText'],
  resources: ['*'],
}));

addRoute(['translate'], 'POST', translateOnDemandFn);
```

### G2 — EventBridge rule for listing-translate

```typescript
const listingTranslationRule = new events.Rule(this, 'ListingTranslationRule', {
  eventBus,
  eventPattern: {
    source: ['spotzy.listings'],
    detailType: ['listing.translation_required'],
  },
});
listingTranslationRule.addTarget(new targets.LambdaFunction(listingTranslateFn));
```

### G3 — DynamoDB TTL on TRANSLATION_CACHE# rows

Enable DynamoDB TTL on the `expiresAtTtl` attribute of the `spotzy-main` table. Since the same TTL attribute is used by other rows from previous sessions (e.g., RC_SOFT_LOCK# from Session 26), the existing TTL configuration just needs to be confirmed — no new TTL config needed.

If the table doesn't have TTL enabled yet, add it:

```typescript
// In data-stack.ts
mainTable.addTimeToLiveAttribute('expiresAtTtl');
```

(This may already be in place from earlier sessions. Verify before adding.)

### G4 — SES templates via the LocalizedEmailTemplate construct

In the API stack (or a new EmailTemplatesStack to keep them isolated):

```typescript
import { LocalizedEmailTemplate } from './constructs/localized-email-template';

const EMAIL_FAMILIES = [
  'welcome-spotter', 'welcome-host', 'welcome-spot-manager',
  'email-verification', 'password-reset',
  'booking-confirmed', 'booking-reminder',
  'booking-cancelled-by-host', 'booking-cancelled-by-spotter', 'booking-completed',
  'review-request', 'dispute-opened', 'dispute-resolved', 'payout-sent',
  'rc-submission-confirmation', 'rc-submission-approved', 'rc-submission-rejected',
  'rc-submission-clarification-requested',
  'rc-expiry-reminder-30d', 'rc-expiry-reminder-7d', 'rc-expiry-suspended',
  'bay-swap-notification',
  'block-confirmation', 'block-magic-link', 'block-auth-success', 'block-auth-failed',
  'block-auto-cancelled', 'block-cancellation-receipt', 'block-settlement',
];

for (const family of EMAIL_FAMILIES) {
  new LocalizedEmailTemplate(this, `EmailTemplate-${family}`, {
    family,
    templatesDir: `infrastructure/email-templates/${family}`,
  });
}
```

This emits 87 `CfnTemplate` resources. CDK deploys them in a single stack update. Subsequent template content changes are picked up on the next `cdk deploy` because CDK detects file content changes via asset hashing.

### G5 — IAM permissions for Amazon Translate

The `listing-translate` and `translate-on-demand` Lambdas need IAM permission to call `translate:TranslateText`. Both grants are added in G1 above.

The `comprehend:DetectDominantLanguage` permission is NOT needed for v2.x because the source locale is always known explicitly (from the `Spotzy-Active-Locale` header at write time, or from the message's stored `originalLocale` at read time). Comprehend was used in the v1 spec for the migration backfill script, which is no longer in scope.

### G6 — CloudWatch budget alerts

Add budget alerts for the two cost lines from the localization spec §13:

```typescript
// Amazon Translate budget alert at €20/month
new budgets.CfnBudget(this, 'TranslateBudget', {
  budget: {
    budgetName: 'spotzy-amazon-translate',
    budgetType: 'COST',
    timeUnit: 'MONTHLY',
    budgetLimit: { amount: 20, unit: 'EUR' },
    costFilters: { Service: ['Amazon Translate'] },
  },
  notificationsWithSubscribers: [{
    notification: {
      notificationType: 'ACTUAL',
      comparisonOperator: 'GREATER_THAN',
      threshold: 80,
      thresholdType: 'PERCENTAGE',
    },
    subscribers: [{ subscriptionType: 'EMAIL', address: 'founder@spotzy.be' }],
  }],
});
```

The Claude API budget alert is configured separately in the Anthropic Console (CDK can't manage Anthropic resources).

---

## PART H — Integration tests + E2E

### H1 — Integration test: end-to-end listing translation flow

`backend/__tests__/integration/listing-translation.integration.test.ts`

```typescript
describe('Listing translation end-to-end', () => {
  test('Host creates listing in fr-BE → all three locales populated within 60 seconds', async () => {
    // 1. Seed a Host with Stripe Connect enabled
    await seedUserProfile('host-1', { stripeConnectEnabled: true, preferredLocale: 'fr-BE' });

    // 2. Create a listing via the listing-create Lambda with Spotzy-Active-Locale: fr-BE
    const createResult = await listingCreateHandler({
      headers: { 'Spotzy-Active-Locale': 'fr-BE' },
      body: JSON.stringify({
        title: 'Garage Avenue Louise',
        description: 'Garage spacieux et sécurisé au cœur de Bruxelles.',
        accessInstructions: 'Entrez par la porte arrière, code 4521.',
        // ... other required fields
      }),
    });
    expect(createResult.statusCode).toBe(201);
    const { listingId } = JSON.parse(createResult.body).data;

    // 3. Verify the LISTING# row has originalLocale and source-only translations
    let listing = await getDynamoItem(`LISTING#${listingId}`, 'METADATA');
    expect(listing.originalLocale).toBe('fr-BE');
    expect(listing.titleTranslations).toEqual({ 'fr-BE': 'Garage Avenue Louise' });

    // 4. Verify the EventBridge event was published
    const events = getMockedEventBridgeEvents();
    expect(events).toContainEqual(expect.objectContaining({
      DetailType: 'listing.translation_required',
      Detail: expect.stringContaining(listingId),
    }));

    // 5. Trigger the listing-translate Lambda directly (in real life, EventBridge fires it async)
    await listingTranslateHandler({
      detail: JSON.parse(events[0].Detail!),
    } as any);

    // 6. Verify translations are now populated
    listing = await getDynamoItem(`LISTING#${listingId}`, 'METADATA');
    expect(Object.keys(listing.titleTranslations)).toEqual(expect.arrayContaining(['en', 'fr-BE', 'nl-BE']));
    expect(Object.keys(listing.descriptionTranslations)).toEqual(expect.arrayContaining(['en', 'fr-BE', 'nl-BE']));
    expect(Object.keys(listing.accessInstructionsTranslations)).toEqual(expect.arrayContaining(['en', 'fr-BE', 'nl-BE']));
    expect(listing.translationsLastComputedAt).toBeDefined();

    // 7. Update the title and verify only the title is re-translated
    await listingUpdateHandler({
      pathParameters: { listingId },
      headers: { 'Spotzy-Active-Locale': 'fr-BE' },
      body: JSON.stringify({ title: 'Garage moderne Avenue Louise' }),
    });

    const updateEvents = getMockedEventBridgeEvents().slice(1);
    expect(JSON.parse(updateEvents[0].Detail!).fieldsChanged).toEqual(['title']);
  });

  test('Pool listing → all bays also translated', async () => {
    // Similar test but with isPool: true and 3 bays
    // Verify each BAY# row has populated *Translations after the listing-translate Lambda runs
  });

  test('Translate API failure → falls back to source text in target locales (graceful degradation)', async () => {
    // Verify the listing is still usable even if Amazon Translate is unavailable
  });
});
```

### H2 — Integration test: read-time translation cache

`backend/__tests__/integration/translation-cache.integration.test.ts`

```typescript
describe('Read-time translation caching', () => {
  test('first call → cache miss, calls Translate API, caches result', async () => {
    const result1 = await translateOnDemandHandler({
      body: JSON.stringify({
        contentType: 'chat',
        sourceText: 'Bonjour, où dois-je me garer ?',
        sourceLocale: 'fr-BE',
        targetLocale: 'nl-BE',
      }),
    } as any);

    expect(JSON.parse(result1.body).data.cached).toBe(false);
    expect(getMockedTranslateCalls()).toHaveLength(1);

    // Verify cache row exists
    const cacheKey = sha256('Bonjour, où dois-je me garer ?\u0000fr-BE\u0000nl-BE');
    const cached = await getDynamoItem(`TRANSLATION_CACHE#${cacheKey}`, 'METADATA');
    expect(cached).toBeDefined();
    expect(cached.expiresAtTtl).toBeGreaterThan(Math.floor(Date.now() / 1000) + 29 * 24 * 3600);
  });

  test('second call same input → cache hit, no Translate API call', async () => {
    // Pre-warm the cache with the previous test's content
    // ...
    resetMockedTranslateCalls();

    const result2 = await translateOnDemandHandler({
      body: JSON.stringify({
        contentType: 'chat',
        sourceText: 'Bonjour, où dois-je me garer ?',
        sourceLocale: 'fr-BE',
        targetLocale: 'nl-BE',
      }),
    } as any);

    expect(JSON.parse(result2.body).data.cached).toBe(true);
    expect(getMockedTranslateCalls()).toHaveLength(0);
  });

  test('dispute content uses 90-day TTL', async () => {
    await translateOnDemandHandler({
      body: JSON.stringify({
        contentType: 'dispute',
        sourceText: 'Ce stationnement n\'a pas été respecté.',
        sourceLocale: 'fr-BE',
        targetLocale: 'en',
      }),
    } as any);

    const cached = /* fetch the cache row */;
    expect(cached.expiresAtTtl).toBeGreaterThan(Math.floor(Date.now() / 1000) + 89 * 24 * 3600);
  });
});
```

### H3 — Playwright E2E: locale switcher and per-locale rendering

`e2e/localization.spec.ts`

```typescript
test.describe('Localization end-to-end', () => {
  test('bare URL redirects to resolved locale (fr-BE for unauthenticated French Accept-Language)', async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ 'Accept-Language': 'fr;q=0.9' });
    const response = await page.goto('https://staging.spotzy.be/listings/test-listing-1');
    expect(response?.url()).toBe('https://staging.spotzy.be/fr-BE/listings/test-listing-1');
    await expect(page.locator('h1')).toContainText('Garage'); // some French content
  });

  test('locale switcher changes URL, cookie, and content', async ({ page }) => {
    await page.goto('https://staging.spotzy.be/fr-BE/');

    // Click the locale switcher
    await page.click('[aria-label*="locale"]');
    await page.click('text=Nederlands');

    // Verify URL changed
    await expect(page).toHaveURL(/\/nl-BE\//);

    // Verify cookie was set
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'spotzy_locale')?.value).toBe('nl-BE');

    // Verify content is in Dutch
    await expect(page.locator('nav')).toContainText('Boekingen');
  });

  test('authenticated user → locale persists across sessions', async ({ page }) => {
    await loginAsTestUser(page, 'spotter-1');
    await page.goto('https://staging.spotzy.be/fr-BE/');

    // Switch to Dutch
    await page.click('[aria-label*="locale"]');
    await page.click('text=Nederlands');

    // Logout and log back in
    await page.click('text=Logout');
    await loginAsTestUser(page, 'spotter-1');

    // Should land on /nl-BE/ because the profile preference was persisted
    await expect(page).toHaveURL(/\/nl-BE\//);
  });

  test('chat translation toggle works', async ({ page }) => {
    // Pre-seed a chat conversation with one French message
    await page.goto('https://staging.spotzy.be/nl-BE/chat/conversation-1');

    // Find the French message and click "Translate"
    const message = page.locator('.message-bubble').first();
    await expect(message).toContainText('Bonjour'); // original French

    await message.locator('button:has-text("Translate")').click();

    // After translation, Dutch text should appear
    await expect(message).toContainText('Hallo'); // or whatever the Dutch translation is

    // "View original" toggle should be visible
    await expect(message.locator('button:has-text("View original")')).toBeVisible();
  });

  test('booking confirmation email sent in user locale', async ({ page }) => {
    // This test reads from a test mailbox (e.g., Mailpit) and verifies
    // that a fr-BE user receives an email with French subject and content
    // ...
  });
});
```

### H4 — Manual pre-launch checklist

The pre-launch checklist from spec §15.2 is documented as a runbook in `docs/pre-launch-i18n-checklist.md`. The founder runs through it before the public launch:

1. ✅ All UI strings translated (`npm run lint:i18n` passes)
2. ✅ All 87 email templates deployed (verify via `aws ses list-templates`)
3. ✅ Send a test email for each template family in each locale to a personal email and visually verify rendering
4. ✅ All 5 legal documents finalized in all three locales
5. ✅ Click through major user journeys in fr-BE on staging
6. ✅ Click through major user journeys in nl-BE on staging
7. ✅ Click through major user journeys in en on staging
8. ✅ Verify cookie consent banner appears for new visitors and renders in resolved locale
9. ✅ Verify legal document acceptance is recorded with version + locale
10. ✅ Verify locale switcher persists across page navigation and sessions
11. ✅ Verify Amazon Translate IAM permissions in production
12. ✅ Verify Claude API and Amazon Translate budget alerts are configured

---

## Acceptance criteria

A successful Claude Code run produces:

1. All shared helpers in `backend/src/shared/locales/` and `frontend/src/lib/locales/` (constants, types, resolve-locale, translation-cache, format helpers, yaml-loader)
2. Constants are mirrored frontend/backend with a sync test
3. Schema extensions on USER PROFILE, LISTING METADATA, BAY METADATA, BLOCKREQ guests, plus the TRANSLATION_CACHE# pattern
4. The locale resolution algorithm works identically on frontend and backend
5. Next.js middleware redirects bare URLs to the resolved locale via 308
6. The `[locale]` dynamic route segment wraps the entire app
7. next-intl is configured with the YAML loader
8. The locale switcher component works on every page
9. Type generation script produces `types.d.ts` for compile-time key checking
10. Backend Lambdas use the standard error response shape (no human-readable strings)
11. The frontend `useLocalizeError` hook converts error responses to localized messages
12. The listing-translate Lambda subscribes to EventBridge, translates listings + bays via Amazon Translate, handles retries and graceful degradation
13. The translate-on-demand Lambda serves chat/review/dispute translations with TRANSLATION_CACHE# caching
14. The chat UI has a working "Translate" / "View original" toggle
15. The LocalizedEmailTemplate CDK construct deploys 87 SES templates (29 families × 3 locales)
16. Every email-sending Lambda is updated to pick the locale-specific template
17. CloudWatch budget alerts for Amazon Translate are in place
18. Integration tests cover the end-to-end listing translation flow
19. Integration tests cover the read-time translation cache hit/miss behavior
20. Playwright E2E tests cover locale switcher, per-locale rendering, and chat translation

### Open questions

1. **Existing-page refactor for `[locale]` segment.** Wrapping every existing app route in `[locale]` is a one-time mechanical refactor that touches every page file. The session prompt assumes Claude Code can do it but flags it as the largest single chunk of work. If this is too unwieldy, the founder can do the refactor manually before running Session 29 and skip C4.

2. **Translation file content.** This session creates EMPTY translation files. The actual content (English source + auto-translated FR/NL) is produced by Session 30's translation script. Until Session 30 runs, every page renders empty strings or the key path itself (next-intl's default behavior on missing keys). The pre-launch checklist (H4) assumes Session 30 has run and populated the files.

3. **Email template content.** Same pattern — this session creates empty placeholder templates. The English content is written by the founder; the FR/NL content is generated by Session 30's translation script.

4. **Backoffice exemption.** The backoffice from Session 20 is intentionally NOT included in the `[locale]` refactor. It stays English-only. The middleware skips backoffice routes via the `pathname.startsWith('/admin')` check (add this to C3).

5. **Existing Lambda audit scope.** PART D2 requires auditing every Lambda in the codebase for human-readable error strings. This is mechanical but tedious. The session estimates 1-2 days of work depending on how many sessions have been deployed.

---

## Reading order for Claude Code

When feeding this file to Claude Code, the recommended sequence is:

1. **PART A** — shared helpers (constants, types, resolve-locale, yaml-loader, translation-cache, format helpers). Pure logic, easy to test, no external dependencies.
2. **PART B** — schema extensions and entity helpers. Updates existing Lambdas from sessions 02, 06, 26, 27 to capture locale and emit translation events.
3. **PART D** — backend error code convention. Audit and update existing Lambdas. Largest single chunk of work in this session.
4. **PART C** — frontend integration: install next-intl, write the YAML loader, refactor the app to `[locale]` segments, add the locale switcher.
5. **PART E** — UGC translation Lambdas: listing-translate (write-time) and translate-on-demand (read-time).
6. **PART F** — SES email templates: scaffold the directory, create the LocalizedEmailTemplate construct, update existing email-sending Lambdas.
7. **PART G** — CDK additions: wire up the Lambdas, EventBridge rule, IAM permissions, budget alerts.
8. **PART H** — integration tests + Playwright E2E.

The most critical risk is **PART D (the existing Lambda audit)**. If a Lambda continues returning human-readable strings, the user will see English text in a French page — a visible localization bug. The mitigation is the audit script + the test changes that assert the new error response shape. The founder should run the grep command (D2) and treat every match as a TODO item to be resolved before launch.

The second most critical risk is **PART C4 (the `[locale]` refactor)**. Every existing page must be moved into the `[locale]` directory. Static analysis can find them (`grep -rn 'app/(?!\\[locale\\])'`), but the refactor is mechanical and Claude Code should be able to walk through it page by page. If a page is missed, the middleware will 308-redirect users away from it — visible but recoverable.

The session is large enough that the founder may want to break it across multiple Claude Code runs. The recommended split:
- **Run 1**: PARTs A + B (shared helpers + schema extensions)
- **Run 2**: PART D (backend audit)
- **Run 3**: PART C (frontend refactor)
- **Run 4**: PART E (UGC Lambdas)
- **Run 5**: PARTs F + G + H (templates, CDK, tests)
---

