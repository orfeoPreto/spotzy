'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { blockApi } from '../../../lib/apiUrls';

interface BlockRequest {
  reqId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  bayCount: number;
  createdAt: string;
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

const STATUS_COLORS: Record<string, string> = {
  PENDING_MATCH: 'bg-amber-100 text-amber-700',
  PLANS_PROPOSED: 'bg-blue-100 text-blue-700',
  CONFIRMED: 'bg-green-100 text-green-700',
  AUTHORISED: 'bg-emerald-100 text-emerald-700',
  SETTLED: 'bg-gray-100 text-gray-600',
  CANCELLED: 'bg-red-100 text-red-700',
};

export default function BlockRequestsListPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<BlockRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const token = await getAuthToken();
      if (!token) { router.push('/auth/login'); return; }
      const res = await fetch(blockApi('/api/v1/block-requests?ownerUserId=me'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        // Backend returns { items, cursor } — be defensive about shape
        const list = Array.isArray(data) ? data
                   : Array.isArray(data.items) ? data.items
                   : Array.isArray(data.requests) ? data.requests
                   : [];
        setRequests(list);
      }
      setLoading(false);
    }
    load();
  }, [router]);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-[#004526] border-t-transparent rounded-full" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-[#004526]">Block Requests</h1>
          <button
            onClick={() => router.push('/block-requests/new')}
            className="px-4 py-2 bg-[#004526] text-white rounded-lg font-medium hover:bg-[#003a1f] transition"
          >
            New Block Request
          </button>
        </div>

        {requests.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <p className="text-gray-500 mb-4">No block requests yet.</p>
            <button
              onClick={() => router.push('/block-requests/new')}
              className="px-6 py-3 bg-[#004526] text-white rounded-lg font-medium"
            >
              Submit your first block request
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map(req => (
              <div
                key={req.reqId}
                className="bg-white rounded-xl shadow-sm p-5 cursor-pointer hover:shadow-md transition"
                onClick={() => router.push(`/block-requests/${req.reqId}`)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{req.bayCount} bays</p>
                    <p className="text-sm text-gray-500 mt-1">
                      {new Date(req.startsAt).toLocaleDateString()} &mdash; {new Date(req.endsAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`px-3 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[req.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {req.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
