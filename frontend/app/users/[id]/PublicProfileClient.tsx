'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../../../hooks/useAuth';
import { spotTypeDisplay } from '../../../lib/spotTypeDisplay';
import { formatDateOnly } from '../../../lib/formatDate';
import { UserAvatar } from '../../../components/UserAvatar';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
const MEDIA_URL = process.env.NEXT_PUBLIC_MEDIA_URL ?? '';

interface PublicListing {
  listingId: string;
  address: string;
  spotType: string;
  pricePerHour: number;
  rating?: number;
  photos: string[];
}

interface PublicReview {
  reviewId: string;
  rating: number;
  comment: string;
  createdAt: string;
}

interface PublicProfile {
  userId: string;
  name: string;
  displayName?: string | null;
  fullName?: string | null;
  profilePhotoUrl?: string | null;
  photoUrl?: string | null;
  bio?: string | null;
  memberSince: string;
  listings: PublicListing[];
  reviews: PublicReview[];
  reviewCount: number;
  averageRating: number | null;
  completedBookings: number;
  responseRate: number | null;
}

function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <svg
          key={i}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill={i < Math.round(rating) ? '#AD3614' : 'none'}
          stroke="#AD3614"
          strokeWidth={1.5}
          className="h-4 w-4"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
        </svg>
      ))}
    </span>
  );
}

function RatingBar({ rating, max = 5 }: { rating: number; max?: number }) {
  const pct = Math.round((rating / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-4 text-xs text-gray-500">{rating}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
        <div className="h-full rounded-full bg-[#006B3C]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function PublicProfilePage() {
  const _pathname = usePathname();
  const userId = _pathname.split('/').filter(Boolean)[1] ?? '';
  const { user } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!userId || !user) return;
    fetch(`${API_URL}/api/v1/users/${userId}/public`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => { if (data) setProfile(data); })
      .catch(() => setNotFound(true));
  }, [userId, user?.token]);

  if (notFound) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8 text-center">
        <h1 className="text-xl font-bold text-gray-700">Profile not found</h1>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8 text-center">
        <p className="text-gray-400">Loading…</p>
      </main>
    );
  }

  const { name, displayName, fullName, profilePhotoUrl, photoUrl, bio, memberSince, listings, reviews, reviewCount, averageRating, completedBookings, responseRate } = profile;
  const joinYear = memberSince ? new Date(memberSince).getFullYear() : null;
  const heading = displayName ?? name;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <UserAvatar
          user={{ photoUrl: profilePhotoUrl ?? photoUrl, pseudo: null, firstName: displayName ?? name }}
          size={80}
        />
        <div>
          <h1 className="text-2xl font-bold text-[#004526]" style={{ fontFamily: 'DM Sans, sans-serif' }}>
            {heading}
          </h1>
          {fullName && fullName !== heading && (
            <p className="text-sm text-gray-500">{fullName}</p>
          )}
          {joinYear && <p className="text-sm text-gray-400">Member since {joinYear}</p>}
          <div className="flex gap-3 mt-1">
            {completedBookings > 0 && (
              <span className="text-xs text-gray-500">{completedBookings} booking{completedBookings !== 1 ? 's' : ''} completed</span>
            )}
            {responseRate !== null && (
              <span data-testid="response-rate" className="text-xs text-gray-500">{responseRate}% response rate</span>
            )}
          </div>
          {averageRating !== null && (
            <div className="mt-1 flex items-center gap-2">
              <StarRating rating={averageRating} />
              <span className="text-sm font-bold text-[#004526]">{averageRating.toFixed(1)}</span>
              <span className="text-xs text-gray-400">({reviewCount} review{reviewCount !== 1 ? 's' : ''})</span>
            </div>
          )}
        </div>
      </div>

      {/* Bio */}
      {bio && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-700">{bio}</p>
        </div>
      )}

      {/* Active listings (host only) */}
      {listings.length > 0 && (
        <section data-testid="host-listings-section" className="mb-6">
          <h2 className="mb-3 text-lg font-bold text-[#004526]">Active spots</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {listings.map((l) => (
              <a
                key={l.listingId}
                href={`/listing/${l.listingId}`}
                className="flex gap-3 rounded-xl border border-gray-200 bg-white p-3 hover:shadow-sm"
              >
                {l.photos[0] && (
                  <img
                    src={(() => {
                      const photo = typeof l.photos[0] === 'string' ? l.photos[0] : (l.photos[0] as unknown as { url?: string; key?: string })?.url ?? '';
                      return photo.startsWith('http') ? photo : `${MEDIA_URL}${photo}`;
                    })()}
                    alt={l.address}
                    className="h-14 w-14 flex-shrink-0 rounded-lg border border-[#004526]/20 object-cover"
                  />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{l.address}</p>
                  <p className="text-xs text-gray-500">{spotTypeDisplay(l.spotType)}</p>
                  <p className="text-sm font-bold text-[#004526]">from €{(l.pricePerHour ?? 0).toFixed(2)}/hr</p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Reviews */}
      {reviews.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-[#004526]">Reviews</h2>
          {averageRating !== null && reviewCount > 0 && (
            <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-3">
                <span className="text-3xl font-bold text-[#004526]">{averageRating.toFixed(1)}</span>
                <div>
                  <StarRating rating={averageRating} />
                  <p className="text-xs text-gray-400">{reviewCount} review{reviewCount !== 1 ? 's' : ''}</p>
                </div>
              </div>
              {[5, 4, 3, 2, 1].map((r) => (
                <RatingBar key={r} rating={r} />
              ))}
            </div>
          )}
          <div className="space-y-3">
            {reviews.map((r) => (
              <div key={r.reviewId} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-1 flex items-center gap-2">
                  <StarRating rating={r.rating} />
                  <span className="text-xs text-gray-400">
                    {formatDateOnly(r.createdAt)}
                  </span>
                </div>
                {r.comment && <p className="text-sm text-gray-700">{r.comment}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {reviews.length === 0 && listings.length === 0 && (
        <p className="text-center text-sm text-gray-400">No activity yet.</p>
      )}
    </main>
  );
}
