'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '../../../lib/locales/TranslationProvider';
import SearchBar, { type Destination } from '../../../components/SearchBar';
import SpotMap, { type SpotListing } from '../../../components/SpotMap';
import SpotSummaryCard from '../../../components/SpotSummaryCard';
import FilterPanel, { type FilterState } from '../../../components/FilterPanel';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

// Brussels default coordinates
const BRUSSELS_CENTER = { lat: 50.8467, lng: 4.3525 };

// Haversine distance in km → walking minutes (~5 km/h)
function walkingMinutes(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round((km / 5) * 60);
}

interface BBox {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export default function SearchPage() {
  const { t } = useTranslation('search');
  const [spots, setSpots] = useState<SpotListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSpotId, setSelectedSpotId] = useState<string | undefined>();
  const [hoveredSpotId, setHoveredSpotId] = useState<string | null>(null);
  const [cardHoveredId, setCardHoveredId] = useState<string | null>(null);
  const listingsPanelRef = useRef<HTMLElement>(null);

  // Scroll highlighted card into view within listings panel only
  useEffect(() => {
    if (!hoveredSpotId || !listingsPanelRef.current) return;
    const panel = listingsPanelRef.current;
    const card = panel.querySelector(`[data-listing-id="${hoveredSpotId}"]`) as HTMLElement | null;
    if (!card) return;
    const panelRect = panel.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const cardTop = cardRect.top - panelRect.top + panel.scrollTop;
    const cardBottom = cardTop + cardRect.height;
    const visibleTop = panel.scrollTop;
    const visibleBottom = visibleTop + panelRect.height;
    if (cardTop < visibleTop || cardBottom > visibleBottom) {
      panel.scrollTo({ top: cardTop - (panelRect.height - cardRect.height) / 2, behavior: 'smooth' });
    }
  }, [hoveredSpotId]);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    spotTypes: [],
    minPrice: 0,
    maxPrice: 50,
    covered: false,
    privatelyOwned: false,
  });
  const [destination, setDestination] = useState<Destination | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [mapMoved, setMapMoved] = useState(false);
  const bboxRef = useRef<BBox | null>(null);

  const buildParams = useCallback(
    (dest: Destination | null, activeFilters: FilterState, bbox?: BBox | null): URLSearchParams => {
      const params = new URLSearchParams();
      if (bbox) {
        params.set('swLat', String(bbox.swLat));
        params.set('swLng', String(bbox.swLng));
        params.set('neLat', String(bbox.neLat));
        params.set('neLng', String(bbox.neLng));
      } else if (dest) {
        params.set('lat', String(dest.lat));
        params.set('lng', String(dest.lng));
      } else {
        params.set('lat', String(BRUSSELS_CENTER.lat));
        params.set('lng', String(BRUSSELS_CENTER.lng));
      }
      if (activeFilters.covered) params.set('covered', 'true');
      if (activeFilters.spotTypes.length > 0) params.set('spotTypes', activeFilters.spotTypes.join(','));
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      return params;
    },
    [startDate, endDate],
  );

  const fetchListings = useCallback(async (params: URLSearchParams) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/listings/search?${params}`);
      if (!res.ok) return;
      const data = await res.json() as { listings: SpotListing[] };
      setSpots(data.listings ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load listings on mount with Brussels default
  useEffect(() => {
    fetchListings(buildParams(null, filters));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDestinationSelect = useCallback((dest: Destination) => {
    setDestination(dest);
    setMapMoved(false);
    fetchListings(buildParams(dest, filters));
  }, [filters, buildParams, fetchListings]);

  const handleApplyFilters = (newFilters: FilterState) => {
    setFilters(newFilters);
    setShowFilters(false);
    fetchListings(buildParams(destination, newFilters));
  };

  const handleClearFilters = () => {
    const cleared: FilterState = { spotTypes: [], minPrice: 0, maxPrice: 50, covered: false, privatelyOwned: false };
    setFilters(cleared);
  };

  const handleMapMoveEnd = useCallback((bbox: BBox) => {
    bboxRef.current = bbox;
    setMapMoved(true);
  }, []);

  const handleSearchThisArea = useCallback(() => {
    if (!bboxRef.current) return;
    setMapMoved(false);
    fetchListings(buildParams(null, filters, bboxRef.current));
  }, [filters, buildParams, fetchListings]);

  const activeFilterCount = filters.spotTypes.length +
    (filters.covered ? 1 : 0) +
    (filters.privatelyOwned ? 1 : 0);

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <h1 className="sr-only">{t('heading')}</h1>

      {/* Search bar — centered, 50% max width on desktop */}
      <div className="z-10 flex justify-center p-3 shadow-sm">
        <div className="w-full md:max-w-[50%]">
        <SearchBar
          onDestinationSelect={handleDestinationSelect}
          onFilterOpen={() => setShowFilters(true)}
          onDatesChange={(s, e) => { setStartDate(s); setEndDate(e); }}
          activeFilterCount={activeFilterCount}
        />
        </div>
      </div>

      {/* Content: mobile = map top + listings below; md = side by side 4:6 */}
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">

        {/* Map — full width on mobile, 40% on desktop */}
        <div className="relative h-56 shrink-0 md:h-auto md:w-[40%]">
          <SpotMap
            spots={spots}
            defaultCenter={BRUSSELS_CENTER}
            onSpotSelect={(s) => setSelectedSpotId(s.listingId)}
            onSpotHover={setHoveredSpotId}
            selectedSpotId={selectedSpotId}
            highlightedFromCard={cardHoveredId}
            destinationCoords={destination}
            onMoveEnd={handleMapMoveEnd}
          />
          {mapMoved && (
            <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2">
              <button
                type="button"
                onClick={handleSearchThisArea}
                className="rounded-full bg-white px-4 py-2 text-sm font-medium text-[#004526] shadow-md hover:shadow-lg"
              >
                {t('search_this_area')}
              </button>
            </div>
          )}
        </div>

        {/* Listings panel — full width on mobile, 60% on desktop */}
        <aside
          ref={listingsPanelRef}
          data-testid="listings-panel"
          className="flex-1 overflow-y-auto p-3"
        >
          {loading && (
            <p className="text-center text-sm text-gray-500" role="status">{t('loading')}</p>
          )}
          {/* 1 col mobile → 2 col sm → 3 col lg */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {spots.map((spot) => (
              <SpotSummaryCard
                key={spot.listingId}
                spot={spot}
                walkingDistance={destination ? walkingMinutes(destination.lat, destination.lng, spot.addressLat, spot.addressLng) : undefined}
                startDate={startDate}
                endDate={endDate}
                highlighted={hoveredSpotId === spot.listingId}
                onHover={setCardHoveredId}
              />
            ))}
          </div>
          {!loading && spots.length === 0 && (
            <p className="mt-8 text-center text-sm text-gray-400">
              {t('no_results')}
            </p>
          )}
        </aside>
      </div>

      {/* Filter panel overlay */}
      {showFilters && (
        <div
          className="fixed inset-0 z-20 flex items-start justify-end bg-black/30 p-4"
          onClick={() => setShowFilters(false)}
        >
          <div
            className="w-80 rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <FilterPanel
              resultCount={spots.length}
              onApply={handleApplyFilters}
              onClear={handleClearFilters}
            />
          </div>
        </div>
      )}
    </main>
  );
}
