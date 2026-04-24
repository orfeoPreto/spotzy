'use client';

import { useState } from 'react';
import { useTranslation } from '../lib/locales/TranslationProvider';
import { useLocalizeError } from '../lib/errors/useLocalizeError';

const SPOTTER_SECTION_KEYS = ['LOCATION', 'CLEANLINESS', 'VALUE', 'ACCESS'];

interface ReviewData {
  rating?: number;
  avgScore?: number;
  sections?: Array<{ section: string; score: number }>;
  comment?: string;
  description?: string;
  isEditable?: boolean;
  lockReason?: string | null;
}

interface RatingModalProps {
  bookingId: string;
  onClose: () => void;
  onSubmitted: () => void;
  token: string;
  existingReview?: ReviewData | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function RatingModal({ bookingId, onClose, onSubmitted, token, existingReview }: RatingModalProps) {
  const { t } = useTranslation('booking');
  const { t: tCommon } = useTranslation('common');
  const localizeError = useLocalizeError();

  // Build section labels from YAML array
  const SPOTTER_SECTIONS = SPOTTER_SECTION_KEYS.map((key, i) => ({
    key,
    label: t(`rating.spotter_sections.${i}`),
  }));
  const isLocked = existingReview && existingReview.isEditable === false;
  const isUpdate = existingReview && existingReview.isEditable !== false;

  // Initialize ratings from existing review sections if updating
  const initialRatings: Record<string, number> = {};
  if (existingReview?.sections) {
    for (const s of existingReview.sections) {
      initialRatings[s.section] = s.score;
    }
  }

  const [ratings, setRatings] = useState<Record<string, number>>(initialRatings);
  const [submitting, setSubmitting] = useState(false);

  const ratedCount = Object.values(ratings).filter((v) => v > 0).length;
  const canSubmit = ratedCount >= 2;

  const setRating = (section: string, score: number) => {
    if (isLocked) return;
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
        const err = await res.json().catch(() => null) as { message?: string; error?: string; reason?: string; details?: Record<string, unknown> } | null;
        if (err?.error === 'REVIEW_LOCKED') {
          setError(err.reason === 'OTHER_PARTY_REVIEWED'
            ? t('rating.error_other_party')
            : t('rating.error_window_closed'));
        } else {
          setError(localizeError(err) || 'Could not submit review. Please try again.');
        }
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Locked review — read-only display
  if (isLocked) {
    return (
      <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg-spotzy animate-page-enter">
          <h2 className="mb-4 font-head text-lg font-bold text-spotzy-forest">{t('rating.locked_title')}</h2>

          <div className="space-y-4">
            {SPOTTER_SECTIONS.map((section) => (
              <div key={section.key} data-testid="rating-section">
                <p className="mb-1.5 font-head text-sm font-medium text-spotzy-slate">{section.label}</p>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span
                      key={star}
                      data-testid="star"
                      className={`text-2xl leading-none ${
                        (initialRatings[section.key] ?? 0) >= star
                          ? 'text-spotzy-park'
                          : 'text-spotzy-concrete'
                      }`}
                    >
                      ★
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div data-testid="lock-notice" className="mt-4 rounded-lg bg-spotzy-brick-light border border-spotzy-brick-border px-3 py-2 text-sm text-spotzy-brick">
            {existingReview?.lockReason === 'OTHER_PARTY_REVIEWED'
              ? t('rating.locked_both')
              : t('rating.locked_window')}
          </div>

          <div className="mt-6">
            <button type="button" onClick={onClose}
              className="w-full rounded-lg border border-spotzy-forest py-2 font-head text-sm font-semibold text-spotzy-forest transition-all hover:bg-spotzy-sage active:scale-[0.98]">
              {tCommon('buttons.close')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg-spotzy animate-page-enter">
        <h2 className="mb-4 font-head text-lg font-bold text-spotzy-forest">
          {isUpdate ? t('rating.update_title') : t('rating.create_title')}
        </h2>

        <div className="space-y-4">
          {SPOTTER_SECTIONS.map((section) => (
            <div key={section.key} data-testid="rating-section">
              <p className="mb-1.5 font-head text-sm font-medium text-spotzy-slate">{section.label}</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    data-testid="star"
                    onClick={() => setRating(section.key, star)}
                    className={`text-2xl leading-none transition-all active:scale-125 ${
                      (ratings[section.key] ?? 0) >= star
                        ? 'text-spotzy-park drop-shadow-sm'
                        : 'text-spotzy-concrete'
                    }`}
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-lg border border-spotzy-forest py-2 font-head text-sm font-semibold text-spotzy-forest transition-all hover:bg-spotzy-sage active:scale-[0.98]">
            {tCommon('buttons.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="flex-1 rounded-lg bg-spotzy-forest py-2 font-head text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          >
            {isUpdate ? t('rating.update_button') : t('rating.submit_button')}
          </button>
        </div>
      </div>
    </div>
  );
}
