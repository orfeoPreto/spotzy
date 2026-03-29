'use client';

import { useState } from 'react';

interface ModifyBooking {
  bookingId: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  totalPrice: number;
  pricePerHour: number;
}

interface ModifyModalProps {
  booking: ModifyBooking;
  onClose: () => void;
  onModified: () => void;
}

type ChangeType = 'start' | 'end' | null;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

async function getToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch {
    return '';
  }
}

// Treat bare datetime-local strings (no tz suffix) as UTC so they compare
// consistently with booking dates that already carry a Z suffix.
function toMs(s: string): number {
  if (!s) return 0;
  return /[Zz]|[+-]\d{2}:\d{2}$/.test(s)
    ? new Date(s).getTime()
    : new Date(s + 'Z').getTime();
}

function calcHours(start: string, end: string): number {
  return (toMs(end) - toMs(start)) / (1000 * 60 * 60);
}

export default function ModifyModal({ booking, onClose, onModified }: ModifyModalProps) {
  const [changeType, setChangeType] = useState<ChangeType>(null);
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);

  const bStartDate = booking.startDate ?? booking.startTime ?? '';
  const bEndDate = booking.endDate ?? booking.endTime ?? '';
  const originalHours = calcHours(bStartDate, bEndDate);

  let priceDiff = 0;
  if (newValue && changeType) {
    const newStart = changeType === 'start' ? newValue : bStartDate;
    const newEnd   = changeType === 'end'   ? newValue : bEndDate;
    const newHours = calcHours(newStart, newEnd);
    priceDiff = parseFloat(((newHours - originalHours) * booking.pricePerHour).toFixed(2));
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = await getToken();
      const body = {
        newStartTime: changeType === 'start' ? newValue : bStartDate,
        newEndTime: changeType === 'end' ? newValue : bEndDate,
      };
      const res = await fetch(`${API_URL}/api/v1/bookings/${booking.bookingId}/modify`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) onModified();
    } finally {
      setSaving(false);
    }
  };

  // Convert ISO to datetime-local value
  function toInputValue(iso: string) {
    return iso.slice(0, 16).replace('Z', '');
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Modify booking</h2>

        <div className="mb-4 flex gap-3">
          <button
            type="button"
            onClick={() => { setChangeType('start'); setNewValue(toInputValue(bStartDate)); }}
            className={`flex-1 rounded-lg border py-2 text-sm font-medium ${changeType === 'start' ? 'border-[#AD3614] bg-amber-50 text-[#AD3614]' : 'border-gray-300 text-gray-600'}`}
          >
            Change start time
          </button>
          <button
            type="button"
            onClick={() => { setChangeType('end'); setNewValue(toInputValue(bEndDate)); }}
            className={`flex-1 rounded-lg border py-2 text-sm font-medium ${changeType === 'end' ? 'border-[#AD3614] bg-amber-50 text-[#AD3614]' : 'border-gray-300 text-gray-600'}`}
          >
            Change end time
          </button>
        </div>

        {changeType && (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              New {changeType} time
            </label>
            <input
              type="datetime-local"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        )}

        {priceDiff !== 0 && (
          <div className={`mb-4 rounded-lg px-3 py-2 text-center text-sm font-semibold ${
            priceDiff > 0 ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
          }`}>
            {priceDiff > 0 ? `+€${priceDiff.toFixed(2)}` : `−€${Math.abs(priceDiff).toFixed(2)} refund`}
          </div>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!changeType || !newValue || saving}
            className="flex-1 rounded-lg bg-[#006B3C] py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
