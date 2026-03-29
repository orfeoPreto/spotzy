'use client';

import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export function useListYourSpotDestination(): { destination: string; loading: boolean } {
  const { user, isLoading } = useAuth();
  const [destination, setDestination] = useState('/auth/register?intent=host');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setDestination('/auth/register?intent=host');
      setLoading(false);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch(`${API_URL}/api/v1/users/me`, {
        headers: { Authorization: `Bearer ${user.token}` },
      }).then((r) => r.json()),
      fetch(`${API_URL}/api/v1/users/me/metrics`, {
        headers: { Authorization: `Bearer ${user.token}` },
      }).then((r) => r.json()),
    ])
      .then(([profile, metrics]) => {
        if (cancelled) return;
        const hasStripe = (profile as Record<string, unknown>).stripeConnectEnabled === true;
        const hasListings = ((metrics as Record<string, unknown>).listingCount as number ?? 0) > 0;
        setDestination(hasStripe || hasListings ? '/listings/new' : '/become-host');
      })
      .catch(() => {
        if (!cancelled) setDestination('/become-host');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.userId, isLoading]);

  return { destination, loading };
}
