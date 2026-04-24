'use client';

import { BookingIntent } from '../hooks/useBookingIntent';
import { formatDateTimeShort } from '../lib/formatDate';

function formatDateRange(start: string, end: string): string {
  return `${formatDateTimeShort(start)} — ${formatDateTimeShort(end)}`;
}

export function BookingSummaryStrip({ intent }: { intent: BookingIntent }) {
  if (!intent.listingData) return null;

  const formattedPrice = intent.listingData.pricePerHour
    ? `from €${(intent.listingData.pricePerHour ?? 0).toFixed(2)}/hr`
    : '';

  return (
    <div
      data-testid="booking-summary-strip"
      className="flex items-center gap-3 bg-[#EBF7F1] border-l-2 border-[#004526] rounded-lg px-4 mb-6"
      style={{ height: 72 }}
    >
      {intent.listingData.primaryPhotoUrl ? (
        <img
          src={intent.listingData.primaryPhotoUrl}
          alt="Spot"
          className="w-12 h-12 rounded-md border border-[#004526]/20 object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded-md bg-gradient-to-br from-[#004526] to-[#006B3C] flex items-center justify-center flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
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
        {formattedPrice && <p className="text-xs font-bold text-[#004526] font-head">{formattedPrice}</p>}
      </div>
    </div>
  );
}
