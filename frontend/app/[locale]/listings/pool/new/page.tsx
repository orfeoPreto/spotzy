'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { spotManagerApi } from '../../../../../lib/apiUrls';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

const SPOT_TYPES = [
  { value: 'COVERED_GARAGE', label: 'Covered garage', icon: '🏠' },
  { value: 'OPEN_SPACE', label: 'Open lot', icon: '🅿' },
  { value: 'CARPORT', label: 'Carport', icon: '🛣' },
  { value: 'DRIVEWAY', label: 'Private driveway', icon: '🚗' },
];

const DISCOUNT_OPTIONS = [0.50, 0.60, 0.70] as const;
type DiscountPct = typeof DISCOUNT_OPTIONS[number];

interface GeoSuggestion { place_name: string; center: [number, number] }

interface BayDraft {
  label: string;
  accessInstructions: string;
}

interface WizardState {
  step: number;
  // Location
  address: string;
  lat: number | null;
  lng: number | null;
  // Details
  spotType: string;
  description: string;
  evCharging: boolean;
  // Pricing (Session 28 tiered)
  pricePerHourEur: number | '';
  dailyDiscountPct: DiscountPct;
  weeklyDiscountPct: DiscountPct;
  monthlyDiscountPct: DiscountPct;
  // Capacity
  bayCount: number;
  bays: BayDraft[];
}

async function getAuthToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch {
    return '';
  }
}

function deriveTierRates(pricePerHourEur: number, daily: number, weekly: number, monthly: number) {
  const hourly = pricePerHourEur;
  const dailyRate = Math.round(hourly * 24 * daily * 100) / 100;
  const weeklyRate = Math.round(dailyRate * 7 * weekly * 100) / 100;
  const monthlyRate = Math.round(weeklyRate * 4 * monthly * 100) / 100;
  return { hourly, dailyRate, weeklyRate, monthlyRate };
}

