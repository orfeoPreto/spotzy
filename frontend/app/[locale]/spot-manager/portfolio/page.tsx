'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { spotManagerApi, mainApi } from '../../../../lib/apiUrls';
import { BlockReservationsModal } from '../../../../components/spot-manager/BlockReservationsModal';
import { PoolPhotosModal } from '../../../../components/spot-manager/PoolPhotosModal';

interface PortfolioMetrics {
  totalPools: number;
  totalBays: number;
  occupiedBays: number;
  mtdRevenue: number;
  allTimeRevenue: number;
  listings: PortfolioListing[];
  rcInsuranceStatus: string;
  rcInsuranceExpiryDate: string | null;
  spotManagerStatus: string;
}

interface PortfolioListing {
  listingId: string;
  address: string;
  isPool: boolean;
  bayCount?: number;
  activeBays?: number;
  occupiedBays?: number;
  mtdRevenue: number;
  activeBookings: number;
  upcomingBookings: number;
  status: string;
  blockReservationsOptedIn?: boolean;
  riskShareMode?: 'PERCENTAGE' | 'MIN_BAYS_FLOOR' | null;
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

export default function PortfolioPage() {
  const router = useRouter();
  const [data, setData] = useState<PortfolioMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brListing, setBrListing] = useState<PortfolioListing | null>(null);
  const [photosListing, setPhotosListing] = useState<PortfolioListing | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const token = await getAuthToken();
        if (!token) { router.push('/auth/login'); return; }

