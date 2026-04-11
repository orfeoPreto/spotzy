'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../hooks/useAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

/**
 * Forces users who registered with role=HOST but haven't completed Stripe Connect
 * back to /become-host. Renders nothing; runs as a side-effect-only component in
 * the root layout.
 *
 * Public/auth/become-host/marketing pages are exempt.
 */
const EXEMPT_PREFIXES = [
  '/auth',          // login, register, verify
  '/become-host',   // the destination itself
  '/claim',         // public magic-link landing
  '/privacy',
];

// Only the root landing page is exempt. /search is NOT exempt so host-role
// users without Stripe can't sit on the search page indefinitely — the guard
// redirects them to /become-host to complete mandatory payout setup.
const EXEMPT_EXACT = new Set(['/']);

export default function StripeSetupGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (isLoading || !user) return;

    const isExempt = EXEMPT_EXACT.has(pathname) ||
      EXEMPT_PREFIXES.some(prefix => pathname.startsWith(prefix));
    if (isExempt) { setChecked(true); return; }

    let cancelled = false;

    fetch(`${API_URL}/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(profile => {
        if (cancelled || !profile) { setChecked(true); return; }
        const intendedRole = profile.role;
        const stripeDone = profile.stripeConnectEnabled === true;
        if (intendedRole === 'HOST' && !stripeDone) {
          router.replace('/become-host');
          return;
        }
        setChecked(true);
      })
      .catch(() => { if (!cancelled) setChecked(true); });

    return () => { cancelled = true; };
  }, [user?.userId, user?.token, pathname, isLoading, router]);

  return null;
}
