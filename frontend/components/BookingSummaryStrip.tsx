'use client';

import { BookingIntent } from '../hooks/useBookingIntent';

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${fmt(s)} — ${fmt(e)}`;
}

export function BookingSummaryStrip({ intent }: { intent: BookingIntent }) {
  if (!intent.listingData) return null;

  const formattedPrice = intent.listingData.pricePerHour
    ? `from €${intent.listingData.pricePerHour.toFixed(2)}/hr`
    : '';

  return (
    <div
      data-testid="booking-summary-strip"
      className="flex items-center gap-3 bg-[#EBF7F1] border-l-2 border-[#004526] rounded-lg px-4 py-3 mb-6"
    >
      {intent.listingData.primaryPhotoUrl ? (
        <img
          src={intent.listingData.primaryPhotoUrl}
          alt="Spot"
          className="w-12 h-12 rounded-md border border-[#C8DDD2] object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded-md bg-[#B8E6D0] flex items-center justify-center flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#004526" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />
          </svg>
        </div>
      )}
      <div className="min-w-0">
        <p data-testid="booking-summary-address" className="text-sm font-medium text-[#1C2B1A] truncate">
          {intent.listingData.address}
        </p>
        <p className="text-xs text-[#4B6354]">{formatDateRange(intent.startTime, intent.endTime)}</p>
        {formattedPrice && <p className="text-xs font-semibold text-[#004526]">{formattedPrice}</p>}
      </div>
    </div>
  );
}
