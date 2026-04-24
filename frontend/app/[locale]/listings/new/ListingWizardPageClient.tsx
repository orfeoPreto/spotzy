'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../../../../hooks/useAuth';
import { useLocalizedRouter } from '../../../../lib/locales/useLocalizedRouter';
import AvailabilityGrid, { SaveAvailabilityPayload } from '../../../../components/AvailabilityGrid';
import { useTranslation } from '../../../../lib/locales/TranslationProvider';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

const SPOT_TYPE_DEFS = [
  { value: 'COVERED_GARAGE', key: 'create.spot_types.COVERED_GARAGE', icon: '🏠' },
  { value: 'OPEN_SPACE', key: 'create.spot_types.OPEN_SPACE', icon: '🅿' },
  { value: 'CARPORT', key: 'create.spot_types.CARPORT', icon: '🛣' },
  { value: 'DRIVEWAY', key: 'create.spot_types.DRIVEWAY', icon: '🚗' },
];

const STEP_KEYS = ['create.steps.location', 'create.steps.details', 'create.steps.photos', 'create.steps.availability'];

interface GeoSuggestion { place_name: string; center: [number, number] }
interface PhotoSlot { file: File | null; status: 'idle' | 'uploading' | 'validating' | 'PASS' | 'FAIL'; reason?: string; thumbnail?: string }

interface WizardState {
  address: string;
  lat: number | null;
  lng: number | null;
  spotType: string;
  pricePerHour: number | '';
  evCharging: boolean;
  description: string;
  photos: [PhotoSlot, PhotoSlot];
  availability: Record<string, boolean>;
}

