'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../hooks/useAuth';

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && (!user || !user.groups?.includes('admin'))) {
      router.replace('/');
    }
  }, [user, isLoading, router]);

  if (isLoading || !user?.groups?.includes('admin')) return null;
  return <>{children}</>;
}
