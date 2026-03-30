'use client';

import Link from 'next/link';
import StatusBadge from './StatusBadge';

export interface Booking {
  bookingId: string;
  listingId: string;
  address: string;
  spotterName?: string;
  spotterId?: string;
  hostName?: string;
  hostId?: string;
  status: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  totalPrice: number;
  pricePerHour?: number;
  reference?: string;
  hasReview?: boolean;
}

interface BookingCardProps {
  booking: Booking;
  viewAs: 'host' | 'spotter';
  onCancel?: (b: Booking) => void;
  onModify?: (b: Booking) => void;
  onReview?: (b: Booking) => void;
}

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function isEndingSoon(endDate: string) {
  return new Date(endDate).getTime() - Date.now() < 24 * 60 * 60 * 1000;
}

const UPCOMING_STATUSES = new Set(['CONFIRMED', 'ACTIVE', 'PENDING_PAYMENT']);

export default function BookingCard({ booking, viewAs, onCancel, onModify, onReview }: BookingCardProps) {
  const startDate = booking.startDate ?? booking.startTime ?? '';
  const endDate = booking.endDate ?? booking.endTime ?? '';
  const isUpcoming = UPCOMING_STATUSES.has(booking.status);
  const soon = isEndingSoon(endDate);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {soon && isUpcoming && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          ⚠ Ending soon — ends in less than 24h
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href={`/listing/${booking.listingId}`}
            data-testid="booking-spot-link"
            className="truncate font-medium text-[#004526] hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {booking.address || 'View listing'}
          </Link>
          {viewAs === 'host' && booking.spotterName && booking.spotterId && (
            <Link
              href={`/users/${booking.spotterId}`}
              data-testid="booking-person-link"
              className="text-sm text-[#004526] hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {booking.spotterName}
            </Link>
          )}
          {viewAs === 'spotter' && booking.hostName && booking.hostId && (
            <Link
              href={`/users/${booking.hostId}`}
              data-testid="booking-person-link"
              className="text-sm text-[#004526] hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {booking.hostName}
            </Link>
          )}
          <p className="text-xs text-gray-500">
            {formatDate(startDate)} — {formatDate(endDate)}
          </p>
          <p className="mt-1 text-sm font-semibold text-[#004526]">€{booking.totalPrice.toFixed(2)}</p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/chat/${booking.bookingId}`}
          data-testid="booking-message-btn"
          className="flex items-center gap-1 rounded-lg border border-[#004526] px-3 py-1 text-xs font-medium text-[#004526] hover:bg-[#EBF7F1] transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
          </svg>
          Message
        </Link>
        {viewAs === 'spotter' && isUpcoming && (
          <>
            {onModify && (
              <button type="button" onClick={() => onModify(booking)}
                className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700">
                Modify
              </button>
            )}
            {onCancel && booking.status !== 'ACTIVE' && (
              <button type="button" onClick={() => onCancel(booking)}
                className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-600">
                Cancel
              </button>
            )}
          </>
        )}
        {booking.status === 'COMPLETED' && !booking.hasReview && onReview && (
          <button type="button" onClick={() => onReview(booking)}
            className="rounded-lg bg-[#006B3C] px-3 py-1 text-xs font-medium text-white">
            Leave a review
          </button>
        )}
        <Link
          href={`/dispute/${booking.bookingId}`}
          data-testid="booking-report-btn"
          className="flex items-center gap-1 rounded-lg border border-[#AD3614] px-3 py-1 text-xs font-medium text-[#AD3614] hover:bg-[#F5E6E1] transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          Report an issue
        </Link>
      </div>
    </div>
  );
}
