'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import Footer from './Footer';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function FooterWrapper() {
  const { user } = useAuth();
  const [footerUser, setFooterUser] = useState<{ userId: string; isHost: boolean } | null>(null);

  useEffect(() => {
    if (!user) { setFooterUser(null); return; }
    let cancelled = false;
    fetch(`${API_URL}/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((r) => r.json())
      .then((profile) => {
        if (!cancelled) {
          setFooterUser({
            userId: user.userId,
            isHost: (profile as Record<string, unknown>).isHost === true,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFooterUser({ userId: user.userId, isHost: false });
        }
      });
    return () => { cancelled = true; };
  }, [user?.userId, user?.token]);

  return <Footer user={footerUser} />;
}
