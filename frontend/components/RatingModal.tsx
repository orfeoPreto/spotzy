'use client';

import { useState } from 'react';

const SPOTTER_SECTIONS = [
  { key: 'LOCATION', label: 'Location accuracy' },
  { key: 'CLEANLINESS', label: 'Cleanliness' },
  { key: 'VALUE', label: 'Value for money' },
  { key: 'ACCESS', label: 'Ease of access' },
];

interface RatingModalProps {
  bookingId: string;
  onClose: () => void;
  onSubmitted: () => void;
  token: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function RatingModal({ bookingId, onClose, onSubmitted, token }: RatingModalProps) {
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  const ratedCount = Object.values(ratings).filter((v) => v > 0).length;
  const canSubmit = ratedCount >= 2;

  const setRating = (section: string, score: number) => {
    setRatings((prev) => ({ ...prev, [section]: score }));
  };

  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const sectionsArray = Object.entries(ratings)
        .filter(([, score]) => score > 0)
        .map(([section, score]) => ({ section, score }));
      const res = await fetch(`${API_URL}/api/v1/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookingId, sections: sectionsArray }),
      });
      if (res.ok) {
        onSubmitted();
        onClose();
      } else {
        const err = await res.json().catch(() => null) as { message?: string; error?: string } | null;
        setError(err?.message ?? err?.error ?? 'Could not submit review. Please try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Leave a review</h2>

        <div className="space-y-4">
          {SPOTTER_SECTIONS.map((section) => (
            <div key={section.key} data-testid="rating-section">
              <p className="mb-1.5 text-sm font-medium text-gray-700">{section.label}</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    data-testid="star"
                    onClick={() => setRating(section.key, star)}
                    className={`h-7 w-7 text-xl transition-colors ${
                      (ratings[section.key] ?? 0) >= star ? 'text-[#AD3614]' : 'text-gray-300'
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="flex-1 rounded-lg bg-[#006B3C] py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Submit rating
          </button>
        </div>
      </div>
    </div>
  );
}
