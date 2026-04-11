'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../hooks/useAuth';
import Navigation from './Navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface NavUser {
  userId: string;
  name: string;
  hasListings: boolean;
  isHost: boolean;
  isAdmin: boolean;
  isSpotManager: boolean;   // Session 26 — spotManagerStatus in STAGED or ACTIVE
  isBlockSpotter: boolean;  // Session 27 — has any BLOCKREQ#
}

export default function NavigationWrapper() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [navUser, setNavUser] = useState<NavUser | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setNavUser(null);
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
        if (!cancelled) {
          const smStatus = (profile.spotManagerStatus as string) ?? 'NONE';
          setNavUser({
            userId: user.userId,
            name: (profile.name as string) ?? user.email,
            hasListings: ((metrics.listingCount as number) ?? 0) > 0,
            isHost: (profile.isHost as boolean) ?? false,
            isAdmin: user.groups?.includes('admin') ?? false,
            isSpotManager: smStatus === 'STAGED' || smStatus === 'ACTIVE',
            isBlockSpotter: ((metrics.blockRequestCount as number) ?? 0) > 0,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNavUser({
            userId: user.userId,
            name: user.email,
            hasListings: false,
            isHost: false,
            isAdmin: user.groups?.includes('admin') ?? false,
            isSpotManager: false,
            isBlockSpotter: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.userId, user?.token]);

  // Poll unread count every 30s
  useEffect(() => {
    if (!user) { setUnreadCount(0); return; }
    let cancelled = false;
    const fetchUnread = () => {
      fetch(`${API_URL}/api/v1/messages/unread-count`, {
        headers: { Authorization: `Bearer ${user.token}` },
      })
        .then((r) => r.json())
        .then((data) => { if (!cancelled) setUnreadCount((data as { unreadCount: number }).unreadCount ?? 0); })
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user?.userId, user?.token]);

  return <Navigation user={navUser} unreadCount={unreadCount} />;
}
