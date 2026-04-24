'use client';

import { useState, useRef, useEffect } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import { useLocalizedRouter } from '../../../../lib/locales/useLocalizedRouter';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useListing } from '../../../../hooks/useListing';
import { useBookingFlow } from '../../../../hooks/useBookingFlow';
import { useAuth } from '../../../../hooks/useAuth';
import { getStripe } from '../../../../lib/stripe';
import { formatDateTime } from '../../../../lib/formatDate';
import { useTranslation } from '../../../../lib/locales/TranslationProvider';
import { useLocalizeError } from '../../../../lib/errors/useLocalizeError';

const STEP_KEYS = ['steps.review', 'steps.payment', 'steps.confirmation'];

// ─── Step indicator ─────────────────────────────────────────────────────────
function StepIndicator({ step }: { step: number }) {
  const { t } = useTranslation('booking');
  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {STEP_KEYS.map((key, i) => {
        const isActive = step === i + 1;
        const isCompleted = step > i + 1;
        return (
          <div key={key} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold font-head transition-all ${
              isActive
                ? 'bg-spotzy-forest text-white shadow-forest'
                : isCompleted
                  ? 'bg-spotzy-primary text-white'
                  : 'bg-spotzy-mist text-spotzy-slate'
            }`}>
              {isCompleted ? (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l3.5 3.5L13 5" />
                </svg>
              ) : (
                <span className="text-xs">{i + 1}</span>
              )}
              {t(key)}
            </div>
            {i < STEP_KEYS.length - 1 && (
              <div className={`h-px w-6 ${step > i + 1 ? 'bg-spotzy-primary' : 'bg-spotzy-mint'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Review ──────────────────────────────────────────────────────────
interface PriceBreakdown {
  hostNetTotalEur: number;
  hostVatRate: number;
  hostVatEur: number;
  hostGrossTotalEur: number;
  platformFeePct: number;
  platformFeeEur: number;
  platformFeeVatRate: number;
  platformFeeVatEur: number;
  spotterGrossTotalEur: number;
  appliedTier: string;
  tierUnitsBilled: number;
  tierRateEur: number;
  durationHours: number;
}

function ReviewStep({
  address, spotType, startDate, endDate, subtotal, platformFee, total, onProceed, disabled, breakdown,
}: {
  address: string; spotType: string; startDate: string; endDate: string;
  subtotal: number; platformFee: number; total: number; onProceed: () => void; disabled?: boolean;
  breakdown?: PriceBreakdown | null;
}) {
  const { t } = useTranslation('booking');
  const { t: tCommon } = useTranslation('common');
  return (
    <div className="space-y-6 animate-page-enter">
      {/* Spot summary card — Forest 4px left accent */}
      <div className="rounded-xl border border-spotzy-mint bg-white p-4 pl-5 shadow-sm-spotzy"
           style={{ borderLeft: '4px solid #004526' }}>
        <h2 className="mb-1 font-head font-semibold text-spotzy-forest">{address}</h2>
        <p className="text-sm text-spotzy-slate">{spotType}</p>
      </div>

      {/* Dates */}
      <div className="rounded-xl border border-spotzy-mint bg-spotzy-sage p-4">
        <h3 className="mb-2 font-head text-sm font-semibold text-spotzy-forest">{t('review.dates_heading')}</h3>
        <p className="text-sm text-spotzy-slate">{formatDateTime(startDate)}</p>
        <p className="text-sm text-spotzy-slate">{t('review.dates_separator')} {formatDateTime(endDate)}</p>
      </div>

      {/* Price breakdown */}
      {breakdown ? (
        <div className="rounded-xl border border-spotzy-mint bg-white p-4 shadow-sm-spotzy space-y-2">
          <div className="flex justify-between text-sm text-spotzy-slate">
            <span>{breakdown.appliedTier} x {breakdown.tierUnitsBilled}</span>
            <span>{'\u20AC'}{breakdown.hostNetTotalEur.toFixed(2)}</span>
          </div>
          {breakdown.hostVatRate > 0 && (
            <div className="flex justify-between text-sm text-spotzy-slate">
              <span>{t('review.host_vat', { rate: (breakdown.hostVatRate * 100).toFixed(0) })}</span>
              <span>{'\u20AC'}{breakdown.hostVatEur.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm text-spotzy-slate">
            <span>{t('review.service_fee_pct', { pct: (breakdown.platformFeePct * 100).toFixed(0) })}</span>
            <span>{'\u20AC'}{breakdown.platformFeeEur.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-spotzy-slate">
            <span>{t('review.vat_on_service_fee')}</span>
            <span>{'\u20AC'}{breakdown.platformFeeVatEur.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-spotzy-brick pt-2">
            <span className="font-head text-sm font-bold text-spotzy-forest">{t('review.total')}</span>
            <span className="font-head text-sm font-bold text-spotzy-forest">{'\u20AC'}{breakdown.spotterGrossTotalEur.toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-spotzy-mint bg-white p-4 shadow-sm-spotzy space-y-2">
          <div className="flex justify-between text-sm text-spotzy-slate">
            <span>{t('review.subtotal')}</span>
            <span>{'\u20AC'}{subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-spotzy-slate">
            <span>{t('review.service_fee')}</span>
            <span>{'\u20AC'}{platformFee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-spotzy-brick pt-2">
            <span className="font-head text-sm font-bold text-spotzy-forest">{t('review.total')}</span>
            <span className="font-head text-sm font-bold text-spotzy-forest">{'\u20AC'}{total.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Cancellation policy — Brick light info box */}
      <div className="rounded-xl bg-spotzy-brick-light border border-spotzy-brick-border p-4">
        <p className="font-head text-xs font-semibold text-spotzy-brick mb-1">{t('review.cancellation_heading')}</p>
        <p className="text-xs text-spotzy-brick">{t('review.cancellation_policy')}</p>
      </div>

      <button
        type="button"
        onClick={onProceed}
        disabled={disabled}
        className="w-full rounded-lg bg-spotzy-primary py-3 font-head text-sm font-semibold text-white transition-all hover:bg-spotzy-forest active:scale-[0.98] disabled:opacity-50"
      >
        {disabled ? tCommon('status.processing') : t('review.proceed_button')}
      </button>
    </div>
  );
}

// ─── Payment form (inner) ─────────────────────────────────────────────────
function PaymentForm({
  total, listingId, bookingId, onSuccess, onError,
}: {
  total: number; listingId: string; bookingId: string;
  onSuccess: () => void; onError: (msg: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setPaying(true);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      } as any);

      if (result.error) {
        onError(result.error.message ?? 'Payment failed');
      } else {
        onSuccess();
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="space-y-4 animate-page-enter">
      {/* Stripe PaymentElement inherits Forest border / Emerald focus via appearance API on the Elements provider */}
      <div className="rounded-xl border border-spotzy-forest bg-spotzy-sage p-4 focus-within:ring-2 focus-within:ring-spotzy-primary focus-within:ring-offset-1 transition-shadow">
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>
      <button
        type="button"
        onClick={handlePay}
        disabled={paying}
        className="w-full rounded-lg bg-spotzy-forest py-3 font-head text-sm font-semibold text-white shadow-forest transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
      >
        {paying ? 'Processing\u2026' : `Pay \u20AC${total.toFixed(2)}`}
      </button>
    </div>
  );
}

// ─── Step 3: Confirmation ─────────────────────────────────────────────────
function ConfirmationStep({ bookingId, bookingRef }: { bookingId: string; bookingRef: string }) {
  const { t } = useTranslation('booking');
  const router = useLocalizedRouter();
  return (
    <div className="space-y-6 text-center animate-page-enter">
      {/* Success icon */}
      <div className="flex items-center justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-spotzy-forest shadow-forest">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="h-10 w-10">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      {/* Heading */}
      <div>
        <h2 className="font-head text-[32px] font-bold leading-tight text-spotzy-forest">
          {t('confirmation.title')}
        </h2>
        <p className="mt-2 text-sm text-spotzy-slate">{t('confirmation.reference_label')}</p>
        {/* Booking ref — JetBrains Mono, Forest bg, white text */}
        <div className="mt-2 inline-block rounded-lg bg-spotzy-forest px-4 py-2">
          <span className="font-mono text-base font-bold tracking-widest text-white">{bookingRef}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => router.push(`/chat/${bookingId}`)}
          className="w-full rounded-lg border border-spotzy-forest py-2.5 font-head text-sm font-semibold text-spotzy-forest transition-all hover:bg-spotzy-sage active:scale-[0.98]"
        >
          {t('confirmation.message_host')}
        </button>
        <button
          type="button"
          onClick={() => router.push('/dashboard/spotter')}
          className="w-full rounded-lg bg-spotzy-primary py-2.5 font-head text-sm font-semibold text-white transition-all hover:bg-spotzy-forest active:scale-[0.98]"
        >
          {t('confirmation.view_booking')}
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────
export default function BookPage() {
  const { t: tBooking } = useTranslation('booking');
  const localizeError = useLocalizeError();
  const pathname = usePathname();
  const id = pathname.split('/').filter(Boolean)[2] ?? '';
  const router = useLocalizedRouter();
  const searchParams = useSearchParams();
  const { listing } = useListing(id);

  const initialDates = {
    startDate: searchParams.get('startDate') ?? '',
    endDate: searchParams.get('endDate') ?? '',
  };

  const flow = useBookingFlow(id, listing?.pricePerHour ?? 0, initialDates);
  const { user } = useAuth();
  const [bookingRef, setBookingRef] = useState('');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [payError, setPayError] = useState('');
  const [proceedError, setProceedError] = useState('');
  const [proceeding, setProceeding] = useState(false);
  const proceedingRef = useRef(false);
  const [quoteBreakdown, setQuoteBreakdown] = useState<PriceBreakdown | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

  // Fetch quote breakdown from API when dates are set
  useEffect(() => {
    if (!user || !id || !flow.dates.startDate || !flow.dates.endDate) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/bookings/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
          body: JSON.stringify({
            listingId: id,
            startTime: flow.dates.startDate,
            endTime: flow.dates.endDate,
          }),
        });
        if (res.ok && !cancelled) {
          const data = await res.json() as PriceBreakdown;
          setQuoteBreakdown(data);
        }
      } catch {
        // Silently fall back to flat display
      }
    })();
    return () => { cancelled = true; };
  }, [user, id, flow.dates.startDate, flow.dates.endDate, API_URL]);

  const handleProceedToPayment = async () => {
    if (!user) { router.push('/auth/login'); return; }
    if (proceedingRef.current) return;
    proceedingRef.current = true;
    setProceeding(true);
    setProceedError('');
    try {
      let currentBookingId = flow.bookingId;

      // Only create booking if one doesn't exist yet
      if (!currentBookingId) {
        const res = await fetch(`${API_URL}/api/v1/bookings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
          body: JSON.stringify({
            listingId: id,
            startTime: flow.dates.startDate,
            endTime: flow.dates.endDate,
          }),
        });
        if (res.status === 401) { router.push('/auth/login'); return; }
        if (!res.ok) {
          const err = await res.json().catch(() => null) as { message?: string; error?: string; details?: Record<string, unknown> } | null;
          setProceedError(localizeError(err) || tBooking('create_error'));
          return;
        }
        const booking = await res.json() as { bookingId: string; reference?: string };
        currentBookingId = booking.bookingId;
        flow.setBookingId(booking.bookingId);
        setBookingRef(booking.reference ?? booking.bookingId);
      }

      // Create payment intent
      const piRes = await fetch(`${API_URL}/api/v1/payments/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ bookingId: currentBookingId }),
      });
      if (!piRes.ok) {
        const err = await piRes.json().catch(() => null) as { message?: string; error?: string; details?: Record<string, unknown> } | null;
        setProceedError(localizeError(err) || tBooking('payment_init_error'));
        return;
      }
      const pi = await piRes.json() as { clientSecret: string };
      setClientSecret(pi.clientSecret);
    } catch {
      setProceedError('Network error. Please check your connection.');
      return;
    } finally {
      proceedingRef.current = false;
      setProceeding(false);
    }
    flow.advanceStep();
  };

  const handlePaymentSuccess = () => {
    flow.advanceStep();
  };

  const handlePaymentError = (msg: string) => {
    setPayError(msg);
  };

  return (
    <main className="mx-auto max-w-lg p-8">
      <StepIndicator step={flow.step} />

      {flow.step === 1 && listing && (
        <>
          {proceedError && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{proceedError}</div>
          )}
          <ReviewStep
            address={listing.address}
            spotType={listing.spotType}
            startDate={flow.dates.startDate}
            endDate={flow.dates.endDate}
            subtotal={flow.subtotal}
            platformFee={flow.platformFee}
            total={quoteBreakdown?.spotterGrossTotalEur ?? flow.total}
            onProceed={() => void handleProceedToPayment()}
            disabled={proceeding}
            breakdown={quoteBreakdown}
          />
        </>
      )}

      {flow.step === 2 && (
        <div className="space-y-4">
          {payError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{payError}</div>
          )}
          {clientSecret ? (
            <Elements stripe={getStripe()} options={{ clientSecret }}>
              <PaymentForm
                total={flow.total}
                listingId={id}
                bookingId={flow.bookingId ?? ''}
                onSuccess={handlePaymentSuccess}
                onError={handlePaymentError}
              />
            </Elements>
          ) : (
            <Elements stripe={getStripe()} options={{}}>
              <PaymentForm
                total={flow.total}
                listingId={id}
                bookingId={flow.bookingId ?? ''}
                onSuccess={handlePaymentSuccess}
                onError={handlePaymentError}
              />
            </Elements>
          )}
        </div>
      )}

      {flow.step === 3 && (
        <ConfirmationStep bookingId={flow.bookingId ?? ''} bookingRef={bookingRef} />
      )}
    </main>
  );
}
