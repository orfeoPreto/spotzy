'use client';

import { useState, useEffect, useCallback } from 'react';
import { mainApi } from '../../lib/apiUrls';

interface PoolPhotosModalProps {
  listingId: string;
  listingAddress: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface PhotoSlot {
  status: 'idle' | 'uploading' | 'validating' | 'PASS' | 'FAIL';
  thumbnail?: string;
  reason?: string;
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

// Re-encode any image (HEIC, WebP, etc.) to JPEG so Rekognition always gets a supported format
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

export function PoolPhotosModal({ listingId, listingAddress, onClose, onSuccess }: PoolPhotosModalProps) {
  const [photos, setPhotos] = useState<[PhotoSlot, PhotoSlot]>([{ status: 'idle' }, { status: 'idle' }]);
  const [error, setError] = useState<string | null>(null);

  // Load existing photo previews
  useEffect(() => {
    async function loadExisting() {
      const token = await getAuthToken();
      const res = await fetch(mainApi(`/api/v1/listings/${listingId}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const listing = await res.json();
      const existing = (listing.photos ?? []).slice(0, 2) as Array<{ validationStatus?: string; url?: string }>;
      const next: [PhotoSlot, PhotoSlot] = [{ status: 'idle' }, { status: 'idle' }];
      existing.forEach((p, i) => {
        if (i > 1) return;
        if (p.validationStatus === 'PASS' || p.validationStatus === 'FAIL') {
          next[i] = {
            status: p.validationStatus as 'PASS' | 'FAIL',
            thumbnail: p.url ?? undefined,
          };
        }
      });
      setPhotos(next);
    }
    void loadExisting();
  }, [listingId]);

  const handleUpload = useCallback(async (index: 0 | 1, file: File) => {
    setError(null);
    if (file.size > 20 * 1024 * 1024) {
      setError('Image is too large. Please use a photo smaller than 20 MB.');
      return;
    }

    // Show thumbnail immediately
    const reader = new FileReader();
    reader.onload = (e) => {
      setPhotos((p) => {
        const n = [...p] as [PhotoSlot, PhotoSlot];
        n[index] = { status: 'uploading', thumbnail: e.target?.result as string };
        return n;
      });
    };
    reader.readAsDataURL(file);

    try {
      const token = await getAuthToken();
      const jpegBlob = await toJpegBlob(file);

      // Get presigned URL
      const urlRes = await fetch(mainApi(`/api/v1/listings/${listingId}/photo-url`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ photoIndex: index, contentType: 'image/jpeg' }),
      });
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl } = await urlRes.json() as { uploadUrl: string };

      // Mark as validating while we upload
      setPhotos((p) => {
        const n = [...p] as [PhotoSlot, PhotoSlot];
        n[index] = { ...n[index], status: 'validating' };
        return n;
      });

      // Upload directly to S3
      const uploadRes = await fetch(uploadUrl, { method: 'PUT', body: jpegBlob, headers: { 'Content-Type': 'image/jpeg' } });
      if (!uploadRes.ok) throw new Error('Upload failed');

      // Poll for validation status (Rekognition is async via S3 trigger)
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const lr = await fetch(mainApi(`/api/v1/listings/${listingId}`), { headers: { Authorization: `Bearer ${token}` } });
        if (!lr.ok) continue;
        const d = await lr.json() as { photos?: Array<{ validationStatus?: string; validationReason?: string }> };
        const vs = d.photos?.[index]?.validationStatus;
        if (vs === 'PASS' || vs === 'FAIL') {
          setPhotos((p) => {
            const n = [...p] as [PhotoSlot, PhotoSlot];
            n[index] = {
              ...n[index],
              status: vs,
              reason: d.photos?.[index]?.validationReason,
            };
            return n;
          });
          return;
        }
      }
      // Validation timed out — show a soft error but keep the thumbnail
      setPhotos((p) => {
        const n = [...p] as [PhotoSlot, PhotoSlot];
        n[index] = { ...n[index], status: 'FAIL', reason: 'Validation taking longer than expected' };
        return n;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setPhotos((p) => {
        const n = [...p] as [PhotoSlot, PhotoSlot];
        n[index] = { status: 'FAIL', reason: 'Upload error' };
        return n;
      });
    }
  }, [listingId]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-lg font-semibold text-[#004526]">Pool Photos</h3>
          <p className="text-sm text-gray-500 mt-1 truncate">{listingAddress}</p>
        </div>

        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

        <p className="text-xs text-gray-500">
          Upload 2 photos of your parking location. Photos are automatically validated by Spotzy's AI.
          Pools need at least 2 photos to appear prominently in search results.
        </p>

        <div className="grid grid-cols-2 gap-4">
          {([0, 1] as const).map((idx) => {
            const slot = photos[idx];
            const busy = slot.status === 'uploading' || slot.status === 'validating';
            return (
              <label
                key={idx}
                className={`relative flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
                  slot.status === 'PASS' ? 'border-green-500 bg-green-50' :
                  slot.status === 'FAIL' ? 'border-red-400 bg-red-50' :
                  busy ? 'border-amber-400 bg-amber-50' :
                  'border-gray-300 hover:border-gray-400'
                }`}
              >
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(idx, f); }}
                />
                {slot.thumbnail ? (
                  <img src={slot.thumbnail} alt="" className="h-full w-full rounded-xl object-cover" />
                ) : (
                  <div className="text-center">
                    <div className="text-3xl text-gray-400">+</div>
                    <p className="mt-1 text-xs text-gray-500">Photo {idx + 1}</p>
                  </div>
                )}
                {busy && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
                    <span className="text-sm font-medium text-white">
                      {slot.status === 'uploading' ? 'Uploading...' : 'Validating...'}
                    </span>
                  </div>
                )}
                {slot.status === 'PASS' && (
                  <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-green-600 text-white text-xs">
                    OK
                  </div>
                )}
                {slot.status === 'FAIL' && slot.reason && (
                  <div className="absolute bottom-2 left-2 right-2 rounded bg-red-600/80 px-2 py-1 text-center">
                    <p className="text-xs text-white">{slot.reason}</p>
                  </div>
                )}
              </label>
            );
          })}
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg font-medium text-gray-700">
            Close
          </button>
          <button
            onClick={onSuccess}
            className="flex-1 py-2 bg-[#004526] text-white rounded-lg font-semibold hover:bg-[#003a1f]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
