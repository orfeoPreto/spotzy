'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

import { blockApi } from '../../../../lib/apiUrls';

interface ClaimData {
  poolName: string;
  address: string;
  addressLat: number;
  addressLng: number;
  bayLabel: string;
  accessInstructions: string;
  startsAt: string;
  endsAt: string;
  companyName: string;
  guestName: string;
}

export default function MagicLinkClaimPage() {
  const params = useParams();
  const token = params.token as string;
  const [data, setData] = useState<ClaimData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    async function claim() {
      try {
        const res = await fetch(blockApi(`/api/v1/public/claim/${token}`));
        if (res.status === 410) {
          setError('This link has expired or been reassigned. Please contact the person who invited you.');
          return;
        }
        if (res.status === 401) {
          setError('This link is invalid.');
          return;
        }
        if (!res.ok) {
          setError('Something went wrong. Please try again.');
          return;
        }
        const body = await res.json();
        setData(body);
        // Check if returning visit
        const visitKey = `claim_${token}`;
        if (localStorage.getItem(visitKey)) {
          setReturning(true);
        } else {
          localStorage.setItem(visitKey, 'true');
        }
      } catch {
        setError('Network error. Please check your connection.');
      } finally {
        setLoading(false);
      }
    }
    claim();
  }, [token]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f0faf4] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-[#004526] border-t-transparent rounded-full" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center bg-white rounded-xl shadow-sm p-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
            </svg>
          </div>
          <p className="text-gray-700">{error}</p>
        </div>
      </main>
    );
  }

  if (!data) return null;

  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);
  const hoursUntilStart = Math.max(0, Math.round((startsAt.getTime() - Date.now()) / 3600000));

  return (
    <main className="min-h-screen bg-[#f0faf4] py-8 px-4">
      <div className="max-w-md mx-auto">
        {returning && (
          <div className="mb-4 p-3 bg-[#004526] text-white rounded-lg text-center text-sm">
            Welcome back, {data.guestName}!
          </div>
        )}

        {/* Hero */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-4">
          <div className="bg-[#004526] p-6 text-white text-center">
            <h1 className="text-xl font-bold">Your Parking</h1>
            <p className="text-sm opacity-80 mt-1">{data.poolName}</p>
          </div>
          <div className="p-5">
            <p className="text-sm text-gray-500">{data.address}</p>
          </div>
        </div>

        {/* Bay info */}
        <div className="bg-[#e6f7ef] rounded-xl p-5 mb-4">
          <p className="text-sm text-gray-600">Your assigned bay</p>
          <p className="text-2xl font-bold text-[#004526]">{data.bayLabel}</p>
          <div className="mt-3 text-sm text-gray-600">
            <p>{startsAt.toLocaleString()} &mdash; {endsAt.toLocaleString()}</p>
            {hoursUntilStart > 0 && (
              <p className="text-[#004526] font-medium mt-1">{hoursUntilStart} hours from now</p>
            )}
          </div>
        </div>

        {/* Access instructions */}
        {data.accessInstructions && (
          <div className="bg-white rounded-xl shadow-sm p-5 mb-4">
            <h2 className="font-semibold text-gray-900 mb-2">Access Instructions</h2>
            <p className="text-sm text-gray-600 whitespace-pre-line">{data.accessInstructions}</p>
          </div>
        )}

        {/* Notice */}
        <div className="bg-white rounded-xl shadow-sm p-5 mb-4 text-sm text-gray-600">
          <p>This parking was booked for you by <strong>{data.companyName}</strong>. You don't need to pay anything.</p>
        </div>

        {/* Action shelf */}
        <div className="flex gap-3">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${data.addressLat},${data.addressLng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-3 bg-[#004526] text-white rounded-lg font-semibold text-center hover:bg-[#003a1f]"
          >
            Open in Maps
          </a>
          <button className="flex-1 py-3 border border-[#004526] text-[#004526] rounded-lg font-semibold hover:bg-[#f0faf4]">
            Contact Spot Manager
          </button>
        </div>
      </div>
    </main>
  );
}
