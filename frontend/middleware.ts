import { NextRequest, NextResponse } from 'next/server';
import { SUPPORTED_LOCALES, LOCALE_COOKIE_NAME, DEFAULT_LOCALE } from './lib/locales/constants';

/**
 * Locale routing middleware (spec §2.2 + §12.5).
 *
 * - URLs with a valid locale prefix pass through
 * - URLs without a locale prefix get 308-redirected to the resolved locale
 * - Static assets, API routes, and backoffice are exempt
 *
 * NOTE: This middleware only runs in dev mode (NODE_ENV !== 'production')
 * because production uses `output: 'export'` (static HTML). For production,
 * CloudFront Functions or Lambda@Edge will handle locale redirects.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static assets, API routes, Next.js internals, and backoffice
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/backoffice') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Extract the first path segment to check if it's a locale prefix
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  const hasLocalePrefix = firstSegment && (SUPPORTED_LOCALES as readonly string[]).includes(firstSegment);

  if (hasLocalePrefix) {
    // URL already has a valid locale prefix; pass through
    const response = NextResponse.next();
    response.headers.set('Spotzy-Active-Locale', firstSegment);
    return response;
  }

  // No valid locale prefix → resolve and 308-redirect
  const localeCookie = request.cookies.get(LOCALE_COOKIE_NAME)?.value;
  const acceptLanguage = request.headers.get('accept-language') ?? '';

  let resolvedLocale: string = DEFAULT_LOCALE;

  // Check cookie first
  if (localeCookie && (SUPPORTED_LOCALES as readonly string[]).includes(localeCookie)) {
    resolvedLocale = localeCookie;
  } else {
    // Parse Accept-Language
    const entries = acceptLanguage
      .split(',')
      .map((entry) => {
        const [lang, ...params] = entry.trim().split(';');
        const qParam = params.find((p) => p.trim().startsWith('q='));
        const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1.0;
        return { lang: lang.trim().toLowerCase(), q };
      })
      .sort((a, b) => b.q - a.q);

    for (const entry of entries) {
      // Exact match
      const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === entry.lang);
      if (exact) { resolvedLocale = exact; break; }

      // Family match: "fr" → "fr-BE"
      const familyMatch =
        SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(entry.lang + '-')) ??
        SUPPORTED_LOCALES.find((l) => l.toLowerCase() === entry.lang);
      if (familyMatch) { resolvedLocale = familyMatch; break; }
    }
  }

  const redirectUrl = new URL(`/${resolvedLocale}${pathname}${request.nextUrl.search}`, request.url);
  return NextResponse.redirect(redirectUrl, 308);
}

export const config = {
  matcher: [
    // Match every path except _next, api, static, backoffice, and files with extensions
    '/((?!_next|api|static|backoffice|.*\\..*).*)',
  ],
};
