'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AdminGuard } from '../../../components/AdminGuard';
import { spotManagerApi } from '../../../lib/apiUrls';

interface RCReviewItem {
  submissionId: string;
  userId: string;
  insurer: string;
  policyNumber: string;
  expiryDate: string;
  createdAt: string;
  slaHoursElapsed: number;
  slaWarning: boolean;
  lockedBy?: string;
  lockedByName?: string;
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

function RCReviewList() {
  const router = useRouter();
  const [items, setItems] = useState<RCReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const token = await getAuthToken();
      const res = await fetch(spotManagerApi('/api/v1/admin/rc-review'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) { router.push('/'); return; }
      if (res.ok) setItems((await res.json()).submissions ?? []);
      setLoading(false);
    }
    load();
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-8 h-8 border-4 border-[#004526] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#004526] mb-6">RC Insurance Review Queue</h1>

      {items.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center">
          <p className="text-gray-500">No submissions pending review.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div
              key={item.submissionId}
              className={`bg-white rounded-xl shadow-sm p-5 flex items-center justify-between cursor-pointer hover:shadow-md transition ${item.slaWarning ? 'border-l-4 border-red-500' : ''}`}
              onClick={() => router.push(`/backoffice/rc-review/${item.submissionId}?userId=${item.userId}`)}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900">{item.insurer}</p>
                  {item.slaWarning && (
                    <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded-full">Urgent</span>
                  )}
                  {item.lockedBy && (
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                      Being reviewed{item.lockedByName ? ` by ${item.lockedByName}` : ''}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Policy: {item.policyNumber} | Expires: {item.expiryDate} | Submitted: {new Date(item.createdAt).toLocaleDateString()}
                </p>
                <p className="text-sm text-gray-400 mt-1">
                  SLA: {item.slaHoursElapsed}h elapsed of 72h
                </p>
              </div>
              <button className="px-4 py-2 bg-[#004526] text-white rounded-lg text-sm font-medium hover:bg-[#003a1f]">
                Review
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BackofficeRCReviewPage() {
  return <AdminGuard><RCReviewList /></AdminGuard>;
}
