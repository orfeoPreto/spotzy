'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AdminGuard } from '../../../components/AdminGuard';
import { spotManagerApi } from '../../../lib/apiUrls';

interface HistoryEntry {
  singleShotPct: number;
  blockReservationPct: number;
  modifiedBy: string;
  modifiedAt: string;
}

interface PlatformFeeConfig {
  singleShotPct: number;
  blockReservationPct: number;
  lastModifiedBy: string | null;
  lastModifiedAt: string | null;
  historyLog: HistoryEntry[];
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

function PlatformFeeConfigInner() {
  const router = useRouter();
  const [config, setConfig] = useState<PlatformFeeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [singleShot, setSingleShot] = useState<number>(0.15);
  const [blockRes, setBlockRes] = useState<number>(0.15);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function load() {
      const token = await getAuthToken();
      const res = await fetch(spotManagerApi('/api/v1/admin/config/platform-fee'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) { router.push('/'); return; }
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setSingleShot(data.singleShotPct ?? 0.15);
        setBlockRes(data.blockReservationPct ?? 0.15);
      }
      setLoading(false);
    }
    load();
  }, [router]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      if (singleShot < 0 || singleShot > 0.30 || blockRes < 0 || blockRes > 0.30) {
        setError('Percentages must be between 0.00 and 0.30');
        return;
      }
      const token = await getAuthToken();
      const res = await fetch(spotManagerApi('/api/v1/admin/config/platform-fee'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ singleShotPct: singleShot, blockReservationPct: blockRes }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Update failed');
        return;
      }
      const updated = await res.json();
      setConfig(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-8 h-8 border-4 border-[#004526] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#004526] mb-2">Platform Fee Configuration</h1>
      <p className="text-gray-600 mb-6">
        Set the platform fee percentages applied at settlement. Changes only affect future bookings — historical
        settlements keep their snapshotted rate.
      </p>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">Platform fee updated successfully.</div>}

      <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 max-w-2xl">
        <strong>Warning:</strong> Changing these values affects how much Spotzy earns on every future booking and
        block reservation settlement. Please double-check before saving.
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4 max-w-2xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Single-shot booking fee ({(singleShot * 100).toFixed(0)}%)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="0.30"
            value={singleShot}
            onChange={e => setSingleShot(Number(e.target.value))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#006B3C]"
          />
          <p className="text-xs text-gray-500 mt-1">Applied to individual booking settlements. Range: 0.00–0.30.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Block reservation fee ({(blockRes * 100).toFixed(0)}%)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="0.30"
            value={blockRes}
            onChange={e => setBlockRes(Number(e.target.value))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#006B3C]"
          />
          <p className="text-xs text-gray-500 mt-1">Applied to block reservation settlements. Range: 0.00–0.30.</p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 bg-[#004526] text-white rounded-lg font-semibold disabled:opacity-50 hover:bg-[#003a1f]"
        >
          {saving ? 'Saving...' : 'Save platform fee'}
        </button>
      </div>

      {config && config.historyLog.length > 0 && (
        <div className="mt-8 max-w-3xl">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Changes</h2>
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Modified by</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Single-shot</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Block</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {config.historyLog.slice(-10).reverse().map((h, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 text-gray-600">{new Date(h.modifiedAt).toLocaleString()}</td>
                    <td className="px-4 py-3 font-mono text-xs">{h.modifiedBy}</td>
                    <td className="px-4 py-3">{(h.singleShotPct * 100).toFixed(0)}%</td>
                    <td className="px-4 py-3">{(h.blockReservationPct * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {config?.lastModifiedAt && (
        <p className="mt-4 text-xs text-gray-500 max-w-2xl">
          Last updated {new Date(config.lastModifiedAt).toLocaleString()}
          {config.lastModifiedBy && ` by ${config.lastModifiedBy}`}
        </p>
      )}
    </div>
  );
}

export default function BackofficePlatformFeePage() {
  return <AdminGuard><PlatformFeeConfigInner /></AdminGuard>;
}
