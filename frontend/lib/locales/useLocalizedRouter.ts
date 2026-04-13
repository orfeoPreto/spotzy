'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from './constants';

/**
 * Returns a router whose push/replace methods automatically prepend the
 * current locale prefix to absolute paths.
 *
 * Usage:
 *   const router = useLocalizedRouter();
 *   router.push('/search');  // → navigates to /fr-BE/search (if current locale is fr-BE)
 */
export function useLocalizedRouter() {
  const router = useRouter();
  const pathname = usePathname();

  const locale = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] && (SUPPORTED_LOCALES as readonly string[]).includes(segments[0])) {
      return segments[0];
    }
    return DEFAULT_LOCALE;
  }, [pathname]);

  return useMemo(
    () => ({
      ...router,
      push: (path: string, options?: any) => {
        router.push(localizePath(path, locale), options);
      },
      replace: (path: string, options?: any) => {
        router.replace(localizePath(path, locale), options);
      },
      locale,
    }),
    [router, locale],
  );
}

function localizePath(path: string, locale: string): string {
  // Don't prefix external URLs, anchors, or paths that already have a locale
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const firstSegment = path.split('/').filter(Boolean)[0];
  if (firstSegment && (SUPPORTED_LOCALES as readonly string[]).includes(firstSegment)) {
    return path; // Already has locale prefix
  }
  return `/${locale}${path}`;
}

/**
 * Utility to prepend locale to a path. Useful for <Link href>.
 */
export function useLocalizePath() {
  const pathname = usePathname();
  const locale = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] && (SUPPORTED_LOCALES as readonly string[]).includes(segments[0])) {
      return segments[0];
    }
    return DEFAULT_LOCALE;
  }, [pathname]);

  return (path: string) => localizePath(path, locale);
}
