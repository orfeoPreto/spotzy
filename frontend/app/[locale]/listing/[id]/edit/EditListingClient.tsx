'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useLocalizedRouter } from '../../../../../lib/locales/useLocalizedRouter';
import { useAuth } from '../../../../../hooks/useAuth';
import { useListing } from '../../../../../hooks/useListing';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

const SPOT_TYPES = [
  { value: 'COVERED_GARAGE', label: 'Covered garage', icon: '🏠' },
  { value: 'OPEN_SPACE', label: 'Open lot', icon: '🅿' },
  { value: 'CARPORT', label: 'Carport', icon: '🛣' },
  { value: 'DRIVEWAY', label: 'Private driveway', icon: '🚗' },
];

interface GeoSuggestion { place_name: string; center: [number, number] }
interface PhotoSlot { status: 'idle' | 'uploading' | 'validating' | 'PASS' | 'FAIL'; reason?: string; thumbnail?: string }

export default function EditListingClient() {
  const router = useLocalizedRouter();
  const pathname = usePathname();
  const listingId = pathname.split('/').filter(Boolean)[2] ?? '';
  const { user } = useAuth();
  const { listing, isLoading, error: loadError } = useListing(listingId);

  const [address, setAddress] = useState('');
  const [addressLat, setAddressLat] = useState<number | null>(null);
  const [addressLng, setAddressLng] = useState<number | null>(null);
  const [spotType, setSpotType] = useState('');
  const [pricePerHour, setPricePerHour] = useState<number | ''>('');
  const [evCharging, setEvCharging] = useState(false);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<[PhotoSlot, PhotoSlot]>([{ status: 'idle' }, { status: 'idle' }]);
  const [addressQuery, setAddressQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [initialised, setInitialised] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!listing || initialised) return;
    setAddress(listing.address ?? '');
    setAddressQuery(listing.address ?? '');
    setAddressLat(listing.addressLat ?? null);
    setAddressLng(listing.addressLng ?? null);
    setSpotType(listing.spotType ?? '');
    setPricePerHour(listing.pricePerHour ?? '');
    setEvCharging(listing.evCharging ?? false);
    setDescription(listing.description ?? '');
    const existingPhotos = listing.photos ?? [];
    setPhotos([
      existingPhotos[0] ? { status: 'PASS', thumbnail: existingPhotos[0] } : { status: 'idle' },
      existingPhotos[1] ? { status: 'PASS', thumbnail: existingPhotos[1] } : { status: 'idle' },
    ]);
    setInitialised(true);
  }, [listing, initialised]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (addressQuery.length < 3 || addressQuery === address) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addressQuery)}.json?access_token=${MAPBOX_TOKEN}&types=address`);
      if (!res.ok) return;
      const data = await res.json() as { features: GeoSuggestion[] };
      setSuggestions(data.features ?? []);
    }, 300);
  }, [addressQuery]);

  const selectAddress = (s: GeoSuggestion) => {
    setAddress(s.place_name);
    setAddressLat(s.center[1]);
    setAddressLng(s.center[0]);
    setAddressQuery(s.place_name);
    setSuggestions([]);
  };

  const toJpegBlob = (file: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d')!.drawImage(img, 0, 0); c.toBlob((b) => b ? resolve(b) : reject(new Error('Canvas fail')), 'image/jpeg', 0.92); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load')); };
      img.src = url;
    });

  const handlePhotoUpload = async (index: 0 | 1, file: File) => {
    if (!user) return;
    if (file.size > 20 * 1024 * 1024) { setPhotos((p) => { const n = [...p] as [PhotoSlot, PhotoSlot]; n[index] = { status: 'FAIL', reason: 'Too large (max 20 MB)' }; return n; }); return; }
    const reader = new FileReader();
    reader.onload = (e) => setPhotos((p) => { const n = [...p] as [PhotoSlot, PhotoSlot]; n[index] = { status: 'uploading', thumbnail: e.target?.result as string }; return n; });
    reader.readAsDataURL(file);
    try {
      const jpegBlob = await toJpegBlob(file);
      const urlRes = await fetch(`${API_URL}/api/v1/listings/${listingId}/photo-url`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` }, body: JSON.stringify({ photoIndex: index, contentType: 'image/jpeg' }) });
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl } = await urlRes.json() as { uploadUrl: string };
      setPhotos((p) => { const n = [...p] as [PhotoSlot, PhotoSlot]; n[index] = { ...n[index], status: 'validating' }; return n; });
      await fetch(uploadUrl, { method: 'PUT', body: jpegBlob, headers: { 'Content-Type': 'image/jpeg' } });
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const lr = await fetch(`${API_URL}/api/v1/listings/${listingId}`, { headers: { Authorization: `Bearer ${user.token}` } });
        if (!lr.ok) continue;
        const d = await lr.json() as { photos?: Array<{ validationStatus?: string; validationReason?: string }> };
        const vs = d.photos?.[index]?.validationStatus;
        if (vs === 'PASS' || vs === 'FAIL' || vs === 'REVIEW') { setPhotos((p) => { const n = [...p] as [PhotoSlot, PhotoSlot]; n[index] = { ...n[index], status: vs === 'PASS' ? 'PASS' : 'FAIL', reason: d.photos?.[index]?.validationReason }; return n; }); return; }
      }
      setPhotos((p) => { const n = [...p] as [PhotoSlot, PhotoSlot]; n[index] = { ...n[index], status: 'FAIL', reason: 'Validation timed out' }; return n; });
    } catch (err) {
      setPhotos((p) => { const n = [...p] as [PhotoSlot, PhotoSlot]; n[index] = { ...n[index], status: 'FAIL', reason: err instanceof Error ? err.message : 'Upload failed' }; return n; });
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true); setSaveError(''); setSaveSuccess(false);
    try {
      const res = await fetch(`${API_URL}/api/v1/listings/${listingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ address, addressLat, addressLng, spotType, pricePerHour: Number(pricePerHour), evCharging, description: description || undefined }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null) as { message?: string } | null; setSaveError(err?.message ?? 'Failed to save'); return; }
      setSaveSuccess(true);
    } catch { setSaveError('Network error'); } finally { setSaving(false); }
  };

  if (isLoading) return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded-xl bg-[#EBF7F1]" />
        <div className="h-10 rounded-xl bg-[#EBF7F1]" />
        <div className="h-10 rounded-xl bg-[#EBF7F1]" />
        <div className="h-24 rounded-xl bg-[#EBF7F1]" />
      </div>
    </main>
  );
  if (loadError || !listing) return (
    <main className="mx-auto max-w-2xl p-8">
      <p className="text-red-600">Failed to load listing.</p>
      <button type="button" onClick={() => router.push('/dashboard/host')} className="mt-4 text-sm text-[#004526] hover:underline">Back to dashboard</button>
    </main>
  );

  const isValid = !!address && addressLat !== null && !!spotType && pricePerHour !== '' && Number(pricePerHour) > 0;

  return (
    <main className="mx-auto max-w-2xl p-8 animate-page-enter">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-['DM_Sans',sans-serif] text-xl font-bold text-[#004526]">Edit listing</h1>
        <button type="button" onClick={() => router.push('/dashboard/host')}
          className="text-sm font-medium text-[#006B3C] hover:text-[#004526] hover:underline transition-colors">
          Back to dashboard
        </button>
      </div>

      {saveSuccess && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-[#EBF7F1] px-4 py-2.5 text-sm text-[#004526]">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#004526] text-white text-xs">✓</span>
          Changes saved successfully.
        </div>
      )}

      {/* Address */}
      <div className="mb-6">
        <label className="mb-1 block text-sm font-medium text-[#004526]">Address</label>
        <div className="relative">
          <input
            type="text"
            value={addressQuery}
            onChange={(e) => { setAddressQuery(e.target.value); setAddress(''); setAddressLat(null); setAddressLng(null); }}
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
      </div>

      {/* Spot type icon tiles */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-[#004526]">Spot type</label>
        <div className="grid grid-cols-2 gap-3">
          {SPOT_TYPES.map((t) => (
            <button key={t.value} type="button" onClick={() => setSpotType(t.value)}
              className={`rounded-xl border-2 p-4 text-left transition-all duration-200 ${
                spotType === t.value
                  ? 'border-[#004526] bg-[#004526] shadow-md shadow-[#004526]/20'
                  : 'border-[#C8DDD2] bg-[#EBF7F1] hover:border-[#006B3C] hover:shadow-sm'
              }`}>
              <div className={`mb-2 flex h-10 w-10 items-center justify-center rounded-lg text-xl ${
                spotType === t.value ? 'bg-white/20' : 'bg-white'
              }`}>
                {t.icon}
              </div>
              <p className={`text-sm font-medium ${spotType === t.value ? 'text-white' : 'text-[#004526]'}`}>{t.label}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Price with brick accent */}
      <div className="mb-6">
        <label className="mb-1 block text-sm font-medium text-[#004526]">Net price per hour</label>
        <div className="flex overflow-hidden rounded-lg border border-[#C8DDD2] bg-[#EBF7F1] focus-within:border-[#006B3C] focus-within:ring-2 focus-within:ring-[#006B3C]/20 transition-all">
          <span className="flex items-center border-r-2 border-[#AD3614] bg-[#AD3614]/10 px-3 text-sm font-semibold text-[#AD3614]">€</span>
          <input
            type="number" min={0.5} step={0.5} value={pricePerHour}
            onChange={(e) => setPricePerHour(e.target.value === '' ? '' : parseFloat(e.target.value))}
            placeholder="e.g. 3.50"
            className="flex-1 bg-transparent px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none"
          />
        </div>
      </div>

      {/* EV charging pill toggle */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-[#004526]">EV charging available?</label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setEvCharging(true)}
            className={`flex-1 rounded-full border-2 py-2 text-sm font-medium transition-all duration-200 ${
              evCharging
                ? 'border-[#004526] bg-[#004526] text-white shadow-sm shadow-[#004526]/30'
                : 'border-[#C8DDD2] bg-[#EBF7F1] text-[#004526] hover:border-[#006B3C]'
            }`}>
            Yes
          </button>
          <button type="button" onClick={() => setEvCharging(false)}
            className={`flex-1 rounded-full border-2 py-2 text-sm font-medium transition-all duration-200 ${
              !evCharging
                ? 'border-[#004526] bg-[#004526] text-white shadow-sm shadow-[#004526]/30'
                : 'border-[#C8DDD2] bg-[#EBF7F1] text-[#004526] hover:border-[#006B3C]'
            }`}>
            No
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="mb-6">
        <label className="mb-1 block text-sm font-medium text-[#004526]">Description <span className="text-gray-400">(optional)</span></label>
        <textarea
          rows={3} value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Access instructions..."
          className="w-full resize-none rounded-lg border border-[#C8DDD2] bg-[#EBF7F1] px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 hover:border-[#006B3C] focus:border-[#006B3C] focus:outline-none focus:ring-2 focus:ring-[#006B3C]/20 transition-colors"
        />
      </div>

      {/* Photos */}
      <div className="mb-6">
        <label className="mb-1 block text-sm font-medium text-[#004526]">Photos</label>
        <p className="mb-3 text-xs text-gray-500">Upload or replace photos.</p>
        <div className="grid grid-cols-2 gap-4">
          {([0, 1] as const).map((idx) => {
            const slot = photos[idx];
            const busy = slot.status === 'uploading' || slot.status === 'validating';
            return (
              <label key={idx}
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
                {slot.thumbnail
                  ? <img src={slot.thumbnail} alt="" className="h-full w-full rounded-xl object-cover" />
                  : (
                    <div className="text-center">
                      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-[#EBF7F1] mx-auto">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#004526" className="h-6 w-6">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      </div>
                      <p className="text-xs text-[#004526] font-medium">Photo {idx + 1}</p>
                    </div>
                  )}
                {busy && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-[#004526]/70 backdrop-blur-sm">
                    <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span className="text-xs font-medium text-white">{slot.status === 'uploading' ? 'Uploading...' : 'Validating...'}</span>
                  </div>
                )}
                {slot.status === 'PASS' && (
                  <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#004526] text-white text-xs shadow-md">✓</div>
                )}
                {slot.status === 'FAIL' && slot.reason && (
                  <div className="absolute bottom-2 left-2 right-2 rounded-lg bg-red-600/85 px-2 py-1.5 text-center backdrop-blur-sm">
                    <p className="text-xs text-white">{slot.reason}</p>
                  </div>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {saveError && <p className="mb-4 text-sm text-red-600">{saveError}</p>}
      <button type="button" onClick={() => void handleSave()} disabled={saving || !isValid}
        className="w-full rounded-xl bg-[#004526] py-3 text-sm font-semibold text-white shadow-md shadow-[#004526]/30 transition-all hover:bg-[#006B3C] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
        {saving ? 'Saving...' : 'Save changes'}
      </button>
    </main>
  );
}
