'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { blockApi } from '../../../../lib/apiUrls';

async function getAuthToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch {
    return '';
  }
}

interface FormState {
  startsAt: string;
  endsAt: string;
  bayCount: number;
  companyName: string;
  vatNumber: string;
  showPreferences: boolean;
  preferences: {
    minPoolRating: number | null;
    requireVerifiedSpotManager: boolean;
    noIndividualSpots: boolean;
    maxCounterparties: number | null;
    clusterTogether: boolean;
  };
}

export default function NewBlockRequestPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    startsAt: '',
    endsAt: '',
    bayCount: 2,
    companyName: '',
    vatNumber: '',
    showPreferences: false,
    preferences: {
      minPoolRating: null,
      requireVerifiedSpotManager: false,
      noIndividualSpots: true,
      maxCounterparties: null,
      clusterTogether: false,
    },
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const body: Record<string, unknown> = {
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        bayCount: form.bayCount,
        preferences: form.preferences,
      };
      if (form.companyName) body.companyName = form.companyName;
      if (form.vatNumber) body.vatNumber = form.vatNumber;

      const res = await fetch(blockApi('/api/v1/block-requests'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Submission failed');
        return;
      }

      const { reqId } = await res.json();
      router.push(`/block-requests/${reqId}`);
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }, [form, router]);

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <button onClick={() => router.push('/block-requests')} className="text-[#004526] text-sm mb-4 hover:underline">
          &larr; Back to requests
        </button>
        <h1 className="text-2xl font-bold text-[#004526] mb-6">New Block Request</h1>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
        )}

        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
            <input
              type="text"
              value={form.companyName}
              onChange={e => setForm(prev => ({ ...prev, companyName: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#006B3C]"
              placeholder="Your company name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Belgian VAT Number</label>
            <input
              type="text"
              value={form.vatNumber}
              onChange={e => setForm(prev => ({ ...prev, vatNumber: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#006B3C]"
              placeholder="BE0123456789"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Starts At</label>
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={e => setForm(prev => ({ ...prev, startsAt: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#006B3C]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Ends At</label>
              <input
                type="datetime-local"
                value={form.endsAt}
                onChange={e => setForm(prev => ({ ...prev, endsAt: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-[#006B3C]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Number of Bays</label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setForm(prev => ({ ...prev, bayCount: Math.max(2, prev.bayCount - 1) }))}
                className="w-10 h-10 rounded-lg border border-gray-300 flex items-center justify-center text-lg font-bold hover:bg-gray-50"
              >
                -
              </button>
              <span className="text-xl font-bold text-[#004526] w-12 text-center">{form.bayCount}</span>
              <button
                onClick={() => setForm(prev => ({ ...prev, bayCount: Math.min(500, prev.bayCount + 1) }))}
                className="w-10 h-10 rounded-lg border border-gray-300 flex items-center justify-center text-lg font-bold hover:bg-gray-50"
              >
                +
              </button>
            </div>
          </div>

          <button
            onClick={() => setForm(prev => ({ ...prev, showPreferences: !prev.showPreferences }))}
            className="text-[#004526] text-sm font-medium hover:underline"
          >
            {form.showPreferences ? 'Hide preferences' : 'Show preferences'}
          </button>

          {form.showPreferences && (
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.preferences.requireVerifiedSpotManager}
                  onChange={e => setForm(prev => ({
                    ...prev,
                    preferences: { ...prev.preferences, requireVerifiedSpotManager: e.target.checked },
                  }))}
                  className="accent-[#004526]"
                />
                <span className="text-sm text-gray-700">Only verified Spot Managers</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.preferences.clusterTogether}
                  onChange={e => setForm(prev => ({
                    ...prev,
                    preferences: { ...prev.preferences, clusterTogether: e.target.checked },
                  }))}
                  className="accent-[#004526]"
                />
                <span className="text-sm text-gray-700">Cluster bays together</span>
              </label>
            </div>
          )}

          <button
            disabled={!form.startsAt || !form.endsAt || submitting}
            onClick={handleSubmit}
            className="w-full py-3 bg-[#004526] text-white rounded-lg font-semibold disabled:opacity-50 hover:bg-[#003a1f] transition"
          >
            {submitting ? 'Submitting...' : 'Submit Block Request'}
          </button>
        </div>
      </div>
    </main>
  );
}
