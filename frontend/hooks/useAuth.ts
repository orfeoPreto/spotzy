'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

export interface AuthUser {
  userId: string;
  email: string;
  token: string;
}

export function useAuth(): { user: AuthUser | null; isLoading: boolean } {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const [session, current] = await Promise.all([
        fetchAuthSession(),
        getCurrentUser(),
      ]);
      const token = session.tokens?.idToken?.toString() ?? '';
      const email = (session.tokens?.idToken?.payload?.email as string) ?? '';
      const userId = current.userId;
      if (token) {
        setUser({ userId, email, token });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();

    // Listen for auth events (signIn, signOut, tokenRefresh)
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn' || payload.event === 'signedOut' || payload.event === 'tokenRefresh') {
        checkAuth();
      }
    });

    return () => unsubscribe();
  }, [checkAuth]);

  return { user, isLoading };
}
