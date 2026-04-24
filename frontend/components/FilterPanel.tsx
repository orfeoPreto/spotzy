'use client';

import { useState } from 'react';
import { useTranslation } from '../lib/locales/TranslationProvider';

const SPOT_TYPE_KEYS: Array<{ value: string; key: string }> = [
  { value: 'COVERED_GARAGE', key: 'filter.types.COVERED_GARAGE' },
  { value: 'OPEN_LOT', key: 'filter.types.OPEN_SPACE' },
  { value: 'STREET', key: 'filter.types.STREET' },
  { value: 'PRIVATE_DRIVEWAY', key: 'filter.types.DRIVEWAY' },
];

export interface FilterState {
  spotTypes: string[];
  minPrice: number;
  maxPrice: number;
  covered: boolean;
  privatelyOwned: boolean;
  availableOnly: boolean;
}

const DEFAULT_FILTERS: FilterState = {
  spotTypes: [],
  minPrice: 0,
  maxPrice: 50,
  covered: false,
  privatelyOwned: false,
  availableOnly: true,
};

interface FilterPanelProps {
  resultCount: number;
  onApply: (filters: FilterState) => void;
  onClear: () => void;
  onClose?: () => void;
}

export default function FilterPanel({ resultCount, onApply, onClear, onClose }: FilterPanelProps) {
  const { t } = useTranslation('notifications');
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTERS });

  const toggleSpotType = (value: string) => {
    setFilters((prev) => ({
      ...prev,
      spotTypes: prev.spotTypes.includes(value)
        ? prev.spotTypes.filter((t) => t !== value)
        : [...prev.spotTypes, value],
    }));
  };

  const handleClear = () => {
    setFilters({ ...DEFAULT_FILTERS });
    onClear();
  };

  return (
    <div className="flex flex-col rounded-2xl bg-white shadow-lg-spotzy overflow-hidden">
      {/* Header — Forest bg */}
      <div className="flex items-center justify-between bg-[#004526] px-4 py-3">
        <h3 className="text-sm font-semibold text-white font-head">{t('filter.heading') || 'Filters'}</h3>
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleClear} className="text-xs text-white/70 hover:text-white transition-colors">
            {t('filter.clear_all')}
          </button>
          {onClose && (
            <button type="button" onClick={onClose} className="text-white/70 hover:text-white" aria-label="Close">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-5 p-4">
        {/* Spot type chips */}
        <section>
          <h4 className="mb-2 text-[13px] font-semibold text-[#004526]">{t('filter.spot_type')}</h4>
          <div className="flex flex-wrap gap-2">
            {SPOT_TYPE_KEYS.map((type) => {
              const selected = filters.spotTypes.includes(type.value);
              return (
                <button
                  key={type.value}
                  type="button"
                  data-testid="spot-type-chip"
                  onClick={() => toggleSpotType(type.value)}
                  className={`grow-chip rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                    selected
                      ? 'border-[#004526] bg-[#004526] text-white'
                      : 'border-[#C8DDD2] bg-[#B8E6D0] text-[#004526] hover:border-[#006B3C]'
                  }`}
                >
                  {selected && (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mr-1 inline h-3 w-3">
                      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                    </svg>
                  )}
                  {t(type.key)}
                </button>
              );
            })}
          </div>
        </section>

        {/* Price range */}
        <section>
          <h4 className="mb-2 text-[13px] font-semibold text-[#004526]">{t('filter.price')}</h4>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={50}
                value={filters.minPrice}
                onChange={(e) => setFilters((p) => ({ ...p, minPrice: Math.min(Number(e.target.value), p.maxPrice) }))}
                className="w-full accent-[#004526]"
                aria-label={t('filter.min_price')}
              />
              <span className="text-xs text-[#4B6354]">€{filters.minPrice}</span>
            </div>
            <span className="text-[#4B6354]">—</span>
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={50}
                value={filters.maxPrice}
                onChange={(e) => setFilters((p) => ({ ...p, maxPrice: Math.max(Number(e.target.value), p.minPrice) }))}
                className="w-full accent-[#004526]"
                aria-label={t('filter.max_price')}
              />
              <span className="text-xs text-[#4B6354]">€{filters.maxPrice}</span>
            </div>
          </div>
        </section>

        {/* Feature toggles — Forest green switches */}
        <section>
          <h4 className="mb-2 text-[13px] font-semibold text-[#004526]">{t('filter.features')}</h4>
          <div className="flex flex-col gap-3">
            {[
              { key: 'availableOnly', label: t('filter.available_only') },
              { key: 'covered', label: t('filter.covered') },
              { key: 'privatelyOwned', label: t('filter.privately_owned') },
            ].map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center justify-between text-sm text-[#1C2B1A]">
                <span>{label}</span>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={filters[key as keyof FilterState] as boolean}
                    onChange={(e) => setFilters((p) => ({ ...p, [key]: e.target.checked }))}
                    className="peer sr-only"
                    aria-label={label}
                  />
                  <div className="h-5 w-9 rounded-full bg-[#C8DDD2] peer-checked:bg-[#004526] transition-colors" />
                  <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Apply button — Primary Forest full-width with count */}
        <button
          type="button"
          onClick={() => onApply(filters)}
          className="grow-btn w-full rounded-lg bg-[#004526] py-3 text-sm font-semibold text-white font-head shadow-forest hover:bg-[#003318] transition-colors"
        >
          {t('filter.show_spots', { count: String(resultCount) })}
        </button>
      </div>
    </div>
  );
}