export default function ListingWizardPage() {
  const { t } = useTranslation('listings');
  const { t: tCommon } = useTranslation('common');
  const router = useLocalizedRouter();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [listingId, setListingId] = useState<string | null>(null);
  const [state, setState] = useState<WizardState>({
    address: '', lat: null, lng: null,
    spotType: '', pricePerHour: '', evCharging: false,
    description: '',
    photos: [{ file: null, status: 'idle' }, { file: null, status: 'idle' }],
    availability: {},
  });
  const [addressQuery, setAddressQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [availabilitySaved, setAvailabilitySaved] = useState(false);
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextFetchRef = useRef(false);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  // Render / update mini-map when coordinates change
  useEffect(() => {
    if (!state.lat || !state.lng || !mapContainerRef.current) return;
    if (!MAPBOX_TOKEN) return;

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
      const marker = new mapboxgl.Marker({ color: '#006B3C' })
        .setLngLat([state.lng, state.lat])
        .addTo(map);
      markerRef.current = marker;
    } else {
      mapInstanceRef.current.setCenter([state.lng, state.lat]);
      markerRef.current?.setLngLat([state.lng, state.lat]);
    }

    return () => {
      // Cleanup only when component unmounts (handled by React)
    };
  }, [state.lat, state.lng]);

  // Fetch address suggestions
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (skipNextFetchRef.current) { skipNextFetchRef.current = false; return; }
    if (addressQuery.length < 3) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addressQuery)}.json?access_token=${MAPBOX_TOKEN}&types=address`,
      );
      if (!res.ok) return;
      const data = await res.json() as { features: GeoSuggestion[] };
      setSuggestions(data.features ?? []);
    }, 300);
  }, [addressQuery]);

  const selectAddress = (s: GeoSuggestion) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    skipNextFetchRef.current = true;
    setState((p) => ({ ...p, address: s.place_name, lat: s.center[1], lng: s.center[0] }));
    setAddressQuery(s.place_name);
    setSuggestions([]);
    addressInputRef.current?.blur();
  };

  // Step validity
  const isStepValid = () => {
    if (step === 1) return !!state.address && state.lat !== null;
    if (step === 2) return !!state.spotType && state.pricePerHour !== '' && Number(state.pricePerHour) > 0;
    if (step === 3) return state.photos.some((p) => p.status === 'PASS');
    if (step === 4) return availabilitySaved;
  };

  const handleNext = async () => {
    if (!isStepValid()) return;
    if (step === 2) {
      // Create the listing in the backend before moving to photos
      if (!user) { router.push('/auth/login'); return; }
      setCreating(true);
      setCreateError('');
      try {
        const res = await fetch(`${API_URL}/api/v1/listings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
          body: JSON.stringify({
            address: state.address, addressLat: state.lat, addressLng: state.lng,
            spotType: state.spotType,
            hostNetPricePerHourEur: Number(state.pricePerHour),
            pricePerHour: Number(state.pricePerHour),
            evCharging: state.evCharging,
            description: state.description || undefined,
            dimensions: {},
          }),
        });
        if (res.status === 401) { router.push('/auth/login'); return; }
        if (!res.ok) { setCreateError('Failed to save listing. Please try again.'); return; }
        const listing = await res.json() as { listingId: string };
        setListingId(listing.listingId);
        setStep(3);
      } catch {
        setCreateError('Network error. Please check your connection.');
      } finally {
        setCreating(false);
      }
      return;
    }
    setStep((s) => Math.min(s + 1, 4));
  };

  const handleBack = () => setStep((s) => Math.max(s - 1, 1));

  const toggleAvailability = (key: string) => {
    setState((p) => ({ ...p, availability: { ...p.availability, [key]: !p.availability[key] } }));
  };

  // Normalise any image format to JPEG via canvas so Rekognition always
  // receives a supported format (WebP, HEIC-converted, etc. would otherwise fail).
  const toJpegBlob = (file: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas conversion failed')), 'image/jpeg', 0.92);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    });

  const handlePhotoUpload = async (index: 0 | 1, file: File) => {
    if (!listingId || !user) return;

    if (file.size > 20 * 1024 * 1024) {
      setState((p) => {
        const photos = [...p.photos] as [PhotoSlot, PhotoSlot];
        photos[index] = { file, status: 'FAIL', reason: 'Image is too large. Please use a photo smaller than 20 MB.' };
        return { ...p, photos };
      });
      return;
    }

    // Show thumbnail immediately while uploading
    const reader = new FileReader();
    reader.onload = (e) => {
      setState((p) => {
        const photos = [...p.photos] as [PhotoSlot, PhotoSlot];
        photos[index] = { file, status: 'uploading', thumbnail: e.target?.result as string };
        return { ...p, photos };
      });
    };
    reader.readAsDataURL(file);

    try {
      // 1. Convert to JPEG so Rekognition always gets a supported format
      const jpegBlob = await toJpegBlob(file);

      // 2. Get presigned URL from backend
      const urlRes = await fetch(`${API_URL}/api/v1/listings/${listingId}/photo-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ photoIndex: index, contentType: 'image/jpeg' }),
      });
      if (urlRes.status === 401) { router.push('/auth/login'); return; }
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl } = await urlRes.json() as { uploadUrl: string };

      // 3. Upload directly to S3
      setState((p) => {
        const photos = [...p.photos] as [PhotoSlot, PhotoSlot];
        photos[index] = { ...photos[index], status: 'validating' };
        return { ...p, photos };
      });
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: jpegBlob,
        headers: { 'Content-Type': 'image/jpeg' },
      });
      if (!uploadRes.ok) throw new Error('Upload to storage failed');

      // 3. Poll listing every 2s until AI validation completes (max 30s)
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const listingRes = await fetch(`${API_URL}/api/v1/listings/${listingId}`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (!listingRes.ok) continue;
        const listing = await listingRes.json() as { photos?: Array<{ validationStatus?: string; validationReason?: string }> };
        const photo = listing.photos?.[index];
        const vs = photo?.validationStatus;
        if (vs === 'PASS' || vs === 'FAIL' || vs === 'REVIEW') {
          setState((p) => {
            const photos = [...p.photos] as [PhotoSlot, PhotoSlot];
            photos[index] = { ...photos[index], status: vs === 'PASS' ? 'PASS' : 'FAIL', reason: photo?.validationReason };
            return { ...p, photos };
          });
          return;
        }
      }
      // Timed out waiting for AI validation
      setState((p) => {
        const photos = [...p.photos] as [PhotoSlot, PhotoSlot];
        photos[index] = { ...photos[index], status: 'FAIL', reason: 'Validation timed out. Please try a different photo.' };
        return { ...p, photos };
      });
    } catch (err) {
      setState((p) => {
        const photos = [...p.photos] as [PhotoSlot, PhotoSlot];
        photos[index] = { ...photos[index], status: 'FAIL', reason: err instanceof Error ? err.message : 'Upload failed' };
        return { ...p, photos };
      });
    }
  };

  const handleAvailabilitySave = async (payload: SaveAvailabilityPayload) => {
    if (!listingId || !user) return;
    setAvailabilitySaving(true);
    setAvailabilityError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/listings/${listingId}/availability`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) { router.push('/auth/login'); return; }
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { message?: string } | null;
        setAvailabilityError(err?.message ?? 'Failed to save availability. Please try again.');
        return;
      }
      setAvailabilitySaved(true);
    } catch {
      setAvailabilityError('Network error. Please check your connection.');
    } finally {
      setAvailabilitySaving(false);
    }
  };

  const handlePublish = async () => {
    if (!user) { router.push('/auth/login'); return; }
    if (!listingId) return;
    setPublishing(true);
    setPublishError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/listings/${listingId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { error?: string; failedChecks?: string[] } | null;
        setPublishError(
          err?.failedChecks?.length
            ? `Listing incomplete: ${err.failedChecks.join(', ')}`
            : (err?.error ?? 'Failed to publish. Please try again.')
        );
        return;
      }
      router.push('/dashboard/host');
    } catch {
      setPublishError('Network error. Please check your connection and try again.');
    } finally {
      setPublishing(false);
    }
  };

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const HOURS = ['06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21'];

  return (
    <main className="mx-auto max-w-2xl p-8 animate-page-enter">
      {/* Progress bar */}
      <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-[#C8DDD2]">
        <div
          className="h-1 rounded-full bg-[#004526] transition-all duration-500"
          style={{ width: `${(step / STEP_KEYS.length) * 100}%` }}
        />
      </div>

      {/* Step indicator */}
      <div className="mb-8 flex items-center justify-center gap-3">
        {STEP_KEYS.map((key, i) => (
          <div key={key} className="flex items-center gap-2">
            <button
              type="button"
              data-step={i + 1}
              data-active={step === i + 1 ? 'true' : 'false'}
              onClick={() => { if (i + 1 < step) setStep(i + 1); }}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all duration-200 ${
                step === i + 1
                  ? 'bg-[#006B3C] text-white shadow-md shadow-[#006B3C]/30'
                  : step > i + 1
                  ? 'bg-[#004526] text-white'
                  : 'bg-[#EBF7F1] text-[#004526]'
              }`}
            >
              {step > i + 1 ? '✓' : i + 1}
            </button>
            <span className={`hidden text-xs sm:block ${step === i + 1 ? 'font-semibold text-[#AD3614]' : step > i + 1 ? 'text-[#004526]' : 'text-gray-400'}`}>
              {t(key)}
            </span>
            {i < STEP_KEYS.length - 1 && (
              <div className={`h-px w-6 transition-colors ${step > i + 1 ? 'bg-[#004526]' : 'bg-[#C8DDD2]'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 1 — Location */}
      {step === 1 && (
        <section>
          <h2 className="mb-1 font-['DM_Sans',sans-serif] text-xl font-bold text-[#004526]">{t('create.location_heading')}</h2>
          <p className="mb-4 text-sm text-gray-500">{t('create.location_description', { defaultValue: 'Enter the exact address of your parking spot.' })}</p>
          <div className="relative">
            <input
              ref={addressInputRef}
              type="text"
              placeholder={t('create.address_placeholder')}
              value={addressQuery}
              onChange={(e) => { setAddressQuery(e.target.value); setState((p) => ({ ...p, address: '', lat: null, lng: null })); }}
              onBlur={() => setTimeout(() => setSuggestions([]), 200)}
              className="w-full rounded-lg border border-[#C8DDD2] bg-[#EBF7F1] px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 hover:border-[#006B3C] focus:border-[#006B3C] focus:outline-none focus:ring-2 focus:ring-[#006B3C]/20 transition-colors"
            />
            {suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-[#C8DDD2] bg-white shadow-[0_4px_20px_rgba(0,69,38,0.12)]">
                {suggestions.map((s) => (
                  <li key={s.place_name}
                    className="cursor-pointer border-l-2 border-l-transparent px-4 py-2.5 text-sm text-gray-700 transition-colors hover:border-l-[#006B3C] hover:bg-[#EBF7F1]"
                    onClick={() => selectAddress(s)}>
                    {s.place_name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {state.lat && (
            <div className="mt-3 overflow-hidden rounded-xl border border-[#C8DDD2] shadow-sm">
              <div ref={mapContainerRef} className="h-48 w-full" />
              <p className="bg-[#EBF7F1] px-3 py-1.5 text-xs text-[#004526]">
                {state.lat.toFixed(4)}, {state.lng?.toFixed(4)}
              </p>
            </div>
          )}
        </section>
      )}

      {/* Step 2 — Spot details */}
      {step === 2 && (
        <section>
          <h2 className="mb-1 font-['DM_Sans',sans-serif] text-xl font-bold text-[#004526]">{t('create.details_heading')}</h2>
          <p className="mb-4 text-sm text-gray-500">{t('create.details_description', { defaultValue: 'Tell us about your spot.' })}</p>
          {/* Spot type icon tiles */}
          <div className="mb-6 grid grid-cols-2 gap-3">
            {SPOT_TYPE_DEFS.map((st) => (
              <button
                key={st.value}
                type="button"
                data-testid="spot-type-tile"
                onClick={() => setState((p) => ({ ...p, spotType: st.value }))}
                className={`group rounded-xl border-2 p-4 text-left transition-all duration-200 ${
                  state.spotType === st.value
                    ? 'border-[#004526] bg-[#004526] shadow-md shadow-[#004526]/20'
                    : 'border-[#C8DDD2] bg-[#EBF7F1] hover:border-[#006B3C] hover:shadow-sm'
                }`}
              >
                <div className={`mb-2 flex h-10 w-10 items-center justify-center rounded-lg text-xl transition-colors ${
                  state.spotType === st.value ? 'bg-white/20' : 'bg-white'
                }`}>
                  {st.icon}
                </div>
                <p className={`text-sm font-medium transition-colors ${state.spotType === st.value ? 'text-white' : 'text-[#004526]'}`}>{t(st.key)}</p>
              </button>
            ))}
          </div>

          {/* Price input with brick left-border accent */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-[#004526]">{t('create.net_price_label')}</label>
            <div className="flex overflow-hidden rounded-lg border border-[#C8DDD2] bg-[#EBF7F1] focus-within:border-[#006B3C] focus-within:ring-2 focus-within:ring-[#006B3C]/20 transition-all">
              <span className="flex items-center border-r-2 border-[#AD3614] bg-[#AD3614]/10 px-3 text-sm font-semibold text-[#AD3614]">€</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={state.pricePerHour}
                onChange={(e) => setState((p) => ({ ...p, pricePerHour: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
                placeholder={t('create.price_placeholder')}
                className="flex-1 bg-transparent px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none"
              />
            </div>
            {/* Earnings & Spotter price preview */}
            {state.pricePerHour !== '' && Number(state.pricePerHour) > 0 && (() => {
              const net = Number(state.pricePerHour);
              const feePct = 0.15;
              const vatRate = 0.21;
              const daily = Math.round(net * 24 * 0.60 * 100) / 100;
              const weekly = Math.round(daily * 7 * 0.60 * 100) / 100;
              const monthly = Math.round(weekly * 4 * 0.60 * 100) / 100;
              const grossUp = (amount: number) => {
                const fee = Math.round(amount * (feePct / (1 - feePct)) * 100) / 100;
                const feeVat = Math.round(fee * vatRate * 100) / 100;
                return Math.round((amount + fee + feeVat) * 100) / 100;
              };
              return (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[#C8DDD2] bg-[#EBF7F1] p-3">
                    <p className="mb-2 text-xs font-semibold text-[#004526]">{t('create.earnings_ladder_title')}</p>
                    <div className="space-y-1 text-xs text-gray-600">
                      <p>{t('create.rate_hourly')}: <span className="font-semibold text-[#004526]">{'\u20AC'}{net.toFixed(2)}</span></p>
                      <p>{t('create.rate_daily')}: <span className="font-semibold text-[#004526]">{'\u20AC'}{daily.toFixed(2)}</span></p>
                      <p>{t('create.rate_weekly')}: <span className="font-semibold text-[#004526]">{'\u20AC'}{weekly.toFixed(2)}</span></p>
                      <p>{t('create.rate_monthly')}: <span className="font-semibold text-[#004526]">{'\u20AC'}{monthly.toFixed(2)}</span></p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#AD3614]/20 bg-[#AD3614]/5 p-3">
                    <p className="mb-2 text-xs font-semibold text-[#AD3614]">{t('create.spotter_pays_title')}</p>
                    <div className="space-y-1 text-xs text-gray-600">
                      <p>{t('create.rate_hourly')}: <span className="font-semibold text-[#AD3614]">{'\u20AC'}{grossUp(net).toFixed(2)}</span></p>
                      <p>{t('create.rate_daily')}: <span className="font-semibold text-[#AD3614]">{'\u20AC'}{grossUp(daily).toFixed(2)}</span></p>
                      <p>{t('create.rate_weekly')}: <span className="font-semibold text-[#AD3614]">{'\u20AC'}{grossUp(weekly).toFixed(2)}</span></p>
                      <p>{t('create.rate_monthly')}: <span className="font-semibold text-[#AD3614]">{'\u20AC'}{grossUp(monthly).toFixed(2)}</span></p>
                    </div>
                  </div>
                </div>
              );
            })()}
            <p className="mt-2 text-xs text-gray-400">{t('create.vat_status_hint')}</p>
          </div>

          {/* EV charging pill toggle */}
          <div data-testid="ev-charging-toggle" className="mb-4">
            <label className="mb-2 block text-sm font-medium text-[#004526]">{t('create.ev_label')}</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setState((p) => ({ ...p, evCharging: true }))}
                className={`flex-1 rounded-full border-2 py-2 text-sm font-medium transition-all duration-200 ${
                  state.evCharging
                    ? 'border-[#004526] bg-[#004526] text-white shadow-sm shadow-[#004526]/30'
                    : 'border-[#C8DDD2] bg-[#EBF7F1] text-[#004526] hover:border-[#006B3C]'
                }`}>
                Yes
              </button>
              <button type="button" onClick={() => setState((p) => ({ ...p, evCharging: false }))}
                className={`flex-1 rounded-full border-2 py-2 text-sm font-medium transition-all duration-200 ${
                  !state.evCharging
                    ? 'border-[#004526] bg-[#004526] text-white shadow-sm shadow-[#004526]/30'
                    : 'border-[#C8DDD2] bg-[#EBF7F1] text-[#004526] hover:border-[#006B3C]'
                }`}>
                No
              </button>
            </div>
            {state.evCharging && (
              <div data-testid="ev-confirmed-icon" className="mt-2 flex items-center gap-1.5 text-sm text-[#006B3C]">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" /></svg>
                {t('create.ev_confirmed')}
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm font-medium text-[#004526]">{t('create.description_label')} <span className="text-gray-400">{tCommon('labels.optional')}</span></label>
            <textarea
              rows={3}
              value={state.description}
              onChange={(e) => setState((p) => ({ ...p, description: e.target.value }))}
              placeholder={t('create.description_placeholder')}
              className="w-full resize-none rounded-lg border border-[#C8DDD2] bg-[#EBF7F1] px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 hover:border-[#006B3C] focus:border-[#006B3C] focus:outline-none focus:ring-2 focus:ring-[#006B3C]/20 transition-colors"
            />
          </div>
          {createError && <p className="mt-3 text-sm text-red-600">{createError}</p>}
        </section>
      )}

      {/* Step 3 — Photos */}
      {step === 3 && (
        <section>
          <h2 className="mb-1 font-['DM_Sans',sans-serif] text-xl font-bold text-[#004526]">{t('create.photos_heading')}</h2>
          <p className="mb-4 text-sm text-gray-500">{t('create.photos_description')}</p>
          <div className="grid grid-cols-2 gap-4">
            {([0, 1] as const).map((idx) => {
              const slot = state.photos[idx];
              const busy = slot.status === 'uploading' || slot.status === 'validating';
              return (
                <label key={idx} data-testid="upload-zone"
                  className={`relative flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all duration-200 ${
                    slot.status === 'PASS'
                      ? 'border-[#004526] bg-[#EBF7F1]'
                      : slot.status === 'FAIL'
                      ? 'border-red-400 bg-red-50'
                      : busy
                      ? 'border-[#006B3C] bg-[#EBF7F1]'
                      : 'border-[#C8DDD2] bg-white hover:border-[#006B3C] hover:bg-[#EBF7F1]'
                  }`}>
                  <input type="file" accept="image/*" className="sr-only" disabled={busy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePhotoUpload(idx, f); }} />
                  {slot.thumbnail ? (
                    <img src={slot.thumbnail} alt="" className="h-full w-full rounded-xl object-cover" />
                  ) : (
                    <div className="text-center">
                      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-[#EBF7F1] mx-auto">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#004526" className="h-6 w-6">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                        </svg>
                      </div>
                      <p className="text-xs text-[#004526] font-medium">{t('create.photo_slot', { index: String(idx + 1) })}</p>
                    </div>
                  )}
                  {busy && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-[#004526]/70 backdrop-blur-sm">
                      <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span className="text-xs font-medium text-white">
                        {slot.status === 'uploading' ? tCommon('status.uploading') : tCommon('status.validating')}
                      </span>
                    </div>
                  )}
                  {slot.status === 'PASS' && (
                    <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#004526] text-white text-xs shadow-md">✓</div>
                  )}
                  {slot.status === 'FAIL' && (
                    <div className="absolute bottom-2 left-2 right-2 rounded-lg bg-red-600/85 px-2 py-1.5 text-center backdrop-blur-sm">
                      <p className="text-xs text-white">✗ {slot.reason ?? 'Validation failed — try a clearer photo'}</p>
                    </div>
                  )}
                </label>
              );
            })}
          </div>
        </section>
      )}

      {/* Step 4 — Availability */}
      {step === 4 && (
        <section>
          <h2 className="mb-1 font-['DM_Sans',sans-serif] text-xl font-bold text-[#004526]">{t('create.availability_heading')}</h2>
          <p className="mb-4 text-sm text-gray-500">{t('create.availability_description')}</p>

          {availabilitySaved && (
            <div className="mb-4 flex items-center gap-2 rounded-xl bg-[#EBF7F1] px-4 py-2.5 text-sm text-[#004526]">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#004526] text-white text-xs">✓</span>
              {t('create.availability_saved')}
            </div>
          )}

          <AvailabilityGrid
            mode="edit"
            onSave={(payload) => void handleAvailabilitySave(payload)}
            saving={availabilitySaving}
          />

          {availabilityError && (
            <p className="mt-2 text-sm text-red-600">{availabilityError}</p>
          )}

          {/* Pre-publish checklist */}
          <div className="mt-6 rounded-xl border border-[#C8DDD2] bg-[#EBF7F1] p-4">
            <p className="mb-3 text-sm font-semibold text-[#004526]">{t('create.prepublish_title')}</p>
            {[
              { label: t('create.checklist_address'), done: true },
              { label: t('create.checklist_type'), done: true },
              { label: t('create.checklist_price'), done: true },
              { label: t('create.checklist_photos'), done: true },
              { label: t('create.checklist_availability'), done: availabilitySaved },
            ].map((item) => (
              <div key={item.label} className={`flex items-center gap-2 py-0.5 text-sm ${item.done ? 'text-[#004526]' : 'text-gray-400'}`}>
                <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] ${item.done ? 'bg-[#004526] text-white' : 'border border-gray-300 text-transparent'}`}>✓</span>
                {item.label}
              </div>
            ))}
          </div>

          {publishError && (
            <p className="mt-4 text-sm text-red-600">{publishError}</p>
          )}
          {/* Primary CTA — Forest green */}
          <button type="button" onClick={() => void handlePublish()} disabled={publishing || !availabilitySaved}
            className="mt-6 w-full rounded-xl bg-[#004526] py-3 text-sm font-semibold text-white shadow-md shadow-[#004526]/30 transition-all hover:bg-[#006B3C] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
            {publishing ? tCommon('status.publishing') : t('create.publish_button')}
          </button>
        </section>
      )}

      {/* Navigation */}
      {step < 4 && (
        <div className="mt-8 flex gap-3">
          {step > 1 && (
            <button type="button" onClick={handleBack}
              className="flex-1 rounded-xl border-2 border-[#004526] py-2.5 text-sm font-semibold text-[#004526] transition-all hover:bg-[#EBF7F1] active:scale-[0.98]">
              {tCommon('buttons.back')}
            </button>
          )}
          <button type="button" onClick={() => void handleNext()} disabled={!isStepValid() || creating}
            className="flex-1 rounded-xl bg-[#004526] py-2.5 text-sm font-semibold text-white shadow-md shadow-[#004526]/30 transition-all hover:bg-[#006B3C] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
            {creating ? tCommon('status.saving') : tCommon('buttons.next')}
          </button>
        </div>
      )}
    </main>
  );
}
