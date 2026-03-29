'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import BookingCard, { type Booking } from '../../../components/BookingCard';
import StatusBadge from '../../../components/StatusBadge';
import { useAuth } from '../../../hooks/useAuth';

interface Metrics { activeBookings: number; mtdEarnings: number; liveListings: number; avgRating: number }
interface Listing { listingId: string; address: string; status: string; bookingCount: number }

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="grow rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#004526]">{value}</p>
    </div>
  );
}

function statusBadgeClass(status: string) {
  if (status === 'LIVE') return 'bg-[#006B3C] text-white';
  if (status === 'UNDER_REVIEW') return 'bg-[#006B3C] text-white';
  return 'bg-[#B0BEC5] text-white';
}

export default function HostDashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  useEffect(() => {
    if (!user) return;
    const headers = { Authorization: `Bearer ${user.token}` };

    fetch(`${API_URL}/api/v1/users/me/metrics`, { headers })
      .then((r) => r.json())
      .then((d) => { setMetrics(d as Metrics); setLoadingMetrics(false); })
      .catch(() => setLoadingMetrics(false));

    fetch(`${API_URL}/api/v1/users/me/listings`, { headers })
      .then((r) => r.json())
      .then((d) => setListings((d as { listings: Listing[] }).listings));

    fetch(`${API_URL}/api/v1/users/me/bookings`, { headers })
      .then((r) => r.json())
      .then((d) => {
        const all = (d as { bookings: Booking[] }).bookings;
        // Only show bookings where others booked the user's listings (exclude own spotter bookings)
        setBookings(all.filter((b) => b.spotterId !== user?.userId));
      });
  }, [user?.userId]);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Host Dashboard</h1>

      {/* Metrics row */}
      {loadingMetrics ? (
        <div data-testid="metrics-skeleton" className="mb-6 grid grid-cols-4 gap-4">
          {[0,1,2,3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      ) : metrics && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard label="Active bookings" value={metrics.activeBookings} />
          <MetricCard label="MTD earnings" value={`€${metrics.mtdEarnings.toFixed(2)}`} />
          <MetricCard label="Live listings" value={metrics.liveListings} />
          <MetricCard label="Avg rating" value={metrics.avgRating.toFixed(1)} />
        </div>
      )}

      {/* Listings section */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">My listings</h2>
          <button type="button" onClick={() => router.push('/listings/new')}
            className="grow-btn rounded-lg bg-[#006B3C] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#004526]">
            + Add listing
          </button>
        </div>

        {listings !== null && listings.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-gray-300 p-8 text-center">
            <p className="mb-3 text-gray-500">You haven&apos;t listed any spots yet.</p>
            <button type="button" onClick={() => router.push('/listings/new')}
              className="grow-btn rounded-lg bg-[#006B3C] px-5 py-2 text-sm font-medium text-white hover:bg-[#004526]">
              Add your first spot
            </button>
          </div>
        )}

        {listings && listings.length > 0 && (
          <div className="space-y-3">
            {listings.map((l) => (
              <div key={l.listingId} className="grow flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
                <div>
                  <p className="font-medium text-gray-900">{l.address}</p>
                  <p className="text-xs text-gray-500">{l.bookingCount} bookings</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => router.push(`/listing/${l.listingId}/availability`)}
                    className="text-xs text-[#004526] hover:underline"
                  >
                    Edit availability
                  </button>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusBadgeClass(l.status)}`}>
                    {l.status === 'UNDER_REVIEW' ? 'Under review' : l.status.toLowerCase().replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Upcoming bookings */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Upcoming bookings</h2>
        {bookings.length === 0 && (
          <p className="text-sm text-gray-400">No upcoming bookings.</p>
        )}
        <div className="space-y-3">
          {bookings.map((b) => (
            <BookingCard key={b.bookingId} booking={b} viewAs="host" />
          ))}
        </div>
      </section>
    </main>
  );
}
