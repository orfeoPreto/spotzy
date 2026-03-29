'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '../../../../hooks/useAuth';
import AvailabilityGrid, { AvailabilityRule, SaveAvailabilityPayload } from '../../../../components/AvailabilityGrid';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function AvailabilityClient() {
  const router = useRouter();
  const pathname = usePathname();
  const id = pathname.split('/').filter(Boolean)[1] ?? '';
  const { user } = useAuth();

  const [rules, setRules] = useState<AvailabilityRule[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    fetch(`${API_URL}/api/v1/listings/${id}/availability`)
      .then((r) => r.json())
      .then((d) => {
        const data = d as { rules?: AvailabilityRule[]; type?: string };
        setRules(data.rules ?? []);
      })
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, [id, user?.userId]);

  const handleSave = async (payload: SaveAvailabilityPayload) => {
    if (!user) { router.push('/auth/login'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/listings/${id}/availability`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) { router.push('/auth/login'); return; }
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { message?: string } | null;
        setError(err?.message ?? 'Failed to save availability. Please try again.');
        return;
      }
      setToast('Availability updated');
      setTimeout(() => {
        setToast('');
        router.push('/dashboard/host');
      }, 1500);
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <main className="mx-auto max-w-2xl p-8">
      <button
        type="button"
        onClick={() => router.push('/dashboard/host')}
        className="mb-6 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        ← Back to dashboard
      </button>

      <h1 className="mb-1 text-2xl font-bold text-gray-900">Edit availability</h1>
      <p className="mb-6 text-sm text-gray-500">Define when your spot is open for booking.</p>

      {toast && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
          {toast}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      ) : (
        <AvailabilityGrid
          mode="edit"
          rules={rules ?? []}
          onSave={(payload) => void handleSave(payload)}
          saving={saving}
        />
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </main>
  );
}
