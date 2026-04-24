'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '../lib/locales/TranslationProvider';

interface CancelBooking {
  bookingId: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  totalPrice: number;
  status?: string;
}

interface CancelModalProps {
  booking: CancelBooking;
  refundAmount: number;
  onClose: () => void;
  onCancelled: () => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
const WITHIN_48H_MS = 48 * 60 * 60 * 1000;

function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60);
}

/** Refund tiers: >24h = 100%, 12-24h = 50%, <12h = 0% */
function calculateRefund(totalPrice: number, hoursLeft: number): number {
  if (hoursLeft > 24) return totalPrice;
  if (hoursLeft >= 12) return parseFloat((totalPrice * 0.5).toFixed(2));
  return 0;
}

async function getAuthToken(): Promise<string> {
  try {
    // Dynamically import Amplify Auth to avoid SSR issues
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch {
    return '';
  }
}

export default function CancelModal({ booking, refundAmount: _refundAmountProp, onClose, onCancelled }: CancelModalProps) {
  const { t } = useTranslation('booking');
  const startDate = booking.startDate ?? booking.startTime ?? '';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoursLeft, setHoursLeft] = useState(() => hoursUntil(startDate));

  const isActive = booking.status === 'ACTIVE';

  // Calculate refund based on tiered policy (>24h=100%, 12-24h=50%, <12h=0%)
  const refundAmount = calculateRefund(booking.totalPrice, hoursLeft);

  // Determine refund tier label
  const refundTierLabel = hoursLeft > 24
    ? t('cancel.tier_full')
    : hoursLeft >= 12
      ? t('cancel.tier_half')
      : t('cancel.tier_none');

  const withinDeadline = new Date(startDate).getTime() - Date.now() < WITHIN_48H_MS &&
    new Date(startDate).getTime() > Date.now();

  useEffect(() => {
    if (!withinDeadline) return;
    const id = setInterval(() => setHoursLeft(hoursUntil(startDate)), 60_000);
    return () => clearInterval(id);
  }, [startDate, withinDeadline]);

  const handleCancel = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_URL}/api/v1/bookings/${booking.bookingId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        onCancelled();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? 'Cancellation failed. Please try again.');
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg-spotzy animate-page-enter">
        <h2 className="mb-4 font-head text-lg font-bold text-spotzy-forest">{t('cancel.modal_title')}</h2>

        {withinDeadline && (
          <p className="mb-3 rounded-lg bg-spotzy-brick-light border border-spotzy-brick-border px-3 py-2 text-sm text-spotzy-brick">
            {Math.max(0, Math.ceil(hoursLeft))}h remaining before start
          </p>
        )}

        {isActive ? (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-200 p-4 text-center">
            <p className="text-sm font-semibold text-red-700">{t('cancel.active_error')}</p>
            <p className="text-xs text-spotzy-slate mt-1">{t('cancel.active_message')}</p>
          </div>
        ) : refundAmount > 0 ? (
          <div className="mb-4 rounded-xl bg-spotzy-sage border border-spotzy-mint p-4 text-center">
            <p className="text-xs text-spotzy-slate">{t('cancel.will_receive')}</p>
            <p className="font-head text-[28px] font-bold text-spotzy-park">&euro;{refundAmount.toFixed(2)}</p>
            <p className="text-xs text-spotzy-slate">{t('cancel.refund_label')}</p>
            <p className="mt-1 text-xs text-spotzy-slate/70">{refundTierLabel}</p>
          </div>
        ) : (
          <div className="mb-4 rounded-xl bg-spotzy-mist border border-spotzy-mint p-4 text-center">
            <p className="text-sm text-spotzy-slate">{t('cancel.no_refund')}</p>
            <p className="font-head text-[28px] font-bold text-spotzy-slate">&euro;0.00</p>
            <p className="mt-1 text-xs text-spotzy-slate/70">{refundTierLabel}</p>
          </div>
        )}

        {error && (
          <div role="alert" className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
            <button
              type="button"
              aria-label="Try again"
              onClick={() => setError(null)}
              className="ml-2 underline"
            >
              Try again
            </button>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {/* Destructive — full width, red */}
          <button
            type="button"
            aria-label="Yes, cancel"
            disabled={loading || isActive}
            onClick={handleCancel}
            className="w-full rounded-lg bg-red-600 py-2.5 font-head text-sm font-semibold text-white transition-all hover:bg-red-700 active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? (
              <span data-testid="spinner" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              t('cancel.confirm_button')
            )}
          </button>
          {/* Safe option — Forest ghost */}
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="w-full rounded-lg border border-spotzy-forest py-2.5 font-head text-sm font-semibold text-spotzy-forest transition-all hover:bg-spotzy-sage active:scale-[0.98] disabled:opacity-50"
          >
            {t('cancel.keep_button')}
          </button>
        </div>
      </div>
    </div>
  );
}
