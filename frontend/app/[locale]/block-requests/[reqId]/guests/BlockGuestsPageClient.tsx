'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';

import { blockApi } from '../../../../../lib/apiUrls';

async function getAuthToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch {
    return '';
  }
}

interface Guest {
  bookingId: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  bayLabel: string;
  poolName: string;
  emailStatus: string;
  allocationStatus: string;
}

export default function BlockGuestsPage() {
  const router = useRouter();
  const params = useParams();
  const reqId = params.reqId as string;
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'list' | 'add' | 'csv'>('list');
  const [newGuest, setNewGuest] = useState({ name: '', email: '', phone: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadGuests();
  }, [reqId]);

  async function loadGuests() {
    const token = await getAuthToken();
    const res = await fetch(blockApi(`/api/v1/block-requests/${reqId}`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setGuests(data.bookings ?? []);
    }
    setLoading(false);
  }

  const handleAddGuest = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(blockApi(`/api/v1/block-requests/${reqId}/guests`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ guests: [newGuest] }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error || 'Failed to add guest');
        return;
      }
      setNewGuest({ name: '', email: '', phone: '' });
      setTab('list');
      await loadGuests();
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCsvUpload = async (file: File) => {
    setSubmitting(true);
    setError(null);
    try {
      const text = await file.text();
      const lines = text.trim().split('\n').slice(1); // skip header
      const guestRows = lines.map(line => {
        const [name, email, phone] = line.split(',').map(s => s.trim());
        return { name, email, phone };
      });

      const token = await getAuthToken();
      const res = await fetch(blockApi(`/api/v1/block-requests/${reqId}/guests`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ guests: guestRows }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(body.error || 'CSV upload failed');
        return;
      }
      setTab('list');
      await loadGuests();
    } catch {
      setError('Failed to parse CSV');
    } finally {
      setSubmitting(false);
    }
  };

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
        <button onClick={() => router.push(`/block-requests/${reqId}`)} className="text-[#004526] text-sm mb-4 hover:underline">
          &larr; Back to request
        </button>
        <h1 className="text-2xl font-bold text-[#004526] mb-6">Guest Management</h1>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {(['list', 'add', 'csv'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === t ? 'bg-[#004526] text-white' : 'bg-white text-gray-700 border'}`}
            >
              {t === 'list' ? 'Guest List' : t === 'add' ? 'Add One' : 'CSV Upload'}
            </button>
          ))}
        </div>

        {tab === 'list' && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            {guests.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No guests assigned yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Bay</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Email Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {guests.map(g => (
                    <tr key={g.bookingId}>
                      <td className="px-4 py-3">{g.guestName}</td>
                      <td className="px-4 py-3 text-gray-500">{g.guestEmail}</td>
                      <td className="px-4 py-3">{g.bayLabel}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${g.emailStatus === 'SENT' ? 'bg-green-100 text-green-700' : g.emailStatus === 'BOUNCED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {g.emailStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button className="text-[#004526] text-sm hover:underline">Reassign</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'add' && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Guest Name</label>
              <input type="text" value={newGuest.name} onChange={e => setNewGuest(prev => ({ ...prev, name: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={newGuest.email} onChange={e => setNewGuest(prev => ({ ...prev, email: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input type="tel" value={newGuest.phone} onChange={e => setNewGuest(prev => ({ ...prev, phone: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
            </div>
            <button disabled={!newGuest.name || !newGuest.email || submitting} onClick={handleAddGuest} className="w-full py-3 bg-[#004526] text-white rounded-lg font-semibold disabled:opacity-50">
              {submitting ? 'Adding...' : 'Add Guest'}
            </button>
          </div>
        )}

        {tab === 'csv' && (
          <div className="bg-white rounded-xl shadow-sm p-6 text-center">
            <p className="text-gray-600 mb-4">Upload a CSV with columns: name, email, phone</p>
            <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={e => { if (e.target.files?.[0]) handleCsvUpload(e.target.files[0]); }} />
            <button onClick={() => csvInputRef.current?.click()} disabled={submitting} className="px-6 py-3 bg-[#004526] text-white rounded-lg font-semibold disabled:opacity-50">
              {submitting ? 'Uploading...' : 'Choose CSV File'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
