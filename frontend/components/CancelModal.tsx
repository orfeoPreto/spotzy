'use client';

import { useState, useEffect } from 'react';

interface CancelBooking {
  bookingId: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  totalPrice: number;
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

export default function CancelModal({ booking, refundAmount, onClose, onCancelled }: CancelModalProps) {
  const startDate = booking.startDate ?? booking.startTime ?? '';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoursLeft, setHoursLeft] = useState(() => hoursUntil(startDate));

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
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Cancel booking?</h2>

        {withinDeadline && (
          <p className="mb-3 text-sm text-amber-700">
            ⏱ {Math.max(0, Math.ceil(hoursLeft))} hours remaining before start — time remaining
          </p>
        )}

        {refundAmount > 0 ? (
          <div className="mb-4 rounded-xl bg-green-50 p-4 text-center">
            <p className="text-xs text-gray-500">You will receive</p>
            <p className="text-2xl font-bold text-green-700">€{refundAmount.toFixed(2)}</p>
            <p className="text-xs text-gray-500">refund</p>
          </div>
        ) : (
          <div className="mb-4 rounded-xl bg-gray-100 p-4 text-center">
            <p className="text-sm text-gray-500">No refund applies</p>
            <p className="text-xl font-bold text-gray-400">€0.00</p>
          </div>
        )}

        {error && (
          <div role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
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

        <div className="flex gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 disabled:opacity-50"
          >
            Keep my booking
          </button>
          <button
            type="button"
            aria-label="Yes, cancel"
            disabled={loading}
            onClick={handleCancel}
            className="flex-1 rounded-lg bg-[#C0392B] py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? (
              <span data-testid="spinner" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              'Yes, cancel'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
