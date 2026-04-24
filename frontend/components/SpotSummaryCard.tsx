'use client';

import { useState } from 'react';
import Link from 'next/link';
import { spotTypeDisplay } from '../lib/spotTypeDisplay';
import { UserAvatar } from './UserAvatar';
import { useTranslation } from '../lib/locales/TranslationProvider';
import { useLocalizedRouter, useLocalizePath } from '../lib/locales/useLocalizedRouter';

const MEDIA_URL = process.env.NEXT_PUBLIC_MEDIA_URL ?? '';

export interface SpotListing {
  listingId: string;
  address: string;
  spotType: string;
  pricePerHour: number;
  hostNetPricePerHourEur?: number;
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
  const { t } = useTranslation('search');
  const [cardHovered, setCardHovered] = useState(false);
  const router = useLocalizedRouter();
  const lp = useLocalizePath();
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

  // Spotter-facing gross hourly rate
  const net = spot.hostNetPricePerHourEur ?? spot.pricePerHour ?? 0;
  const feePct = 0.15;
  const vatRate = 0.21;
  const fee = Math.round(net * (feePct / (1 - feePct)) * 100) / 100;
  const feeVat = Math.round(fee * vatRate * 100) / 100;
  const gross = Math.round((net + fee + feeVat) * 100) / 100;

  const isActive = highlighted || cardHovered;

  return (
    <div
      data-testid="spot-summary-card"
      data-listing-id={spot.listingId}
      onClick={navigate}
      onMouseEnter={() => { setCardHovered(true); onHover?.(spot.listingId); }}
      onMouseLeave={() => { setCardHovered(false); onHover?.(null); }}
      className={`group flex cursor-pointer flex-col rounded-xl border bg-white overflow-hidden transition-all duration-300 ${
        isActive
          ? 'border-[#006B3C] shadow-forest scale-[1.02]'
          : 'border-[#C8DDD2] shadow-sm-spotzy hover:shadow-md-spotzy'
      }`}
      style={{ aspectRatio: '2 / 3.5' }}
      role="article"
    >
      {/* Photo — 40% of card, Forest border, radius-md */}
      <div className="relative w-full shrink-0" style={{ flex: '0 0 40%' }}>
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={spot.address}
            className="absolute inset-0 h-full w-full object-cover border-b border-[#004526]/10"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#004526] to-[#006B3C]">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="white" className="h-10 w-10 opacity-40">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />
            </svg>
          </div>
        )}
        {spot.covered && (
          <span className="absolute left-2 top-2 rounded-full bg-[#004526] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            {t('spot_card.covered_badge')}
          </span>
        )}
      </div>

      {/* Info */}
      <div data-testid="listing-info" className="flex flex-1 flex-col gap-2 p-3">
        {/* Address — Inter 500 14px Ink, 1 line truncated */}
        <p className="truncate text-sm font-medium text-[#1C2B1A]">{spot.address}</p>

        {/* Type + EV badge row */}
        <div className="flex items-center gap-2">
          <span data-testid="spot-type" className="text-[13px] text-[#4B6354]">{spotTypeDisplay(spot.spotType)}</span>
          {spot.evCharging && (
            <span data-testid="ev-badge" className="inline-flex items-center gap-0.5 rounded-full bg-[#059669]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#004526]">
              <svg viewBox="0 0 24 24" fill="#059669" className="h-3 w-3"><path d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" /></svg>
              {t('spot_card.ev_badge')}
            </span>
          )}
        </div>

        {/* Stars + walking distance */}
        <div className="flex items-center gap-3 text-xs text-[#4B6354]">
          {spot.avgRating != null && spot.avgRating > 0 && (
            <span className="flex items-center gap-0.5">
              <svg viewBox="0 0 20 20" fill="#059669" className="h-3.5 w-3.5">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <span className="font-semibold text-[#004526]">{(spot.avgRating).toFixed(1)}</span>
            </span>
          )}
          {walkingDistance !== undefined && (
            <span className="flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#4B6354" className="h-3.5 w-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
              </svg>
              {walkingDistance} {t('spot_card.walking_distance')}
            </span>
          )}
        </div>

        {/* Price — "from €X.XX/hr" in Forest DM Sans 700 */}
        <div className="mt-auto">
          <p className="text-sm font-bold text-[#004526] font-head">{t('spot_card.from_price', { price: gross.toFixed(2) })}</p>
          <p className="text-[10px] text-[#4B6354]">{t('spot_card.incl_fees')}</p>
        </div>
      </div>

      {/* Host footer — 28px avatar + "by Jean D." */}
      {spot.hostId && currentUserId !== spot.hostId && (
        <div data-testid="host-footer" className="border-t border-[#EBF7F1] px-3 py-2 flex items-center gap-2">
          <Link
            href={lp(`/users/${spot.hostId}`)}
            data-testid="host-footer-link"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <UserAvatar user={{ photoUrl: spot.hostPhotoUrl, pseudo: null, firstName: spot.hostFirstName || '' }} size={28} />
            <span className="text-[13px] text-[#4B6354]">
              by {spot.hostFirstName} {spot.hostLastName}
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
