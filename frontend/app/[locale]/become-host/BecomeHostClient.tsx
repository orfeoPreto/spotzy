'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '../../../hooks/useAuth';
import { useTranslation } from '../../../lib/locales/TranslationProvider';
import { useLocalizedRouter } from '../../../lib/locales/useLocalizedRouter';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function BecomeHostClient() {
  const { t } = useTranslation('notifications');
  const router = useLocalizedRouter();
  const params = useSearchParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
        <div className="text-center space-y-3 animate-page-enter">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#059669] animate-bounce shadow-forest">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-[#004526] font-head">{t('become_host.connected_title')}</p>
          <p className="text-sm text-[#4B6354]">{t('become_host.redirecting')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F0F7F3] p-6 animate-page-enter">
      <div className="w-full max-w-[480px] rounded-2xl bg-white p-10 shadow-md-spotzy text-center space-y-6">
        <div className="spin-360 mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#004526] shadow-forest">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-[#004526] font-head">{t('become_host.setup_title')}</h1>
          <p className="mt-2 text-sm text-[#4B6354]">
            {t('become_host.setup_description')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleSetupPayouts()}
          disabled={loading}
          className="grow-btn w-full rounded-lg bg-[#006B3C] py-3 text-[15px] font-semibold text-white font-head hover:bg-[#005A30] disabled:opacity-50 shadow-forest transition-colors"
        >
          {loading ? t('become_host.opening_stripe') : t('become_host.setup_button')}
        </button>

        <div className="rounded-lg bg-[#F5E6E1] border border-[#D4826A] p-3 text-left">
          <p className="text-xs text-[#AD3614]">
            {t('become_host.required_label')} {t('become_host.required_description')}
          </p>
        </div>

        <p className="text-xs text-[#4B6354]">
          {t('become_host.stripe_note')}
        </p>
      </div>
    </main>
  );
}
