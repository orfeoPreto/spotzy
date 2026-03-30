'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { spotTypeDisplay } from '../lib/spotTypeDisplay';

const MEDIA_URL = process.env.NEXT_PUBLIC_MEDIA_URL ?? '';

export interface SpotListing {
  listingId: string;
  address: string;
  spotType: string;
  pricePerHour: number;
  covered: boolean;
  avgRating?: number;
  photos?: Array<{ validationStatus: string }>;
  hostId?: string;
  hostFirstName?: string;
  hostLastName?: string;
  hostPhotoUrl?: string;
  evCharging?: boolean;
}

interface SpotSummaryCardProps {
  spot: SpotListing;
  walkingDistance?: number;
  currentUserId?: string;
  startDate?: string;
  endDate?: string;
  highlighted?: boolean;
  onHover?: (listingId: string | null) => void;
}

export default function SpotSummaryCard({ spot, walkingDistance, currentUserId, startDate, endDate, highlighted, onHover }: SpotSummaryCardProps) {
  const router = useRouter();
  const navigate = () => {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const qs = params.toString();
    router.push(`/listing/${spot.listingId}${qs ? '?' + qs : ''}`);
  };

  const firstPhoto = spot.photos?.findIndex((p) => p.validationStatus === 'PASS');
  const photoUrl = firstPhoto !== undefined && firstPhoto >= 0
    ? `${MEDIA_URL}/media/listings/${spot.listingId}/photos/${firstPhoto}.jpg`
    : null;

  return (
    <div
      data-testid="spot-summary-card"
      data-listing-id={spot.listingId}
      onClick={navigate}
      onMouseEnter={() => onHover?.(spot.listingId)}
      onMouseLeave={() => onHover?.(null)}
      className={`grow group flex cursor-pointer flex-col rounded-2xl border bg-white shadow-sm overflow-hidden transition-all duration-200 ${
        highlighted ? 'border-[#004526] ring-2 ring-[#004526]/30 scale-[1.02]' : 'border-gray-200'
      }`}
      style={{ aspectRatio: '1 / 2.1' }}
      role="article"
    >
      {/* Photo — 40% of card height */}
      <div className="relative w-full shrink-0" style={{ flex: '0 0 40%' }}>
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={spot.address}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[#F0F7F3]">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-10 w-10 text-[#004526]/30">
              <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 0 1 2.25-2.25h16.5A2.25 2.25 0 0 1 22.5 6v12a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V6ZM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0 0 21 18v-1.94l-2.69-2.689a1.5 1.5 0 0 0-2.12 0l-.88.879.97.97a.75.75 0 1 1-1.06 1.06l-5.16-5.159a1.5 1.5 0 0 0-2.12 0L3 16.061Zm10.125-7.81a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Z" clipRule="evenodd" />
            </svg>
          </div>
        )}
        {spot.covered && (
          <span className="absolute left-2 top-2 rounded-full bg-[#004526] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Covered
          </span>
        )}
      </div>

      {/* Info */}
      <div data-testid="listing-info" className="flex flex-col gap-3 p-3">
        <p className="truncate text-sm font-medium text-gray-900">{spot.address}</p>
        <div className="flex items-center gap-2">
          <span data-testid="spot-type" className="text-xs text-[#4B6354]">{spotTypeDisplay(spot.spotType)}</span>
          {spot.evCharging && (
            <span data-testid="ev-badge" className="inline-flex items-center gap-0.5 rounded-full bg-[#059669] px-1.5 py-0.5 text-[10px] font-semibold text-white">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3"><path d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" /></svg>
              EV
            </span>
          )}
        </div>

        <p className="text-sm font-semibold text-[#004526]">€{spot.pricePerHour.toFixed(2)}/hr</p>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {spot.avgRating !== undefined && (
            <span className="flex items-center gap-0.5">
              <svg viewBox="0 0 20 20" fill="#AD3614" className="h-3.5 w-3.5">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              {spot.avgRating.toFixed(1)}
            </span>
          )}
          {walkingDistance !== undefined && (
            <span>{walkingDistance} min walk</span>
          )}
        </div>

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); navigate(); }}
          className="grow-btn mt-1 w-full rounded-lg bg-[#006B3C] py-2 text-sm font-medium text-white hover:bg-[#004526]"
        >
          Book this spot
        </button>
      </div>

      {/* Host footer — hidden on own listings */}
      {spot.hostId && currentUserId !== spot.hostId && (
        <div data-testid="host-footer" className="border-t border-[#EBF7F1] px-3 py-2 flex items-center gap-2">
          <Link
            href={`/users/${spot.hostId}`}
            data-testid="host-footer-link"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            {spot.hostPhotoUrl ? (
              <img
                src={spot.hostPhotoUrl}
                alt={`${spot.hostFirstName} ${spot.hostLastName}`}
                className="w-7 h-7 rounded-full border-[1.5px] border-[#004526] object-cover"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-[#004526] flex items-center justify-center">
                <span className="text-white text-[10px] font-medium">
                  {spot.hostFirstName?.[0]}{spot.hostLastName?.[0]}
                </span>
              </div>
            )}
            <span className="text-[13px] text-[#4B6354]">
              by {spot.hostFirstName} {spot.hostLastName}
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
