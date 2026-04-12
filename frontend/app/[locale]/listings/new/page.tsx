'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../../hooks/useAuth';
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
  const router = useRouter();
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
            spotType: state.spotType, pricePerHour: Number(state.pricePerHour),
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
    <main className="mx-auto max-w-2xl p-8">
      {/* Step indicator */}
      <div className="mb-8 flex items-center justify-center gap-3">
        {STEP_KEYS.map((key, i) => (
          <div key={key} className="flex items-center gap-2">
            <button
              type="button"
              data-step={i + 1}
              data-active={step === i + 1 ? 'true' : 'false'}
              onClick={() => { if (i + 1 < step) setStep(i + 1); }}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                step === i + 1 ? 'bg-[#006B3C] text-white' : step > i + 1 ? 'bg-[#004526] text-white' : 'bg-gray-200 text-gray-500'
              }`}
            >
              {i + 1}
            </button>
            <span className={`hidden text-xs sm:block ${step === i + 1 ? 'font-semibold text-[#AD3614]' : 'text-gray-400'}`}>
              {t(key)}
            </span>
            {i < STEP_KEYS.length - 1 && <div className="h-px w-6 bg-gray-300" />}
          </div>
        ))}
      </div>

      {/* Step 1 — Location */}
      {step === 1 && (
        <section>
          <h2 className="mb-4 text-xl font-bold text-gray-900">{t('create.location_heading')}</h2>
          <div className="relative">
            <input
              ref={addressInputRef}
              type="text"
              placeholder={t('create.address_placeholder')}
              value={addressQuery}
              onChange={(e) => { setAddressQuery(e.target.value); setState((p) => ({ ...p, address: '', lat: null, lng: null })); }}
              onBlur={() => setTimeout(() => setSuggestions([]), 200)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm"
            />
            {suggestions.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg">
                {suggestions.map((s) => (
                  <li key={s.place_name}
                    className="cursor-pointer px-4 py-2 text-sm hover:bg-gray-50"
                    onClick={() => selectAddress(s)}>
                    {s.place_name}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {state.lat && (
            <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
              <div ref={mapContainerRef} className="h-48 w-full" />
              <p className="bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
                {state.lat.toFixed(4)}, {state.lng?.toFixed(4)}
              </p>
            </div>
          )}
        </section>
      )}

      {/* Step 2 — Spot details */}
      {step === 2 && (
        <section>
          <h2 className="mb-4 text-xl font-bold text-gray-900">{t('create.details_heading')}</h2>
          <div className="mb-6 grid grid-cols-2 gap-3">
            {SPOT_TYPE_DEFS.map((st) => (
              <button
                key={st.value}
                type="button"
                data-testid="spot-type-tile"
                onClick={() => setState((p) => ({ ...p, spotType: st.value }))}
                className={`rounded-xl border-2 p-4 text-left transition-colors ${
                  state.spotType === st.value ? 'border-amber bg-amber-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="mb-1 text-2xl">{st.icon}</div>
                <p className="text-sm font-medium text-gray-900">{t(st.key)}</p>
              </button>
            ))}
          </div>
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('create.price_label')}</label>
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={state.pricePerHour}
              onChange={(e) => setState((p) => ({ ...p, pricePerHour: e.target.value === '' ? '' : parseFloat(e.target.value) }))}
              placeholder={t('create.price_placeholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div data-testid="ev-charging-toggle">
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('create.ev_label')}</label>
            <div className="flex gap-3">
              <button type="button" onClick={() => setState((p) => ({ ...p, evCharging: true }))}
                className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${state.evCharging ? 'border-[#059669] bg-[#EBF7F1] text-[#059669]' : 'border-gray-300 text-gray-600'}`}>
                Yes
              </button>
              <button type="button" onClick={() => setState((p) => ({ ...p, evCharging: false }))}
                className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${!state.evCharging ? 'border-gray-400 bg-gray-50 text-gray-700' : 'border-gray-300 text-gray-600'}`}>
                No
              </button>
            </div>
            {state.evCharging && (
              <div data-testid="ev-confirmed-icon" className="mt-2 flex items-center gap-1.5 text-sm text-[#059669]">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" /></svg>
                {t('create.ev_confirmed')}
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('create.description_label')} <span className="text-gray-400">{tCommon('labels.optional')}</span></label>
            <textarea
              rows={3}
              value={state.description}
              onChange={(e) => setState((p) => ({ ...p, description: e.target.value }))}
              placeholder={t('create.description_placeholder')}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          {createError && <p className="mt-3 text-sm text-red-600">{createError}</p>}
        </section>
      )}

      {/* Step 3 — Photos */}
      {step === 3 && (
        <section>
          <h2 className="mb-2 text-xl font-bold text-gray-900">{t('create.photos_heading')}</h2>
          <p className="mb-4 text-sm text-gray-500">{t('create.photos_description')}</p>
          <div className="grid grid-cols-2 gap-4">
            {([0, 1] as const).map((idx) => {
              const slot = state.photos[idx];
              const busy = slot.status === 'uploading' || slot.status === 'validating';
              return (
                <label key={idx} data-testid="upload-zone"
                  className={`relative flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
                    slot.status === 'PASS' ? 'border-green-500 bg-green-50' :
                    slot.status === 'FAIL' ? 'border-red-400 bg-red-50' :
                    busy ? 'border-amber-400 bg-amber-50' : 'border-gray-300 hover:border-gray-400'
                  }`}>
                  <input type="file" accept="image/*" className="sr-only" disabled={busy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePhotoUpload(idx, f); }} />
                  {slot.thumbnail ? (
                    <img src={slot.thumbnail} alt="" className="h-full w-full rounded-xl object-cover" />
                  ) : (
                    <div className="text-center">
                      <div className="text-3xl text-gray-400">📷</div>
                      <p className="mt-1 text-xs text-gray-500">{t('create.photo_slot', { index: String(idx + 1) })}</p>
                    </div>
                  )}
                  {busy && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
                      <span className="text-sm font-medium text-white">
                        {slot.status === 'uploading' ? tCommon('status.uploading') : tCommon('status.validating')}
                      </span>
                    </div>
                  )}
                  {slot.status === 'PASS' && (
                    <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-green-600 text-white text-xs">✓</div>
                  )}
                  {slot.status === 'FAIL' && (
                    <div className="absolute bottom-2 left-2 right-2 rounded bg-red-600/80 px-2 py-1 text-center">
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
          <h2 className="mb-1 text-xl font-bold text-gray-900">{t('create.availability_heading')}</h2>
          <p className="mb-4 text-sm text-gray-500">{t('create.availability_description')}</p>

          {availabilitySaved && (
            <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
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

          <div className="mt-6 rounded-xl bg-green-50 p-4">
            <p className="mb-2 text-sm font-semibold text-green-800">{t('create.prepublish_title')}</p>
            {[
              { label: t('create.checklist_address'), done: true },
              { label: t('create.checklist_type'), done: true },
              { label: t('create.checklist_price'), done: true },
              { label: t('create.checklist_photos'), done: true },
              { label: t('create.checklist_availability'), done: availabilitySaved },
            ].map((item) => (
              <div key={item.label} className={`flex items-center gap-2 text-sm ${item.done ? 'text-green-700' : 'text-gray-400'}`}>
                <span>{item.done ? '✓' : '○'}</span> {item.label}
              </div>
            ))}
          </div>

          {publishError && (
            <p className="mt-4 text-sm text-red-600">{publishError}</p>
          )}
          <button type="button" onClick={() => void handlePublish()} disabled={publishing || !availabilitySaved}
            className="mt-6 w-full rounded-lg bg-[#006B3C] py-3 text-sm font-medium text-white disabled:opacity-40">
            {publishing ? tCommon('status.publishing') : t('create.publish_button')}
          </button>
        </section>
      )}

      {/* Navigation */}
      {step < 4 && (
        <div className="mt-8 flex gap-3">
          {step > 1 && (
            <button type="button" onClick={handleBack}
              className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700">
              {tCommon('buttons.back')}
            </button>
          )}
          <button type="button" onClick={() => void handleNext()} disabled={!isStepValid() || creating}
            className="flex-1 rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white disabled:opacity-40">
            {creating ? tCommon('status.saving') : tCommon('buttons.next')}
          </button>
        </div>
      )}
    </main>
  );
}
