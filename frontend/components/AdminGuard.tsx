'use client';

import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLocalizedRouter } from '../lib/locales/useLocalizedRouter';

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useLocalizedRouter();

  useEffect(() => {
    if (!isLoading && (!user || !user.groups?.includes('admin'))) {
      router.replace('/');
    }
  }, [user, isLoading, router]);

  if (isLoading || !user?.groups?.includes('admin')) return null;
  return <>{children}</>;
}
