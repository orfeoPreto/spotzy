'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function BecomeHostClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Handle Stripe return with ?payout=success
  useEffect(() => {
    if (params.get('payout') !== 'success' || !user) return;
    setConfirming(true);
    fetch(`${API_URL}/api/v1/users/me/become-host`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(() => router.push('/listings/new'))
      .catch(() => setConfirming(false));
  }, [user?.token, params]);

  const handleSetupPayouts = async () => {
    if (!user) { router.push('/auth/login'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/users/me/payout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const { onboardingUrl } = await res.json() as { onboardingUrl: string };
      window.location.href = onboardingUrl;
    } catch {
      setLoading(false);
    }
  };

  if (confirming) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F0F7F3]">
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#006B3C] animate-bounce">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-[#004526]">Payout account connected!</p>
          <p className="text-sm text-gray-500">Taking you to create your listing…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F0F7F3] p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-10 shadow-lg text-center space-y-6">
        <div
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#004526] shadow-lg"
          style={{ animation: 'spin360 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-[#004526]">Finish setting up your host account</h1>
          <p className="mt-2 text-sm text-gray-500">
            Connecting a Stripe payout account is required before you can list parking spots. This is a one-time
            setup and takes about 2 minutes.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleSetupPayouts()}
          disabled={loading}
          className="w-full rounded-lg bg-[#006B3C] py-3 text-sm font-semibold text-white hover:bg-[#004526] disabled:opacity-50 transition-colors"
        >
          {loading ? 'Opening Stripe…' : 'Set up payouts with Stripe'}
        </button>

        <div className="rounded-lg bg-[#FFF4E5] border border-[#FFD89A] p-3 text-left">
          <p className="text-xs text-[#8C5A00]">
            <strong>Required step.</strong> Until you complete Stripe onboarding, you won't be able to create
            listings or receive payouts. You'll remain on this screen whenever you try to access host features.
          </p>
        </div>

        <p className="text-xs text-gray-400">
          Powered by Stripe Connect — your banking details are handled securely by Stripe, not stored by Spotzy.
        </p>
      </div>
      <style>{`@keyframes spin360 { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </main>
  );
}
