'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import BookingCard, { type Booking } from '../../../../components/BookingCard';
import StatusBadge from '../../../../components/StatusBadge';
import { useAuth } from '../../../../hooks/useAuth';
import { useTranslation } from '../../../../lib/locales/TranslationProvider';

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

/** Derive the correct display status for bookings that may be stale (Issue #1/#2).
 *  The booking-status-transition Lambda should set ACTIVE/COMPLETED, but bookings
 *  created before the scheduler was deployed may still be CONFIRMED. We compute
 *  the expected status client-side so the badge is always accurate. */
function deriveBookingStatus(booking: Booking): string {
  const now = Date.now();
  const start = booking.startDate ?? booking.startTime;
  const end = booking.endDate ?? booking.endTime;
  if (booking.status === 'CONFIRMED' && start && end) {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (now >= endMs) return 'COMPLETED';
    if (now >= startMs) return 'ACTIVE';
  }
  return booking.status;
}

export default function HostDashboardPage() {
  const { t } = useTranslation('dashboard');
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
      .then(async (d) => {
        const all = (d as { bookings: Booking[] }).bookings;
        // Only show bookings where others booked the user's listings (exclude own spotter bookings)
        const hostBookings = all.filter((b) => b.spotterId !== user?.userId);

        // Issue #1/#2: Derive correct status for stale CONFIRMED bookings
        const enrichedBookings = hostBookings.map((b) => ({
          ...b,
          status: deriveBookingStatus(b),
        }));

        // Issue #3: Enrich with spotterName if missing by fetching public profiles
        const needNames = enrichedBookings.filter((b) => !b.spotterName && b.spotterId);
        const uniqueSpotterIds = [...new Set(needNames.map((b) => b.spotterId!))];

        if (uniqueSpotterIds.length > 0) {
          const profileMap = new Map<string, string>();
          await Promise.allSettled(
            uniqueSpotterIds.map((id) =>
              fetch(`${API_URL}/api/v1/users/${id}/public`, { headers })
                .then((r) => r.json())
                .then((p: any) => {
                  const name = p.displayName ?? p.name ?? p.firstName ?? '';
                  if (name) profileMap.set(id, name);
                }),
            ),
          );
          for (const b of enrichedBookings) {
            if (!b.spotterName && b.spotterId && profileMap.has(b.spotterId)) {
              b.spotterName = profileMap.get(b.spotterId);
            }
          }
        }

        setBookings(enrichedBookings);
      });
  }, [user?.userId]);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">{t('host.title')}</h1>

      {/* Metrics row */}
      {loadingMetrics ? (
        <div data-testid="metrics-skeleton" className="mb-6 grid grid-cols-4 gap-4">
          {[0,1,2,3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      ) : metrics && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard label={t('host.active_bookings')} value={metrics.activeBookings} />
          <MetricCard label={t('host.mtd_earnings')} value={`€${(metrics.mtdEarnings ?? 0).toFixed(2)}`} />
          <MetricCard label={t('host.live_listings')} value={metrics.liveListings} />
          <MetricCard label={t('host.avg_rating')} value={(metrics.avgRating ?? 0).toFixed(1)} />
        </div>
      )}

      {/* Listings section */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{t('host.my_listings')}</h2>
          <button type="button" onClick={() => router.push('/listings/new')}
            className="grow-btn rounded-lg bg-[#006B3C] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#004526]">
            {t('host.add_listing')}
          </button>
        </div>

        {listings !== null && listings.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-gray-300 p-8 text-center">
            <p className="mb-3 text-gray-500">{t('host.no_listings')}</p>
            <button type="button" onClick={() => router.push('/listings/new')}
              className="grow-btn rounded-lg bg-[#006B3C] px-5 py-2 text-sm font-medium text-white hover:bg-[#004526]">
              {t('host.add_first_spot')}
            </button>
          </div>
        )}

        {listings && listings.length > 0 && (
          <div className="space-y-3">
            {listings.map((l) => (
              <div key={l.listingId} className="grow flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
                <div>
                  {/* Issue #24: Link listing address to public listing page */}
                  <Link href={`/listing/${l.listingId}`} className="font-medium text-[#004526] hover:underline">
                    {l.address}
                  </Link>
                  <p className="text-xs text-gray-500">{t('host.bookings_count', { count: String(l.bookingCount) })}</p>
                </div>
                <div className="flex items-center gap-3">
                  {/* Issue #23: Add edit listing button */}
                  <Link
                    href={`/listing/${l.listingId}/edit`}
                    className="text-xs text-[#004526] hover:underline"
                  >
                    {t('host.edit_listing')}
                  </Link>
                  <Link
                    href={`/listing/${l.listingId}/availability`}
                    className="text-xs text-[#004526] hover:underline"
                  >
                    {t('host.edit_availability')}
                  </Link>
                  <StatusBadge status={l.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Upcoming bookings */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">{t('host.upcoming_bookings')}</h2>
        {bookings.length === 0 && (
          <p className="text-sm text-gray-400">{t('host.no_upcoming')}</p>
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