        // Fetch portfolio and profile in parallel — portfolio returns summary
        // metrics + listing breakdowns, profile carries RC insurance status.
        const [portfolioRes, profileRes] = await Promise.all([
          fetch(spotManagerApi('/api/v1/spot-manager/portfolio'), {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(mainApi('/api/v1/users/me'), {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (portfolioRes.status === 403) {
          router.push('/account/spot-manager/apply');
          return;
        }
        if (!portfolioRes.ok) throw new Error('Failed to load portfolio');

        const portfolio = await portfolioRes.json();
        const profile = profileRes.ok ? await profileRes.json() : {};

        // Backend returns { summary: { totalPools, totalBays, ... }, listings: [] }
        // — flatten into the shape the page expects.
        const summary = portfolio.summary ?? portfolio ?? {};
        setData({
          totalPools: summary.totalPools ?? 0,
          totalBays: summary.totalBays ?? 0,
          occupiedBays: summary.occupiedBays ?? 0,
          mtdRevenue: summary.mtdRevenue ?? 0,
          allTimeRevenue: summary.allTimeRevenue ?? 0,
          listings: Array.isArray(portfolio.listings) ? portfolio.listings : [],
          rcInsuranceStatus: profile.rcInsuranceStatus ?? 'NONE',
          rcInsuranceExpiryDate: profile.rcInsuranceExpiryDate ?? null,
          spotManagerStatus: profile.spotManagerStatus ?? 'NONE',
        });
      } catch (err) {
        setError('Failed to load portfolio');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router, reloadKey]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-[#004526] border-t-transparent rounded-full" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-600">{error || 'No data'}</p>
      </main>
    );
  }

  const expiryDaysAway = data.rcInsuranceExpiryDate
    ? Math.ceil((new Date(data.rcInsuranceExpiryDate).getTime() - Date.now()) / (24 * 3600 * 1000))
    : null;

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* RC Insurance Banner */}
        {data.rcInsuranceStatus === 'EXPIRED' && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
            <p className="text-red-700 font-medium">Your RC insurance has expired. Block reservations are suspended.</p>
            <button onClick={() => router.push('/account/spot-manager/apply?mode=renewal')} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
              Renew now
            </button>
          </div>
        )}
        {data.rcInsuranceStatus === 'APPROVED' && expiryDaysAway !== null && expiryDaysAway <= 30 && (
          <div className={`mb-4 p-4 rounded-lg flex items-center justify-between ${expiryDaysAway <= 7 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
            <p className={expiryDaysAway <= 7 ? 'text-red-700' : 'text-amber-700'}>
              Your RC insurance expires in {expiryDaysAway} days. Renew to keep block reservations enabled.
            </p>
            <button onClick={() => router.push('/account/spot-manager/apply?mode=renewal')} className="px-4 py-2 bg-[#004526] text-white rounded-lg text-sm font-medium hover:bg-[#003a1f]">
              Renew
            </button>
          </div>
        )}
        {data.rcInsuranceStatus === 'PENDING_REVIEW' && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-700">Your RC insurance is under review. Block reservations will be enabled after approval.</p>
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[#004526]">Portfolio</h1>
          <button
            onClick={() => router.push('/listings/pool/new')}
            className="px-4 py-2 bg-[#004526] text-white rounded-lg font-medium hover:bg-[#003a1f] transition"
          >
            Create a Spot Pool
          </button>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Active Pools', value: data.totalPools },
            { label: 'Total Bays', value: data.totalBays },
            { label: 'Bays Occupied', value: data.occupiedBays },
            { label: 'MTD Revenue', value: `\u20AC${data.mtdRevenue.toFixed(2)}` },
          ].map(card => (
            <div key={card.label} className="bg-white rounded-xl shadow-sm p-5">
              <p className="text-sm text-gray-500">{card.label}</p>
              <p className="text-2xl font-bold text-[#004526] mt-1">{card.value}</p>
            </div>
          ))}
        </div>

        {/* Listing grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Pool cards */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Your Listings</h2>
            {data.listings.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm p-8 text-center">
                <p className="text-gray-500 mb-4">No listings yet</p>
                <button
                  onClick={() => router.push('/listings/pool/new')}
                  className="px-6 py-3 bg-[#004526] text-white rounded-lg font-medium"
                >
                  Create your first Spot Pool
                </button>
              </div>
            ) : (
              data.listings.map(listing => (
                <div key={listing.listingId} className="bg-white rounded-xl shadow-sm p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">{listing.address}</h3>
                      <p className="text-sm text-gray-500 mt-1">
                        {listing.isPool
                          ? `Pool - ${listing.activeBays ?? 0} of ${listing.bayCount ?? 0} bays active`
                          : 'Single spot'}
                      </p>
                      {listing.isPool && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {listing.blockReservationsOptedIn ? (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[#e6f7ef] text-[#004526]">
                              Block reservations: {listing.riskShareMode === 'MIN_BAYS_FLOOR' ? 'Min floor' : 'Percentage'}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">
                              Block reservations: off
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${listing.status === 'live' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {listing.status}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-6 text-sm text-gray-600">
                    <span>{listing.occupiedBays ?? listing.activeBookings ?? 0} occupied</span>
                    <span>{listing.upcomingBookings ?? 0} upcoming</span>
                    <span className="font-medium text-[#004526]">{'\u20AC'}{(listing.mtdRevenue ?? 0).toFixed(2)} MTD</span>
                  </div>
                  {listing.isPool && (
                    <div className="mt-3 flex justify-end gap-4">
                      <button
                        onClick={() => setPhotosListing(listing)}
                        className="text-xs text-[#004526] hover:underline font-medium"
                      >
                        Manage photos →
                      </button>
                      <button
                        onClick={() => setBrListing(listing)}
                        className="text-xs text-[#004526] hover:underline font-medium"
                      >
                        Configure block reservations →
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Right column: Block contracts + settlement */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Block Contracts</h2>
            <div className="bg-white rounded-xl shadow-sm p-5 text-center">
              <p className="text-gray-500 text-sm">Block contracts will appear here when available.</p>
            </div>

            <h2 className="text-lg font-semibold text-gray-900">Recent Settlements</h2>
            <div className="bg-white rounded-xl shadow-sm p-5 text-center">
              <p className="text-gray-500 text-sm">No settlements yet.</p>
            </div>
          </div>
        </div>
      </div>

      {brListing && (
        <BlockReservationsModal
          listingId={brListing.listingId}
          listingAddress={brListing.address}
          currentOptedIn={brListing.blockReservationsOptedIn === true}
          currentRiskShareMode={(brListing.riskShareMode ?? null) as 'PERCENTAGE' | 'MIN_BAYS_FLOOR' | null}
          token=""
          onClose={() => setBrListing(null)}
          onSuccess={() => {
            setBrListing(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      {photosListing && (
        <PoolPhotosModal
          listingId={photosListing.listingId}
          listingAddress={photosListing.address}
          onClose={() => setPhotosListing(null)}
          onSuccess={() => {
            setPhotosListing(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </main>
  );
}
