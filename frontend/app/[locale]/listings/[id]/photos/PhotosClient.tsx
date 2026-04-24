'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useLocalizedRouter } from '../../../../../lib/locales/useLocalizedRouter';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Photo {
  url: string;
  index: number;
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

export default function ListingPhotosPage() {
  const _pathname = usePathname();
  const router = useLocalizedRouter();
  const listingId = _pathname.split("/").filter(Boolean)[2] ?? "";

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [validationStatus, setValidationStatus] = useState<Record<number, 'pending' | 'pass' | 'fail'>>({});
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [dragSource, setDragSource] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const load = async () => {
      const token = await getAuthToken();
      try {
        const res = await fetch(`${API_URL}/api/v1/listings/${listingId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const photoUrls: string[] = data.photos ?? [];
        setPhotos(photoUrls.map((url, i) => ({ url, index: i })));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [listingId]);

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    const idx = photos.length;
    setValidationStatus((s) => ({ ...s, [idx]: 'pending' }));
    try {
      const token = await getAuthToken();
      // Get pre-signed URL
      const urlRes = await fetch(`${API_URL}/api/v1/listings/${listingId}/photo-url`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type }),
      });
      if (!urlRes.ok) throw new Error('Could not get upload URL');
      const { uploadUrl, key } = await urlRes.json();

      // Upload to S3
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });

      // Poll for validation (max 15s)
      let validated = false;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const checkRes = await fetch(`${API_URL}/api/v1/listings/${listingId}/ai-validate?key=${key}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (checkRes.ok) {
          const result = await checkRes.json();
          if (result.status === 'PASS') {
            setValidationStatus((s) => ({ ...s, [idx]: 'pass' }));
            validated = true;
            // Refresh listing photos
            const refresh = await fetch(`${API_URL}/api/v1/listings/${listingId}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = await refresh.json();
            setPhotos((data.photos ?? []).map((url: string, i: number) => ({ url, index: i })));
            break;
          } else if (result.status === 'FAIL') {
            setValidationStatus((s) => ({ ...s, [idx]: 'fail' }));
            break;
          }
        }
      }
      if (!validated) setValidationStatus((s) => ({ ...s, [idx]: 'fail' }));
    } catch {
      setValidationStatus((s) => ({ ...s, [idx]: 'fail' }));
    } finally {
      setUploading(false);
    }
  }, [photos.length, listingId]);

  const handleRemove = async (index: number) => {
    if (photos.length <= 1) return;
    const token = await getAuthToken();
    const res = await fetch(`${API_URL}/api/v1/listings/${listingId}/photos/${index}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setPhotos((data.photos ?? []).map((url: string, i: number) => ({ url, index: i })));
      showToast('Photo removed');
    }
  };

  const handleDrop = async (targetIndex: number) => {
    if (dragSource === null || dragSource === targetIndex) return;
    // Build new order
    const order = photos.map((_, i) => i);
    const [removed] = order.splice(dragSource, 1);
    order.splice(targetIndex, 0, removed);

    const token = await getAuthToken();
    const res = await fetch(`${API_URL}/api/v1/listings/${listingId}/photos/order`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });
    if (res.ok) {
      const data = await res.json();
      setPhotos((data.photos ?? []).map((url: string, i: number) => ({ url, index: i })));
      showToast('Photos reordered');
    }
    setDragSource(null);
    setDragOver(null);
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-[#004526] border-t-transparent" />
          <p className="text-sm text-[#004526]">Loading photos…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 animate-page-enter">
      {/* Toast */}
      {toast && (
        <div className="fixed right-4 top-4 z-30 flex items-center gap-2 rounded-xl bg-[#004526] px-4 py-2.5 text-sm text-white shadow-[0_4px_20px_rgba(0,69,38,0.35)]">
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-xs">✓</span>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-['DM_Sans',sans-serif] text-xl font-bold text-[#004526]">
          Manage photos
        </h1>
        <button type="button" onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm font-medium text-[#006B3C] transition-colors hover:text-[#004526]">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back
        </button>
      </div>

      <p className="mb-4 text-sm text-gray-500">
        Drag to reorder. The first photo is the primary display image.
      </p>

      {/* Photo grid */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        {photos.map((photo, i) => (
          <div
            key={photo.url}
            data-testid="photo-cell"
            draggable
            onDragStart={() => setDragSource(i)}
            onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={() => handleDrop(i)}
            className={`group relative aspect-square overflow-hidden rounded-xl border-2 transition-all duration-200 ${
              dragOver === i
                ? 'border-[#AD3614] scale-105 shadow-lg shadow-[#AD3614]/20'
                : i === 0
                ? 'border-[#004526] shadow-md shadow-[#004526]/15'
                : 'border-[#C8DDD2] hover:border-[#006B3C]'
            } cursor-grab active:cursor-grabbing`}
          >
            <img src={photo.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />

            {/* Primary badge — brick crown */}
            {i === 0 && (
              <span
                data-testid="primary-badge"
                className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-[#AD3614] px-2 py-0.5 text-[10px] font-bold text-white shadow-sm"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-2.5 w-2.5">
                  <path fillRule="evenodd" d="M8 1.75a.75.75 0 0 1 .692.462l1.41 3.393 3.664.293a.75.75 0 0 1 .428 1.317l-2.791 2.39.853 3.575a.75.75 0 0 1-1.12.814L8 11.584l-3.136 1.81a.75.75 0 0 1-1.12-.814l.852-3.576-2.79-2.389a.75.75 0 0 1 .428-1.317l3.663-.293 1.41-3.393A.75.75 0 0 1 8 1.75Z" clipRule="evenodd" />
                </svg>
                Primary
              </span>
            )}

            {/* Drag handle */}
            <div className="absolute right-1.5 top-1.5 cursor-grab rounded-lg bg-black/50 p-1 opacity-0 transition-opacity group-hover:opacity-100">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="white" className="h-3.5 w-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
              </svg>
            </div>

            {/* Remove button */}
            <button
              type="button"
              data-testid={`remove-photo-${i}`}
              disabled={photos.length <= 1}
              onClick={() => handleRemove(i)}
              className="absolute bottom-1.5 right-1.5 rounded-full bg-red-500 p-1.5 text-white opacity-0 shadow-md transition-opacity hover:bg-red-600 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={`Remove photo ${i + 1}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-3 w-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Validation status */}
            {validationStatus[i] === 'pending' && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#004526]/60 backdrop-blur-sm">
                <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
              </div>
            )}
            {validationStatus[i] === 'pass' && (
              <div data-testid="validation-pass" className="absolute bottom-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#004526] shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="white" className="h-3 w-3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
            )}
            {validationStatus[i] === 'fail' && (
              <div className="absolute inset-0 flex items-center justify-center bg-red-500/65 backdrop-blur-sm">
                <p className="text-xs font-semibold text-white">Validation failed</p>
              </div>
            )}
          </div>
        ))}

        {/* Add photo cell */}
        <label className={`flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all duration-200 ${
          uploading
            ? 'border-[#006B3C] bg-[#EBF7F1]'
            : 'border-[#C8DDD2] bg-white hover:border-[#006B3C] hover:bg-[#EBF7F1]'
        }`}>
          {uploading ? (
            <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#004526] border-t-transparent" />
          ) : (
            <>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EBF7F1]">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#004526" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <span className="mt-1.5 text-xs font-medium text-[#004526]">Add photo</span>
            </>
          )}
          <input
            data-testid="add-photo-input"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </main>
  );
}

export function generateStaticParams() { return [{ id: '_' }]; }
