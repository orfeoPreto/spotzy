'use client';

import { useState, useEffect } from 'react';
import { spotManagerApi } from '../../lib/apiUrls';

interface CheaperAlternative {
  type: 'SHORTER' | 'LONGER';
  durationHours: number;
  totalEur: number;
  savingsEur: number;
  description: string;
}

interface PriceQuote {
  totalEur: number;
  appliedTier: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  tierUnitsBilled: number;
  tierRateEur: number;
  durationHours: number;
  cheaperAlternatives: CheaperAlternative[];
}

interface BookingQuoteDisplayProps {
  listingId: string;
  startTime: string;  // ISO
  endTime: string;    // ISO
  token: string;
  onAdjustDates?: (newStart: string, newEnd: string) => void;
}

const TIER_BADGES: Record<PriceQuote['appliedTier'], { label: string; bg: string }> = {
  HOURLY: { label: 'Hourly rate', bg: 'bg-gray-100 text-gray-700' },
  DAILY: { label: 'Daily rate', bg: 'bg-[#e6f7ef] text-[#004526]' },
  WEEKLY: { label: 'Weekly rate', bg: 'bg-[#d1ecdc] text-[#003a1f]' },
  MONTHLY: { label: 'Monthly rate', bg: 'bg-[#b8dfc5] text-[#003a1f]' },
};

export function BookingQuoteDisplay({ listingId, startTime, endTime, token, onAdjustDates }: BookingQuoteDisplayProps) {
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchQuote() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(spotManagerApi('/api/v1/bookings/quote'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ listingId, startTime, endTime }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error || 'Failed to fetch quote');
          return;
        }
        setQuote(await res.json());
      } catch {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    }
    if (listingId && startTime && endTime) fetchQuote();
  }, [listingId, startTime, endTime, token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="animate-spin w-5 h-5 border-2 border-[#004526] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !quote) {
    return <p className="text-red-600 text-sm">{error || 'Quote unavailable'}</p>;
  }

  const badge = TIER_BADGES[quote.appliedTier];

  return (
    <div className="space-y-3">
      {/* Total + tier badge */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-gray-500">Total price</p>
          <p className="text-3xl font-bold text-[#004526]">€{quote.totalEur.toFixed(2)}</p>
        </div>
        <span className={`px-2 py-1 text-xs font-medium rounded-full ${badge.bg}`}>{badge.label}</span>
      </div>

      {/* Breakdown */}
      <p className="text-sm text-gray-600">
        {quote.tierUnitsBilled} × €{quote.tierRateEur.toFixed(2)} ({quote.durationHours}h booking)
      </p>

      {/* Cheaper alternatives */}
      {quote.cheaperAlternatives.length > 0 && (
        <div className="p-3 bg-[#fff8e6] border border-[#f0d88e] rounded-lg">
          <p className="text-sm font-medium text-[#7a5c00] mb-2">💡 Cheaper alternatives</p>
          {quote.cheaperAlternatives.map((alt, i) => (
            <div key={i} className="flex items-center justify-between text-sm mb-1 last:mb-0">
              <div>
                <span className="text-[#7a5c00]">{alt.description}</span>
                <span className="text-[#004526] font-semibold ml-2">Save €{alt.savingsEur.toFixed(2)}</span>
              </div>
              {onAdjustDates && (
                <button
                  onClick={() => {
                    // Compute new end time based on alt.durationHours
                    const start = new Date(startTime);
                    const newEnd = new Date(start.getTime() + alt.durationHours * 3600_000).toISOString();
                    onAdjustDates(startTime, newEnd);
                  }}
                  className="text-xs text-[#004526] hover:underline font-medium ml-2"
                >
                  Adjust
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
