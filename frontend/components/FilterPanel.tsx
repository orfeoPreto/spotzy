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
}

export default function FilterPanel({ resultCount, onApply, onClear }: FilterPanelProps) {
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
    <div className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-md">
      {/* Availability section */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('filter.availability')}</h3>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filters.availableOnly}
            onChange={(e) => setFilters((p) => ({ ...p, availableOnly: e.target.checked }))}
            aria-label={t('filter.available_only')}
          />
          {t('filter.available_only')}
        </label>
      </section>

      {/* Price section */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('filter.price')}</h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={filters.maxPrice}
            value={filters.minPrice}
            onChange={(e) => setFilters((p) => ({ ...p, minPrice: Number(e.target.value) }))}
            className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
            aria-label={t('filter.min_price')}
          />
          <span className="text-gray-500">—</span>
          <input
            type="number"
            min={filters.minPrice}
            value={filters.maxPrice}
            onChange={(e) => setFilters((p) => ({ ...p, maxPrice: Number(e.target.value) }))}
            className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
            aria-label={t('filter.max_price')}
          />
        </div>
      </section>

      {/* Spot type section */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('filter.spot_type')}</h3>
        <div className="flex flex-wrap gap-2">
          {SPOT_TYPE_KEYS.map((type) => {
            const selected = filters.spotTypes.includes(type.value);
            return (
              <button
                key={type.value}
                type="button"
                data-testid="spot-type-chip"
                onClick={() => toggleSpotType(type.value)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  selected
                    ? 'border-amber bg-amber-50 font-medium text-amber-700'
                    : 'border-gray-300 text-gray-600 hover:border-gray-400'
                }`}
              >
                {t(type.key)}
              </button>
            );
          })}
        </div>
      </section>

      {/* Features section */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('filter.features')}</h3>
        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={filters.covered}
              onChange={(e) => setFilters((p) => ({ ...p, covered: e.target.checked }))}
              aria-label={t('filter.covered')}
            />
            {t('filter.covered')}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={filters.privatelyOwned}
              onChange={(e) => setFilters((p) => ({ ...p, privatelyOwned: e.target.checked }))}
              aria-label={t('filter.privately_owned')}
            />
            {t('filter.privately_owned')}
          </label>
        </div>
      </section>

      {/* Action buttons */}
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={handleClear}
          className="flex-1 rounded-lg border border-gray-300 py-2 text-sm hover:bg-gray-50"
        >
          {t('filter.clear_all')}
        </button>
        <button
          type="button"
          onClick={() => onApply(filters)}
          className="flex-1 rounded-lg bg-[#006B3C] py-2 text-sm font-medium text-white hover:bg-[#004526]"
        >
          {t('filter.show_spots', { count: String(resultCount) })}
        </button>
      </div>
    </div>
  );
}
