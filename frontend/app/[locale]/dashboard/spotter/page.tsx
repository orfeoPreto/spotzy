'use client';

import { useEffect, useState } from 'react';
import BookingCard, { type Booking } from '../../../../components/BookingCard';
import CancelModal from '../../../../components/CancelModal';
import ModifyModal from '../../../../components/ModifyModal';
import RatingModal from '../../../../components/RatingModal';
import { useAuth } from '../../../../hooks/useAuth';

type Tab = 'upcoming' | 'past';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

const UPCOMING_STATUSES = new Set(['CONFIRMED', 'ACTIVE', 'PENDING_PAYMENT']);

function deriveBookingStatus(b: Booking): string {
  if (b.status !== 'CONFIRMED') return b.status;
  const start = b.startDate ?? b.startTime ?? '';
  const end = b.endDate ?? b.endTime ?? '';
  const now = Date.now();
  if (end && new Date(end).getTime() <= now) return 'COMPLETED';
  if (start && new Date(start).getTime() <= now) return 'ACTIVE';
  return 'CONFIRMED';
}

export default function SpotterDashboardPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [modifyTarget, setModifyTarget] = useState<Booking | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Booking | null>(null);

  const fetchBookings = () => {
    if (!user) return;
    fetch(`${API_URL}/api/v1/users/me/bookings`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        const all = (d as { bookings: Booking[] }).bookings;
        const enriched = all
          .filter((b) => b.spotterId === user?.userId)
          .map((b) => ({ ...b, status: deriveBookingStatus(b) }));
        setBookings(enriched);
      });
  };

  useEffect(() => { fetchBookings(); }, [user?.userId]);

  const visibleBookings = bookings.filter((b) =>
    tab === 'upcoming' ? UPCOMING_STATUSES.has(b.status) : b.status === 'COMPLETED',
  );

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">My bookings</h1>

      {/* Tabs */}
      <div role="tablist" className="mb-6 flex gap-2 border-b border-gray-200">
        {(['upcoming', 'past'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? 'border-b-2 border-[#AD3614] text-[#AD3614]'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {visibleBookings.map((b) => (
          <BookingCard
            key={b.bookingId}
            booking={b}
            viewAs="spotter"
            onCancel={setCancelTarget}
            onModify={setModifyTarget}
            onReview={setReviewTarget}
          />
        ))}
        {visibleBookings.length === 0 && (
          <p className="text-center text-sm text-gray-400">No {tab} bookings.</p>
        )}
      </div>

      {cancelTarget && (
        <CancelModal
          booking={cancelTarget}
          refundAmount={cancelTarget.totalPrice}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => { setCancelTarget(null); fetchBookings(); }}
        />
      )}

      {modifyTarget && (
        <ModifyModal
          booking={{
            ...modifyTarget,
            status: modifyTarget.status,
            pricePerHour: (() => {
              const s = modifyTarget.startDate ?? modifyTarget.startTime;
              const e = modifyTarget.endDate ?? modifyTarget.endTime;
              if (modifyTarget.pricePerHour) return modifyTarget.pricePerHour;
              if (s && e && modifyTarget.totalPrice) {
                const hours = (new Date(e).getTime() - new Date(s).getTime()) / 3600000;
                return hours > 0 ? modifyTarget.totalPrice / hours : modifyTarget.totalPrice;
              }
              return modifyTarget.totalPrice ?? 0;
            })(),
          }}
          onClose={() => setModifyTarget(null)}
          onModified={() => { setModifyTarget(null); fetchBookings(); }}
        />
      )}

      {reviewTarget && user && (
        <RatingModal
          bookingId={reviewTarget.bookingId}
          token={user.token}
          onClose={() => setReviewTarget(null)}
          onSubmitted={() => fetchBookings()}
        />
      )}
    </main>
  );
}
