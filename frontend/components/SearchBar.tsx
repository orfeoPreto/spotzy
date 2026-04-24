'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from '../lib/locales/TranslationProvider';

export interface Destination {
  label: string;
  lat: number;
  lng: number;
}

interface SBSuggestion {
  mapbox_id: string;
  name: string;
  full_address?: string;
  place_formatted?: string;
  feature_type: string;
}

interface SearchBarProps {
  onDestinationSelect: (dest: Destination) => void;
  onFilterOpen: () => void;
  onDatesChange: (start: string, end: string) => void;
  activeFilterCount?: number;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

function generateSessionToken() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export default function SearchBar({
  onDestinationSelect,
  onFilterOpen,
  onDatesChange,
  activeFilterCount = 0,
}: SearchBarProps) {
  const { t } = useTranslation('search');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SBSuggestion[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dateError, setDateError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextFetchRef = useRef(false);
  const sessionTokenRef = useRef(generateSessionToken());

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const params = new URLSearchParams({
        q,
        access_token: MAPBOX_TOKEN,
        session_token: sessionTokenRef.current,
        proximity: '4.3525,50.8467',
        language: 'fr',
        limit: '5',
        types: 'poi,address,place,street',
      });
      const res = await fetch(
        `https://api.mapbox.com/search/searchbox/v1/suggest?${params}`,
      );
      if (!res.ok) return;
      const data = await res.json() as { suggestions: SBSuggestion[] };
      setSuggestions(data.suggestions ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (skipNextFetchRef.current) { skipNextFetchRef.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchSuggestions]);

  const handleSelectSuggestion = async (s: SBSuggestion) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    skipNextFetchRef.current = true;
    const label = s.full_address || s.place_formatted || s.name;
    setQuery(label);
    setSuggestions([]);

    // Retrieve coordinates via the retrieve endpoint
    try {
      const params = new URLSearchParams({
        access_token: MAPBOX_TOKEN,
        session_token: sessionTokenRef.current,
      });
      const res = await fetch(
        `https://api.mapbox.com/search/searchbox/v1/retrieve/${s.mapbox_id}?${params}`,
      );
      if (res.ok) {
        const data = await res.json() as { features: Array<{ geometry: { coordinates: [number, number] } }> };
        const coords = data.features?.[0]?.geometry?.coordinates;
        if (coords) {
          onDestinationSelect({ label, lat: coords[1], lng: coords[0] });
        }
      }
    } catch {
      // ignore
    }

    // Generate new session token for next search
    sessionTokenRef.current = generateSessionToken();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const handleStartChange = (val: string) => {
    setStartDate(val);
    validateDates(val, endDate);
    onDatesChange(val, endDate);
  };

  const handleEndChange = (val: string) => {
    setEndDate(val);
    validateDates(startDate, val);
    onDatesChange(startDate, val);
  };

  const nowMin = (() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  })();

  const validateDates = (start: string, end: string) => {
    if (start && end && new Date(end) < new Date(start)) {
      setDateError(t('search_bar.date_error'));
    } else {
      setDateError('');
    }
  };

  return (
    <div className="relative flex flex-col gap-2 rounded-full bg-white px-5 py-3 shadow-md-spotzy border border-[#004526]/20">
      {/* Destination input — pill style with Forest search icon */}
      <div className="relative flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#004526" className="h-5 w-5 flex-shrink-0">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          type="text"
          placeholder={t('search_bar.destination_placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => setSuggestions([]), 200)}
          className="w-full bg-transparent text-sm text-[#1C2B1A] placeholder:text-[#4B6354]/60 outline-none"
        />
        {suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-10 mt-2 rounded-xl border border-[#C8DDD2] bg-white shadow-lg-spotzy overflow-hidden">
            {suggestions.map((s) => (
              <li
                key={s.mapbox_id}
                className="cursor-pointer px-4 py-2.5 text-sm text-[#1C2B1A] hover:bg-[#EBF7F1] border-l-2 border-transparent hover:border-l-[#006B3C] transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  void handleSelectSuggestion(s);
                }}
              >
                <span className="font-medium">{s.name}</span>
                {s.place_formatted && (
                  <span className="ml-1 text-[#4B6354] text-xs">{s.place_formatted}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Date/time pills + Filter button */}
      <div className="flex items-center gap-2">
        <input
          type="datetime-local"
          value={startDate}
          min={nowMin}
          onChange={(e) => handleStartChange(e.target.value)}
          className={`flex-1 rounded-full border px-3 py-1.5 text-xs outline-none transition-all ${
            startDate
              ? 'border-[#004526] bg-[#B8E6D0] text-[#004526] font-medium'
              : 'border-[#C8DDD2] text-[#4B6354] hover:border-[#006B3C]'
          } focus:border-[#006B3C] focus:ring-2 focus:ring-[#006B3C]/20`}
        />
        <input
          type="datetime-local"
          value={endDate}
          min={startDate || nowMin}
          onChange={(e) => handleEndChange(e.target.value)}
          className={`flex-1 rounded-full border px-3 py-1.5 text-xs outline-none transition-all ${
            endDate
              ? 'border-[#004526] bg-[#B8E6D0] text-[#004526] font-medium'
              : 'border-[#C8DDD2] text-[#4B6354] hover:border-[#006B3C]'
          } focus:border-[#006B3C] focus:ring-2 focus:ring-[#006B3C]/20`}
        />
        <button
          type="button"
          aria-label="Filter"
          onClick={onFilterOpen}
          className={`relative flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
            activeFilterCount > 0
              ? 'border-[#004526] bg-[#004526] text-white'
              : 'border-[#C8DDD2] text-[#4B6354] hover:border-[#006B3C] hover:text-[#004526]'
          }`}
        >
          {/* SlidersHorizontal icon */}
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
          </svg>
          {t('search_bar.filter_button')}
          {activeFilterCount > 0 && (
            <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-bold text-[#004526]">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>
      {dateError && (
        <p className="text-xs text-[#DC2626] pl-7">{dateError}</p>
      )}
    </div>
  );
}