export default function PoolListingNewPage() {
  const router = useRouter();
  const [state, setState] = useState<WizardState>({
    step: 1,
    address: '', lat: null, lng: null,
    spotType: '', description: '', evCharging: false,
    pricePerHourEur: '',
    dailyDiscountPct: 0.60,
    weeklyDiscountPct: 0.60,
    monthlyDiscountPct: 0.60,
    bayCount: 5,
    bays: Array.from({ length: 5 }, (_, i) => ({ label: `Bay ${i + 1}`, accessInstructions: '' })),
  });
  const [addressQuery, setAddressQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedBay, setExpandedBay] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextFetchRef = useRef(false);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  // Map rendering
  useEffect(() => {
    if (!state.lat || !state.lng || !mapContainerRef.current || !MAPBOX_TOKEN) return;
    if (!mapInstanceRef.current) {
      mapboxgl.accessToken = MAPBOX_TOKEN;
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [state.lng, state.lat],
        zoom: 15,
        interactive: false,
      });
      mapInstanceRef.current = map;
      markerRef.current = new mapboxgl.Marker({ color: '#006B3C' })
        .setLngLat([state.lng, state.lat])
        .addTo(map);
    } else {
      mapInstanceRef.current.setCenter([state.lng, state.lat]);
      markerRef.current?.setLngLat([state.lng, state.lat]);
    }
  }, [state.lat, state.lng]);

  // Address autocomplete
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (skipNextFetchRef.current) { skipNextFetchRef.current = false; return; }
    if (addressQuery.length < 3) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addressQuery)}.json?access_token=${MAPBOX_TOKEN}&types=address`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setSuggestions(data.features ?? []);
    }, 300);
  }, [addressQuery]);

  // Sync bay count → bays array
  const updateBayCount = useCallback((newCount: number) => {
    const clamped = Math.max(2, Math.min(200, newCount));
    setState(prev => {
      const newBays = Array.from({ length: clamped }, (_, i) =>
        prev.bays[i] ?? { label: `Bay ${i + 1}`, accessInstructions: '' }
      );
      return { ...prev, bayCount: clamped, bays: newBays };
    });
  }, []);

  const updateBay = (index: number, patch: Partial<BayDraft>) => {
    setState(prev => {
      const bays = [...prev.bays];
      bays[index] = { ...bays[index], ...patch };
      return { ...prev, bays };
    });
  };

  const selectAddress = (s: GeoSuggestion) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    skipNextFetchRef.current = true;
    setState(prev => ({ ...prev, address: s.place_name, lat: s.center[1], lng: s.center[0] }));
    setAddressQuery(s.place_name);
    setSuggestions([]);
  };

  const isStepValid = () => {
    if (state.step === 1) return !!state.address && state.lat !== null;
    if (state.step === 2) return !!state.spotType && state.pricePerHourEur !== '' && Number(state.pricePerHourEur) > 0;
    if (state.step === 3) return state.bayCount >= 2 && state.bayCount <= 200;
    if (state.step === 4) {
      // Bay labels unique
      const labels = state.bays.map(b => b.label.trim()).filter(Boolean);
      return labels.length === state.bayCount && new Set(labels).size === labels.length;
    }
    return false;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const body = {
        address: state.address,
        addressLat: state.lat,
        addressLng: state.lng,
        spotType: state.spotType,
        description: state.description || undefined,
        evCharging: state.evCharging,
        pricePerHourEur: Number(state.pricePerHourEur),
        dailyDiscountPct: state.dailyDiscountPct,
        weeklyDiscountPct: state.weeklyDiscountPct,
        monthlyDiscountPct: state.monthlyDiscountPct,
        bayCount: state.bayCount,
        bayLabels: state.bays.map(b => b.label.trim()),
        bayAccessInstructions: state.bays.map(b => b.accessInstructions.trim() || null),
        isPool: true,
      };
      const res = await fetch(spotManagerApi('/api/v1/listings/pool'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || data.message || 'Failed to create pool');
        return;
      }
      const { listingId } = await res.json();
      router.push(`/spot-manager/portfolio`);
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const pricing = state.pricePerHourEur !== '' && Number(state.pricePerHourEur) > 0
    ? deriveTierRates(Number(state.pricePerHourEur), state.dailyDiscountPct, state.weeklyDiscountPct, state.monthlyDiscountPct)
    : null;

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => router.push('/spot-manager/portfolio')} className="text-[#004526] text-sm mb-4 hover:underline">
          ← Back to portfolio
        </button>
        <h1 className="text-2xl font-bold text-[#004526] mb-2">Create a Spot Pool</h1>
        <p className="text-gray-600 mb-6">A pool lists multiple parking bays as one listing. Each bay has its own label and optional access instructions.</p>

        {/* Progress */}
        <div className="flex gap-2 mb-6">
          {['Location', 'Details', 'Capacity', 'Bays'].map((label, i) => (
            <div key={label} className="flex-1">
              <div className={`h-2 rounded-full ${state.step > i ? 'bg-[#004526]' : state.step === i + 1 ? 'bg-[#006B3C]' : 'bg-gray-200'}`} />
              <p className="text-xs text-gray-500 mt-1">{label}</p>
            </div>
          ))}
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

        {/* Step 1: Location */}
        {state.step === 1 && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#004526]">Location</h2>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input
                type="text"
                value={addressQuery || state.address}
                onChange={e => setAddressQuery(e.target.value)}
                placeholder="Start typing your address..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#006B3C]"
              />
              {suggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {suggestions.map((s, i) => (
                    <button key={i} onClick={() => selectAddress(s)} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm">
                      {s.place_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {state.lat && state.lng && (
              <div ref={mapContainerRef} className="w-full h-48 rounded-lg overflow-hidden" />
            )}
          </div>
        )}

        {/* Step 2: Details + Pricing */}
        {state.step === 2 && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#004526]">Pool details & pricing</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Spot type (shared across all bays)</label>
              <div className="grid grid-cols-2 gap-2">
                {SPOT_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setState(p => ({ ...p, spotType: t.value }))}
                    className={`p-3 border rounded-lg text-left transition ${state.spotType === t.value ? 'border-[#004526] bg-[#f0faf4]' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <span className="text-xl">{t.icon}</span>
                    <p className="text-sm font-medium mt-1">{t.label}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea
                value={state.description}
                onChange={e => setState(p => ({ ...p, description: e.target.value }))}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              />
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.evCharging}
                onChange={e => setState(p => ({ ...p, evCharging: e.target.checked }))}
                className="accent-[#004526]"
              />
              <span className="text-sm">EV charging available</span>
            </label>

            <hr />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price per hour (€)</label>
              <input
                type="number"
                step="0.10"
                min="0.01"
                max="999.99"
                value={state.pricePerHourEur}
                onChange={e => setState(p => ({ ...p, pricePerHourEur: e.target.value === '' ? '' : Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#006B3C]"
                placeholder="2.50"
              />
            </div>

            {(['dailyDiscountPct', 'weeklyDiscountPct', 'monthlyDiscountPct'] as const).map(key => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {key === 'dailyDiscountPct' ? 'Daily discount' : key === 'weeklyDiscountPct' ? 'Weekly discount' : 'Monthly discount'}
                </label>
                <div className="flex gap-2">
                  {DISCOUNT_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      onClick={() => setState(p => ({ ...p, [key]: opt }))}
                      className={`flex-1 py-2 border rounded-lg text-sm font-medium transition ${state[key] === opt ? 'border-[#004526] bg-[#f0faf4] text-[#004526]' : 'border-gray-200 text-gray-600'}`}
                    >
                      {Math.round(opt * 100)}%
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {pricing && (
              <div className="p-4 bg-gradient-to-r from-[#f0faf4] to-white rounded-lg border border-[#e6f7ef]">
                <p className="text-xs text-gray-500 mb-2">Tier preview (per bay)</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-gray-500">Hourly:</span> <span className="font-semibold">€{pricing.hourly.toFixed(2)}/h</span></div>
                  <div><span className="text-gray-500">Daily:</span> <span className="font-semibold">€{pricing.dailyRate.toFixed(2)}/day</span></div>
                  <div><span className="text-gray-500">Weekly:</span> <span className="font-semibold">€{pricing.weeklyRate.toFixed(2)}/wk</span></div>
                  <div><span className="text-gray-500">Monthly:</span> <span className="font-semibold">€{pricing.monthlyRate.toFixed(2)}/mo</span></div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Capacity */}
        {state.step === 3 && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold text-[#004526]">Number of bays</h2>
            <p className="text-sm text-gray-600">You can label and customise each bay in the next step.</p>

            <div className="flex items-center gap-4">
              <button
                onClick={() => updateBayCount(state.bayCount - 1)}
                className="w-12 h-12 rounded-lg border border-gray-300 flex items-center justify-center text-xl font-bold hover:bg-gray-50"
              >
                -
              </button>
              <input
                type="number"
                min="2"
                max="200"
                value={state.bayCount}
                onChange={e => updateBayCount(Number(e.target.value))}
                className="w-24 text-center text-2xl font-bold border border-gray-300 rounded-lg py-2"
              />
              <button
                onClick={() => updateBayCount(state.bayCount + 1)}
                className="w-12 h-12 rounded-lg border border-gray-300 flex items-center justify-center text-xl font-bold hover:bg-gray-50"
              >
                +
              </button>
              <span className="text-sm text-gray-500">bays (2–200)</span>
            </div>
          </div>
        )}

        {/* Step 4: Bay editor */}
        {state.step === 4 && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-3">
            <h2 className="text-lg font-semibold text-[#004526]">Customise bays</h2>
            <p className="text-sm text-gray-600">Rename bays and optionally add per-bay access instructions.</p>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {state.bays.map((bay, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-8">#{i + 1}</span>
                    <input
                      type="text"
                      value={bay.label}
                      onChange={e => updateBay(i, { label: e.target.value })}
                      className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm"
                      placeholder={`Bay ${i + 1}`}
                    />
                    <button
                      onClick={() => setExpandedBay(expandedBay === i ? null : i)}
                      className="text-xs text-[#004526] hover:underline"
                    >
                      {expandedBay === i ? 'Hide' : 'Access'}
                    </button>
                  </div>
                  {expandedBay === i && (
                    <textarea
                      value={bay.accessInstructions}
                      onChange={e => updateBay(i, { accessInstructions: e.target.value })}
                      placeholder="Optional access instructions for this bay"
                      rows={2}
                      className="mt-2 w-full border border-gray-200 rounded px-2 py-1 text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-3 mt-6">
          {state.step > 1 && (
            <button onClick={() => setState(p => ({ ...p, step: p.step - 1 }))} className="flex-1 py-3 border border-gray-300 rounded-lg font-medium">
              Back
            </button>
          )}
          {state.step < 4 ? (
            <button
              disabled={!isStepValid()}
              onClick={() => setState(p => ({ ...p, step: p.step + 1 }))}
              className="flex-1 py-3 bg-[#004526] text-white rounded-lg font-semibold disabled:opacity-50 hover:bg-[#003a1f]"
            >
              Continue
            </button>
          ) : (
            <button
              disabled={!isStepValid() || submitting}
              onClick={handleSubmit}
              className="flex-1 py-3 bg-[#004526] text-white rounded-lg font-semibold disabled:opacity-50 hover:bg-[#003a1f]"
            >
              {submitting ? 'Creating pool...' : 'Create pool'}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
