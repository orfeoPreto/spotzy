'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

import { blockApi } from '../../../lib/apiUrls';

async function getAuthToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch {
    return '';
  }
}

interface BlockDetail {
  reqId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  bayCount: number;
  proposedPlans?: PlanSummary[];
  proposedPlansComputedAt?: string | null;
  acceptedPlanIndex?: number;
  allocations?: BlockAllocation[];
  settlementBreakdown?: any;
}

const PLAN_FRESHNESS_MINUTES = 30;

interface PlanSummary {
  worstCaseEur: number;
  bestCaseEur: number;
  projectedCaseEur: number;
  allocations: { poolListingId: string; poolName: string; contributedBayCount: number; pricePerBayEur: number }[];
}

interface BlockAllocation {
  allocId: string;
  poolListingId: string;
  contributedBayCount: number;
  allocatedBayCount: number;
}

export default function BlockRequestDetailPage() {
  const router = useRouter();
  const params = useParams();
  const reqId = params.reqId as string;
  const [data, setData] = useState<BlockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acceptingPlan, setAcceptingPlan] = useState<number | null>(null);
  const [refreshingPlans, setRefreshingPlans] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const token = await getAuthToken();
      const res = await fetch(blockApi(`/api/v1/block-requests/${reqId}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setData(await res.json());
      setLoading(false);
    }
    load();

    // Poll every 30s for transitional states
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [reqId]);

  const refreshPlans = async () => {
    setRefreshingPlans(true);
    setError(null);
    try {
      const token = await getAuthToken();
      // PATCH with an empty body — the update Lambda resets proposedPlans and
      // publishes block.request.updated, which triggers the match Lambda.
      const res = await fetch(blockApi(`/api/v1/block-requests/${reqId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error || 'Failed to refresh plans');
        return;
      }
      // Poll for a few seconds until the match Lambda produces new plans
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const poll = await fetch(blockApi(`/api/v1/block-requests/${reqId}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (poll.ok) {
          const d = await poll.json();
          if (d.status === 'PLANS_PROPOSED' && d.proposedPlans?.length >= 0) {
            setData(d);
            return;
          }
        }
      }
      setError('Plan refresh is taking longer than expected — please retry in a moment.');
    } catch {
      setError('Network error');
    } finally {
      setRefreshingPlans(false);
    }
  };

  const handleAcceptPlan = async (planIndex: number) => {
    setAcceptingPlan(planIndex);
    setError(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(blockApi(`/api/v1/block-requests/${reqId}/accept`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planIndex }),
      });
      if (!res.ok) {
        const body = await res.json();
        if (body.error === 'PLANS_EXPIRED') {
          setError('Plans expired — refreshing automatically...');
          setAcceptingPlan(null);
          await refreshPlans();
          return;
        }
        setError(body.error || 'Failed to accept plan');
        return;
      }
      const updated = await res.json();
      setData(updated);
    } catch {
      setError('Network error');
    } finally {
      setAcceptingPlan(null);
    }
  };

  const planAgeMinutes = data?.proposedPlansComputedAt
    ? Math.floor((Date.now() - new Date(data.proposedPlansComputedAt).getTime()) / 60_000)
    : null;
  const planIsStale = planAgeMinutes !== null && planAgeMinutes >= PLAN_FRESHNESS_MINUTES;

  if (loading || !data) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-[#004526] border-t-transparent rounded-full" />
      </main>
    );
  }

  const STATUS_LABELS: Record<string, { label: string; color: string }> = {
    PENDING_MATCH: { label: 'Finding plans...', color: 'text-amber-600' },
    PLANS_PROPOSED: { label: 'Plans ready', color: 'text-blue-600' },
    CONFIRMED: { label: 'Confirmed', color: 'text-green-600' },
    AUTHORISED: { label: 'Authorised', color: 'text-emerald-600' },
    SETTLED: { label: 'Settled', color: 'text-gray-600' },
    CANCELLED: { label: 'Cancelled', color: 'text-red-600' },
  };

  const statusInfo = STATUS_LABELS[data.status] ?? { label: data.status, color: 'text-gray-600' };

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <button onClick={() => router.push('/block-requests')} className="text-[#004526] text-sm mb-4 hover:underline">
          &larr; Back to requests
        </button>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-[#004526]">Block Request</h1>
            <span className={`text-sm font-semibold ${statusInfo.color}`}>{statusInfo.label}</span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><span className="text-gray-500">Bays:</span> <span className="font-medium">{data.bayCount}</span></div>
            <div><span className="text-gray-500">Start:</span> <span className="font-medium">{new Date(data.startsAt).toLocaleString()}</span></div>
            <div><span className="text-gray-500">End:</span> <span className="font-medium">{new Date(data.endsAt).toLocaleString()}</span></div>
          </div>
        </div>

        {/* Plans Review (UC-BS02) */}
        {data.status === 'PLANS_PROPOSED' && data.proposedPlans && (
          <div className="space-y-4 mb-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Proposed Plans</h2>
              {planAgeMinutes !== null && (
                <div className="text-xs text-gray-500">
                  Computed {planAgeMinutes === 0 ? 'just now' : `${planAgeMinutes} min ago`}
                </div>
              )}
            </div>

            {planIsStale && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
                <p className="text-sm text-amber-800">
                  These plans are more than {PLAN_FRESHNESS_MINUTES} minutes old and must be refreshed before you can accept.
                </p>
                <button
                  onClick={refreshPlans}
                  disabled={refreshingPlans}
                  className="ml-3 px-3 py-1.5 bg-[#004526] text-white rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap"
                >
                  {refreshingPlans ? 'Refreshing...' : 'Refresh plans'}
                </button>
              </div>
            )}

            {!planIsStale && planAgeMinutes !== null && planAgeMinutes >= PLAN_FRESHNESS_MINUTES - 5 && (
              <div className="p-2 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
                <p className="text-xs text-blue-700">
                  Plans will expire in {PLAN_FRESHNESS_MINUTES - planAgeMinutes} min. Accept soon or refresh.
                </p>
                <button
                  onClick={refreshPlans}
                  disabled={refreshingPlans}
                  className="text-xs text-[#004526] hover:underline font-medium"
                >
                  {refreshingPlans ? 'Refreshing...' : 'Refresh now'}
                </button>
              </div>
            )}

            {data.proposedPlans.map((plan, idx) => (
              <div key={idx} className="bg-white rounded-xl shadow-sm p-5 border-2 border-transparent hover:border-[#004526] transition">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">Plan {idx + 1}</h3>
                  <div className="text-right text-sm">
                    <p className="text-gray-500">Worst case: <span className="font-medium">{'\u20AC'}{plan.worstCaseEur.toFixed(2)}</span></p>
                    <p className="text-[#004526] font-medium">Projected: {'\u20AC'}{plan.projectedCaseEur.toFixed(2)}</p>
                  </div>
                </div>
                <div className="space-y-2 mb-4">
                  {plan.allocations.map((alloc, i) => (
                    <div key={i} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
                      <span>{alloc.poolName}</span>
                      <span>{alloc.contributedBayCount} bays @ {'\u20AC'}{alloc.pricePerBayEur}/bay</span>
                    </div>
                  ))}
                </div>
                <button
                  disabled={acceptingPlan !== null || refreshingPlans || planIsStale}
                  onClick={() => handleAcceptPlan(idx)}
                  className="w-full py-2 bg-[#004526] text-white rounded-lg font-semibold disabled:opacity-50 hover:bg-[#003a1f]"
                >
                  {acceptingPlan === idx ? 'Accepting...' : planIsStale ? 'Refresh plans to accept' : 'Accept this plan'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Confirmation & Auth Wait (UC-BS03) */}
        {['CONFIRMED', 'AUTHORISED'].includes(data.status) && (
          <div className="space-y-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Status Timeline</h2>
              <div className="flex items-center gap-2 text-sm">
                {['Confirmed', 'Auth pending', 'Authorised', 'Window active', 'Settled'].map((step, i) => {
                  const active = (data.status === 'CONFIRMED' && i <= 0) || (data.status === 'AUTHORISED' && i <= 2);
                  return (
                    <div key={step} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${active ? 'bg-[#004526]' : 'bg-gray-300'}`} />
                      <span className={active ? 'text-[#004526] font-medium' : 'text-gray-400'}>{step}</span>
                      {i < 4 && <div className={`w-8 h-0.5 ${active ? 'bg-[#004526]' : 'bg-gray-300'}`} />}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => router.push(`/block-requests/${reqId}/guests`)} className="flex-1 py-3 bg-[#004526] text-white rounded-lg font-semibold hover:bg-[#003a1f]">
                Manage Guests
              </button>
              <button onClick={() => router.push(`/block-requests/${reqId}/settlement`)} className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50">
                Settlement
              </button>
            </div>
          </div>
        )}

        {/* Settled (UC-BS08) */}
        {data.status === 'SETTLED' && data.settlementBreakdown && (
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Settlement Complete</h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-3 bg-[#f0faf4] rounded-lg">
                <p className="text-sm text-gray-500">Captured</p>
                <p className="text-xl font-bold text-[#004526]">{'\u20AC'}{data.settlementBreakdown.capturedEur?.toFixed(2)}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">Total</p>
                <p className="text-xl font-bold text-gray-900">{'\u20AC'}{data.settlementBreakdown.totalEur?.toFixed(2)}</p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500">Refunded</p>
                <p className="text-xl font-bold text-gray-600">{'\u20AC'}{data.settlementBreakdown.refundedEur?.toFixed(2)}</p>
              </div>
            </div>
            <button
              onClick={() => router.push(`/block-requests/${reqId}/settlement`)}
              className="w-full mt-4 py-2 bg-[#004526] text-white rounded-lg font-medium hover:bg-[#003a1f]"
            >
              View full settlement
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
