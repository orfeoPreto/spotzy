'use client';

import { useState, useEffect } from 'react';

import { spotManagerApi } from '../../lib/apiUrls';

interface Bay {
  bayId: string;
  label: string;
  status: string;
  accessInstructions?: string | null;
}

interface BaySwapModalProps {
  bookingId: string;
  currentBayId: string;
  currentBayLabel: string;
  poolListingId: string;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function BaySwapModal({ bookingId, currentBayId, currentBayLabel, poolListingId, token, onClose, onSuccess }: BaySwapModalProps) {
  const [bays, setBays] = useState<Bay[]>([]);
  const [selectedBayId, setSelectedBayId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadBays() {
      const res = await fetch(spotManagerApi(`/api/v1/listings/${poolListingId}/bays?status=ACTIVE`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBays((data.bays ?? data).filter((b: Bay) => b.bayId !== currentBayId));
      }
      setLoading(false);
    }
    loadBays();
  }, [poolListingId, currentBayId, token]);

  const handleSwap = async () => {
    if (!selectedBayId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(spotManagerApi(`/api/v1/bookings/${bookingId}/swap-bay`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ targetBayId: selectedBayId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Swap failed');
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
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-[#004526]">Swap Bay Assignment</h3>

        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-500">Current bay</p>
          <p className="font-medium">{currentBayLabel}</p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin w-6 h-6 border-3 border-[#004526] border-t-transparent rounded-full" />
          </div>
        ) : bays.length === 0 ? (
          <p className="text-gray-500 text-sm">No other available bays in this pool.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">Select target bay:</p>
            {bays.map(bay => (
              <label
                key={bay.bayId}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${selectedBayId === bay.bayId ? 'border-[#004526] bg-[#f0faf4]' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <input
                  type="radio"
                  name="targetBay"
                  checked={selectedBayId === bay.bayId}
                  onChange={() => setSelectedBayId(bay.bayId)}
                  className="accent-[#004526]"
                />
                <span className="font-medium">{bay.label}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-300 rounded-lg font-medium text-gray-700">
            Cancel
          </button>
          <button
            disabled={!selectedBayId || submitting}
            onClick={handleSwap}
            className="flex-1 py-2 bg-[#004526] text-white rounded-lg font-semibold disabled:opacity-50 hover:bg-[#003a1f]"
          >
            {submitting ? 'Swapping...' : 'Confirm swap'}
          </button>
        </div>
      </div>
    </div>
  );
}
