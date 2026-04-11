'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

async function getAuthToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch { return ''; }
}

export default function NewPoolPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [spotType, setSpotType] = useState('');
  const [pricePerHour, setPricePerHour] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !address.trim()) { setError('Name and address are required'); return; }
    setLoading(true);
    setError('');
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_URL}/api/v1/pools`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, address, spotType: spotType || undefined, pricePerHour: pricePerHour ? parseFloat(pricePerHour) : undefined }),
      });
      if (res.ok) {
        const data = await res.json() as { poolId: string };
        router.push(`/pools/${data.poolId}`);
      } else {
        const body = await res.json();
        setError(body.error ?? 'Failed to create pool');
      }
    } finally { setLoading(false); }
  };

  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-[#004526] mb-6">Create Spot Pool</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="poolName" className="block text-sm font-medium text-[#1C2B1A] mb-1">Pool name</label>
          <input id="poolName" type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Residence Bruxelles - 12 spots"
            className="w-full rounded-lg border border-[#C8DDD2] px-4 py-2.5 text-sm focus:border-[#006B3C] focus:outline-none" />
        </div>
        <div>
          <label htmlFor="poolAddress" className="block text-sm font-medium text-[#1C2B1A] mb-1">Address</label>
          <input id="poolAddress" type="text" value={address} onChange={e => setAddress(e.target.value)}
            placeholder="Rue de la Loi 42, 1000 Bruxelles"
            className="w-full rounded-lg border border-[#C8DDD2] px-4 py-2.5 text-sm focus:border-[#006B3C] focus:outline-none" />
        </div>
        <div>
          <label htmlFor="poolSpotType" className="block text-sm font-medium text-[#1C2B1A] mb-1">Spot type</label>
          <select id="poolSpotType" value={spotType} onChange={e => setSpotType(e.target.value)}
            className="w-full rounded-lg border border-[#C8DDD2] px-4 py-2.5 text-sm focus:border-[#006B3C] focus:outline-none">
            <option value="">Select type</option>
            <option value="COVERED_GARAGE">Covered garage</option>
            <option value="CARPORT">Carport</option>
            <option value="DRIVEWAY">Driveway</option>
            <option value="OPEN_SPACE">Open space</option>
          </select>
        </div>
        <div>
          <label htmlFor="poolPrice" className="block text-sm font-medium text-[#1C2B1A] mb-1">Price per hour (EUR)</label>
          <input id="poolPrice" type="number" step="0.50" min="0" value={pricePerHour} onChange={e => setPricePerHour(e.target.value)}
            className="w-full rounded-lg border border-[#C8DDD2] px-4 py-2.5 text-sm focus:border-[#006B3C] focus:outline-none" />
        </div>
        {error && <p className="text-sm text-[#AD3614]">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white hover:bg-[#004526] disabled:opacity-40">
          {loading ? 'Creating...' : 'Create pool'}
        </button>
      </form>
    </main>
  );
}
