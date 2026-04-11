'use client';

import { useState } from 'react';
import { spotManagerApi } from '../../lib/apiUrls';

interface BlockReservationsModalProps {
  listingId: string;
  listingAddress: string;
  currentOptedIn: boolean;
  currentRiskShareMode: 'PERCENTAGE' | 'MIN_BAYS_FLOOR' | null;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
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

export function BlockReservationsModal({
  listingId,
  listingAddress,
  currentOptedIn,
  currentRiskShareMode,
  onClose,
  onSuccess,
}: BlockReservationsModalProps) {
  const [optedIn, setOptedIn] = useState(currentOptedIn);
  const [riskShareMode, setRiskShareMode] = useState<'PERCENTAGE' | 'MIN_BAYS_FLOOR'>(
    currentRiskShareMode ?? 'PERCENTAGE',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const body: Record<string, unknown> = { blockReservationsOptedIn: optedIn };
      if (optedIn) body.riskShareMode = riskShareMode;

      const res = await fetch(spotManagerApi(`/api/v1/listings/${listingId}/block-reservations`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        const code = data.error || 'Update failed';
        setError(
          code === 'SPOT_MANAGER_NOT_ACTIVE' ? 'Your Spot Manager status is not ACTIVE yet.'
          : code === 'RC_INSURANCE_NOT_APPROVED' ? 'Your RC insurance needs admin approval before you can opt in.'
          : code === 'NOT_POOL_OWNER' ? 'You do not own this pool.'
          : code === 'NOT_A_POOL_LISTING' ? 'Only Spot Pools can be opted into block reservations.'
          : code
        );
        return;
      }
      onSuccess();
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h3 className="text-lg font-semibold text-[#004526]">Block Reservations</h3>
          <p className="text-sm text-gray-500 mt-1">{listingAddress}</p>
        </div>

        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

        {/* Opt-in toggle */}
        <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:border-[#004526]">
          <input
            type="checkbox"
            checked={optedIn}
            onChange={e => setOptedIn(e.target.checked)}
            className="mt-1 accent-[#004526]"
          />
          <div>
            <p className="font-medium text-gray-900">Accept block reservations</p>
            <p className="text-sm text-gray-500 mt-0.5">
              When enabled, this pool is visible to Block Spotters looking to reserve multiple bays at once.
              You&apos;ll earn per-bay rates with a risk share on unfilled bays (see below).
            </p>
          </div>
        </label>

        {/* Risk share mode selector — only shown when opting in */}
        {optedIn && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-900">Risk share mode</p>
            <p className="text-xs text-gray-500">
              Governs how unfilled bays are priced at settlement when a Block Spotter can&apos;t fill all contracted bays.
            </p>

            <label className={`block p-3 rounded-lg border cursor-pointer transition ${riskShareMode === 'PERCENTAGE' ? 'border-[#004526] bg-[#f0faf4]' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="riskShareMode"
                  checked={riskShareMode === 'PERCENTAGE'}
                  onChange={() => setRiskShareMode('PERCENTAGE')}
                  className="mt-1 accent-[#004526]"
                />
                <div>
                  <p className="font-medium text-sm">Percentage (recommended)</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Block Spotter pays full rate for filled bays and 30% of the per-bay rate for unfilled bays.
                    Lower upside, lower risk of cancelled contracts.
                  </p>
                </div>
              </div>
            </label>

            <label className={`block p-3 rounded-lg border cursor-pointer transition ${riskShareMode === 'MIN_BAYS_FLOOR' ? 'border-[#004526] bg-[#f0faf4]' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="riskShareMode"
                  checked={riskShareMode === 'MIN_BAYS_FLOOR'}
                  onChange={() => setRiskShareMode('MIN_BAYS_FLOOR')}
                  className="mt-1 accent-[#004526]"
                />
                <div>
                  <p className="font-medium text-sm">Minimum bays floor</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Block Spotter pays full rate for at least 55% of contracted bays, regardless of fill.
                    Higher guaranteed revenue, but fewer Block Spotters may accept your pool.
                  </p>
                </div>
              </div>
            </label>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg font-medium text-gray-700">
            Cancel
          </button>
          <button
            disabled={submitting}
            onClick={handleSave}
            className="flex-1 py-2 bg-[#004526] text-white rounded-lg font-semibold disabled:opacity-50 hover:bg-[#003a1f]"
          >
            {submitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
