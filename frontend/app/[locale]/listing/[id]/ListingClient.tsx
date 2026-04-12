'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useListing } from '../../../../hooks/useListing';
import { useAuth } from '../../../../hooks/useAuth';
import { useBookingIntent } from '../../../../hooks/useBookingIntent';
import { spotTypeDisplay } from '../../../../lib/spotTypeDisplay';

function calcPrice(pricePerHour: number, startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (end <= start) return 0;
  const hours = (end - start) / (1000 * 60 * 60);
  return Math.ceil(hours) * pricePerHour;
}

export default function ListingPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const id = pathname.split('/').filter(Boolean)[1] ?? '';
  const router = useRouter();
  const { listing, isLoading, error } = useListing(id);
  const { user } = useAuth();
  const isOwnListing = !!(user && listing && user.userId === listing.hostId);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Pre-fill dates from URL params (coming from search page)
  useEffect(() => {
    const sd = searchParams.get('startDate');
    const ed = searchParams.get('endDate');
    if (sd) setStartDate(sd);
    if (ed) setEndDate(ed);
  }, []);

  const total = listing ? calcPrice(listing.pricePerHour, startDate, endDate) : 0;
  const hasValidDates = !!(startDate && endDate && new Date(endDate) > new Date(startDate));

  const { saveIntent, getRedirectUrl } = useBookingIntent();

  const handleBook = () => {
    if (!user) {
      const intent = {
        listingId: id,
        startTime: startDate,
        endTime: endDate,
        listingData: listing ? {
          address: listing.address as string,
          primaryPhotoUrl: (listing.photos as unknown as string[])?.[0] ?? null,
          pricePerHour: listing.pricePerHour as number,
          spotType: listing.spotType as string,
          hostName: listing.host?.name ?? '',
        } : undefined,
      };
      saveIntent(intent);
      router.push(getRedirectUrl(intent));
      return;
    }
    router.push(`/book/${id}?${new URLSearchParams({ startDate, endDate })}`);
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-2/3 rounded bg-gray-200" />
          <div className="h-64 rounded-2xl bg-gray-200" />
        </div>
      </main>
    );
  }

  if (error || !listing) {
    return (
      <main className="mx-auto max-w-5xl p-8 text-center">
        <h1 className="mb-4 text-2xl font-bold text-gray-900">This spot is no longer available</h1>
        <p className="mb-6 text-gray-500">The listing you are looking for has been removed.</p>
        <button type="button" onClick={() => router.push('/search')}
          className="grow-btn rounded-lg bg-[#006B3C] px-6 py-2 font-medium text-white hover:bg-[#004526]">
          Search for other spots
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      {listing.photos && listing.photos.length > 0 && (
        <div className="mb-6 flex gap-3 overflow-x-auto pb-1">
          {listing.photos.map((url, i) => (
            <div
              key={i}
              className="shrink-0 overflow-hidden rounded-2xl bg-[#F0F7F3]"
              style={{ width: '50%', aspectRatio: '1 / 1' }}
            >
              <img
                src={url}
                alt={`${listing.address} photo ${i + 1}`}
                className="h-full w-full object-contain"
              />
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{listing.address}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-600">
                {listing.spotTypeLabel ?? spotTypeDisplay(listing.spotType)}
              </span>
              {listing.covered && (
                <span className="rounded-full bg-[#004526] px-2.5 py-0.5 text-[11px] font-semibold uppercase text-white">Covered</span>
              )}
              {listing.accessible && (
                <span className="rounded-full bg-[#006B3C] px-2.5 py-0.5 text-[11px] font-semibold uppercase text-white">Accessible</span>
              )}
              {listing.evCharging && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-[#059669] px-2.5 py-0.5 text-[11px] font-semibold uppercase text-white">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3"><path d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" /></svg>
                  EV Charging
                </span>
              )}
              {listing.avgRating != null && (
                <span className="flex items-center gap-1 text-sm text-gray-700">
                  <svg viewBox="0 0 20 20" fill="#AD3614" className="h-4 w-4">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  {(listing.avgRating ?? 0).toFixed(1)}
                  {listing.reviewCount !== undefined && <span className="text-gray-500">({listing.reviewCount})</span>}
                </span>
              )}
            </div>
          </div>

          {listing.host && (
            <a href={`/users/${listing.host.userId}`} className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 hover:shadow-sm transition-shadow">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#004526] text-sm font-bold text-white">
                {listing.host.name.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-medium text-[#004526] hover:underline">{listing.host.name}</p>
                {listing.host.avgRating != null && (
                  <p className="text-xs text-gray-500">★ {(listing.host.avgRating ?? 0).toFixed(1)} host rating</p>
                )}
              </div>
            </a>
          )}

          {listing.description && (
            <p className="text-sm leading-relaxed text-gray-700">{listing.description}</p>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-1">
          <p className="mb-4 text-xl font-bold text-[#004526]">€{(listing.pricePerHour ?? 0).toFixed(2)}/hr</p>
          <div className="mb-4 flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Start</label>
              <input type="datetime-local" value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isOwnListing}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">End</label>
              <input type="datetime-local" value={endDate} min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={isOwnListing}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed" />
            </div>
          </div>

          {hasValidDates && total > 0 && (
            <p className="mb-3 text-center text-sm font-semibold text-gray-900">Total: €{total.toFixed(2)}</p>
          )}

          {isOwnListing ? (
            <p
              data-testid="own-listing-label"
              className="py-3 text-center text-sm text-[#4B6354] select-none"
              style={{ cursor: 'default' }}
            >
              This is your listing
            </p>
          ) : user ? (
            <button type="button" disabled={!hasValidDates} onClick={handleBook}
              className="grow-btn w-full rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white hover:bg-[#004526] disabled:opacity-40">
              Book this spot
            </button>
          ) : (
            <button type="button" data-testid="book-this-spot" onClick={handleBook}
              className="grow-btn w-full rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white hover:bg-[#004526]">
              Sign in to book
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
