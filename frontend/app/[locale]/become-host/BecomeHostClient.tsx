'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../hooks/useAuth';
import { useTranslation } from '../../../lib/locales/TranslationProvider';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function BecomeHostClient() {
  const { t } = useTranslation('notifications');
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
          <p className="text-lg font-semibold text-[#004526]">{t('become_host.connected_title')}</p>
          <p className="text-sm text-gray-500">{t('become_host.redirecting')}</p>
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
          <h1 className="text-2xl font-bold text-[#004526]">{t('become_host.setup_title')}</h1>
          <p className="mt-2 text-sm text-gray-500">
            {t('become_host.setup_description')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleSetupPayouts()}
          disabled={loading}
          className="w-full rounded-lg bg-[#006B3C] py-3 text-sm font-semibold text-white hover:bg-[#004526] disabled:opacity-50 transition-colors"
        >
          {loading ? t('become_host.opening_stripe') : t('become_host.setup_button')}
        </button>

        <div className="rounded-lg bg-[#FFF4E5] border border-[#FFD89A] p-3 text-left">
          <p className="text-xs text-[#8C5A00]">
            {t('become_host.required_label')} {t('become_host.required_description')}
          </p>
        </div>

        <p className="text-xs text-gray-400">
          {t('become_host.stripe_note')}
        </p>
      </div>
      <style>{`@keyframes spin360 { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </main>
  );
}
