'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export interface Destination {
  label: string;
  lat: number;
  lng: number;
}

interface Suggestion {
  place_name: string;
  center: [number, number];
}

interface SearchBarProps {
  onDestinationSelect: (dest: Destination) => void;
  onFilterOpen: () => void;
  onDatesChange: (start: string, end: string) => void;
  activeFilterCount?: number;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

export default function SearchBar({
  onDestinationSelect,
  onFilterOpen,
  onDatesChange,
  activeFilterCount = 0,
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dateError, setDateError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&types=place,address`,
      );
      if (!res.ok) return;
      const data = await res.json() as { features: Suggestion[] };
      setSuggestions(data.features ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchSuggestions]);

  const handleSelectSuggestion = (s: Suggestion) => {
    setQuery(s.place_name);
    setSuggestions([]);
    onDestinationSelect({ label: s.place_name, lat: s.center[1], lng: s.center[0] });
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

  const validateDates = (start: string, end: string) => {
    if (start && end && new Date(end) < new Date(start)) {
      setDateError('End date cannot be before start date');
    } else {
      setDateError('');
    }
  };

  return (
    <div className="relative flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-md">
      {/* Destination input */}
      <div className="relative">
        <input
          type="text"
          placeholder="Where are you going?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#004526]"
        />
        {suggestions.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg">
            {suggestions.map((s) => (
              <li
                key={s.place_name}
                className="cursor-pointer px-4 py-2 text-sm hover:bg-gray-50"
                onClick={() => handleSelectSuggestion(s)}
              >
                {s.place_name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Date/time inputs */}
      <div className="flex gap-2">
        <input
          type="datetime-local"
          value={startDate}
          onChange={(e) => handleStartChange(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#004526]"
        />
        <input
          type="datetime-local"
          value={endDate}
          onChange={(e) => handleEndChange(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#004526]"
        />
      </div>
      {dateError && (
        <p className="text-xs text-red-600">{dateError}</p>
      )}

      {/* Filter button */}
      <div className="flex justify-end">
        <button
          type="button"
          aria-label="Filter"
          onClick={onFilterOpen}
          className="relative flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          {/* Funnel icon */}
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V17a1 1 0 01-1.447.894l-4-2A1 1 0 017 15v-4.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
          </svg>
          Filter
          {activeFilterCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#006B3C] text-[10px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
