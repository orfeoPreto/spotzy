'use client';

import { useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useListing } from '../../../hooks/useListing';
import { useBookingFlow } from '../../../hooks/useBookingFlow';
import { useAuth } from '../../../hooks/useAuth';
import { getStripe } from '../../../lib/stripe';

const STEP_LABELS = ['Review', 'Payment', 'Confirmation'];

// ─── Step indicator ─────────────────────────────────────────────────────────
function StepIndicator({ step }: { step: number }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-4">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
            step === i + 1 ? 'bg-[#006B3C] text-white' : step > i + 1 ? 'bg-[#004526] text-white' : 'bg-gray-200 text-gray-500'
          }`}>
            {i + 1}
          </div>
          <span className={`text-sm font-medium ${step === i + 1 ? 'text-[#AD3614]' : 'text-gray-500'}`}>
            {label}
          </span>
          {i < STEP_LABELS.length - 1 && <div className="h-px w-8 bg-gray-300" />}
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Review ──────────────────────────────────────────────────────────
function ReviewStep({
  address, spotType, startDate, endDate, subtotal, platformFee, total, onProceed,
}: {
  address: string; spotType: string; startDate: string; endDate: string;
  subtotal: number; platformFee: number; total: number; onProceed: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 p-4">
        <h2 className="mb-2 font-semibold text-gray-900">{address}</h2>
        <p className="text-sm text-gray-600">{spotType}</p>
      </div>

      <div className="rounded-xl border border-gray-200 p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">Your dates</h3>
        <p className="text-sm text-gray-600">{startDate}</p>
        <p className="text-sm text-gray-600">to {endDate}</p>
      </div>

      <div className="rounded-xl border border-gray-200 p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span>Subtotal</span>
          <span>€{subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Service fee (15%)</span>
          <span>€{platformFee.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm font-bold border-t border-gray-200 pt-2">
          <span>Total</span>
          <span>€{total.toFixed(2)}</span>
        </div>
      </div>

      <div className="rounded-xl bg-amber-50 p-4">
        <p className="text-xs font-semibold text-amber-800 mb-1">Cancellation policy</p>
        <p className="text-xs text-amber-700">Full refund if cancelled 48h+ before start. 50% refund within 24–48h. No refund within 24h.</p>
      </div>

      <button
        type="button"
        onClick={onProceed}
        className="w-full rounded-lg bg-[#006B3C] py-3 text-sm font-medium text-white"
      >
        Proceed to payment
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
    <div className="space-y-4">
      <PaymentElement />
      <button
        type="button"
        onClick={handlePay}
        disabled={paying}
        className="w-full rounded-lg bg-[#006B3C] py-3 text-sm font-medium text-white disabled:opacity-50"
      >
        {paying ? 'Processing…' : `Pay €${total.toFixed(2)}`}
      </button>
    </div>
  );
}

// ─── Step 3: Confirmation ─────────────────────────────────────────────────
function ConfirmationStep({ bookingId, bookingRef }: { bookingId: string; bookingRef: string }) {
  const router = useRouter();
  return (
    <div className="space-y-6 text-center">
      <div className="flex items-center justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#006B3C]">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="h-8 w-8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>
      <div>
        <h2 className="text-xl font-bold text-gray-900">Booking confirmed!</h2>
        <p className="mt-1 text-sm text-gray-500">Your reference</p>
        <p className="mt-1 font-mono text-lg font-bold text-[#004526]">{bookingRef}</p>
      </div>
      <div className="flex flex-col gap-3">
        <a
          href={`/chat/${bookingId}`}
          className="w-full rounded-lg border border-[#004526] py-2.5 text-sm font-medium text-[#004526] text-center"
        >
          Message host
        </a>
        <button
          type="button"
          className="w-full rounded-lg bg-gray-100 py-2.5 text-sm font-medium text-gray-700"
        >
          Get directions
        </button>
        <button
          type="button"
          onClick={() => router.push('/dashboard/spotter')}
          className="w-full rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white"
        >
          View booking
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────
export default function BookPage() {
  const pathname = usePathname();
  const id = pathname.split('/').filter(Boolean)[1] ?? '';
  const router = useRouter();
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

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

  const handleProceedToPayment = async () => {
    if (!user) { router.push('/auth/login'); return; }
    setProceedError('');
    try {
      // Create booking — backend expects startTime/endTime as ISO strings
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
        const err = await res.json().catch(() => null) as { message?: string; error?: string } | null;
        setProceedError(err?.message ?? err?.error ?? 'Could not create booking. Please try again.');
        return;
      }
      const booking = await res.json() as { bookingId: string; reference?: string };
      flow.setBookingId(booking.bookingId);
      setBookingRef(booking.reference ?? booking.bookingId);

      // Create payment intent
      const piRes = await fetch(`${API_URL}/api/v1/payments/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ bookingId: booking.bookingId }),
      });
      if (!piRes.ok) {
        const err = await piRes.json().catch(() => null) as { message?: string } | null;
        setProceedError(err?.message ?? 'Could not initialise payment. Please try again.');
        return;
      }
      const pi = await piRes.json() as { clientSecret: string };
      setClientSecret(pi.clientSecret);
    } catch {
      setProceedError('Network error. Please check your connection.');
      return;
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
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{proceedError}</div>
          )}
          <ReviewStep
            address={listing.address}
            spotType={listing.spotType}
            startDate={flow.dates.startDate}
            endDate={flow.dates.endDate}
            subtotal={flow.subtotal}
            platformFee={flow.platformFee}
            total={flow.total}
            onProceed={() => void handleProceedToPayment()}
          />
        </>
      )}

      {flow.step === 2 && (
        <div className="space-y-4">
          {payError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{payError}</div>
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
