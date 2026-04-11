'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

async function getAuthToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch { return ''; }
}

interface PoolDashboard {
  poolId: string; name: string; totalSpots: number;
  activeBookings: number; occupancyRate: number; earningsTotal: number;
  upcomingBookings: any[]; spots: any[];
}

export default function PoolDashboardClient() {
  const pathname = usePathname();
  const poolId = pathname.split('/').pop() ?? '';
  const [data, setData] = useState<PoolDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!poolId || poolId === '_') return;
    const load = async () => {
      const token = await getAuthToken();
      const res = await fetch(`${API_URL}/api/v1/pools/${poolId}/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setData(await res.json() as PoolDashboard);
      setLoading(false);
    };
    load();
  }, [poolId]);

  if (loading) return <main className="max-w-3xl mx-auto px-6 py-12"><p className="text-[#4B6354]">Loading...</p></main>;
  if (!data) return <main className="max-w-3xl mx-auto px-6 py-12"><p className="text-[#AD3614]">Pool not found</p></main>;

  return (
    <main className="max-w-3xl mx-auto px-6 py-12 space-y-6">
      <h1 className="text-2xl font-bold text-[#004526]">{data.name}</h1>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { val: data.totalSpots, label: 'Total spots' },
          { val: data.activeBookings, label: 'Active bookings' },
          { val: `${Math.round(data.occupancyRate * 100)}%`, label: 'Occupancy' },
          { val: `\u20AC${data.earningsTotal.toFixed(2)}`, label: 'Earnings' },
        ].map(({ val, label }) => (
          <div key={label} className="bg-[#EBF7F1] rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-[#004526]">{val}</p>
            <p className="text-xs text-[#4B6354]">{label}</p>
          </div>
        ))}
      </div>
      <section>
        <h2 className="text-lg font-semibold text-[#004526] mb-3">Spots in pool</h2>
        {data.spots.length === 0 ? <p className="text-sm text-[#4B6354]">No spots added yet</p> : (
          <div className="space-y-2">
            {data.spots.map((spot: any) => (
              <div key={spot.listingId} className="flex items-center justify-between p-3 bg-white rounded-lg border border-[#C8DDD2]">
                <span className="text-sm text-[#1C2B1A]">{spot.listingId}</span>
                <span className={`text-xs px-2 py-1 rounded-full ${spot.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                  {spot.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <h2 className="text-lg font-semibold text-[#004526] mb-3">Upcoming bookings</h2>
        {data.upcomingBookings.length === 0 ? <p className="text-sm text-[#4B6354]">No upcoming bookings</p> : (
          <div className="space-y-2">
            {data.upcomingBookings.map((b: any) => (
              <div key={b.bookingId} className="flex items-center justify-between p-3 bg-white rounded-lg border border-[#C8DDD2]">
                <div>
                  <p className="text-sm font-medium text-[#1C2B1A]">{b.bookingId}</p>
                  <p className="text-xs text-[#4B6354]">{b.startTime} - {b.endTime}</p>
                </div>
                <span className="text-xs bg-[#EBF7F1] text-[#004526] px-2 py-1 rounded-full">{b.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
