'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { SUPPORTED_LOCALES, LOCALE_COOKIE_NAME, LOCALE_COOKIE_MAX_AGE_DAYS } from '../lib/locales/constants';

const LOCALE_NATIVE_NAMES: Record<string, string> = {
  en: 'English',
  'fr-BE': 'Français',
  'nl-BE': 'Nederlands',
};

export default function LocaleSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Extract current locale from URL
  const segments = pathname.split('/').filter(Boolean);
  const currentLocale = (SUPPORTED_LOCALES as readonly string[]).includes(segments[0])
    ? segments[0]
    : 'en';

  const switchTo = (newLocale: string) => {
    // Set the cookie
    document.cookie = `${LOCALE_COOKIE_NAME}=${newLocale}; max-age=${LOCALE_COOKIE_MAX_AGE_DAYS * 24 * 3600}; path=/; SameSite=Lax`;

    // If authenticated, persist to user profile (fire-and-forget)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl) {
      import('aws-amplify/auth').then(({ fetchAuthSession }) =>
        fetchAuthSession().then(session => {
          const token = session.tokens?.idToken?.toString();
          if (token) {
            fetch(`${apiUrl}/users/me`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ preferredLocale: newLocale }),
            }).catch(() => {});
          }
        }).catch(() => {})
      ).catch(() => {});
    }

    // Navigate to the new locale's URL
    const newPathname = (SUPPORTED_LOCALES as readonly string[]).includes(segments[0])
      ? '/' + newLocale + '/' + segments.slice(1).join('/')
      : '/' + newLocale + pathname;
    router.push(newPathname);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm text-[#004526] hover:text-[#006B3C] transition-colors"
        aria-label="Change language"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M2 12h20"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        <span className="hidden sm:inline">{LOCALE_NATIVE_NAMES[currentLocale] ?? 'English'}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[140px]">
            {SUPPORTED_LOCALES.map((locale) => (
              <button
                key={locale}
                onClick={() => switchTo(locale)}
                className={`block w-full text-left px-4 py-2 text-sm hover:bg-[#EBF7F1] first:rounded-t-lg last:rounded-b-lg ${
                  locale === currentLocale ? 'font-semibold text-[#004526]' : 'text-slate-700'
                }`}
              >
                {LOCALE_NATIVE_NAMES[locale]}
                {locale === currentLocale && ' \u2713'}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
