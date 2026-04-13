'use client';

import { useState } from 'react';
import { useLocalizedRouter } from '../../../../lib/locales/useLocalizedRouter';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

async function getAuthToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch { return ''; }
}

export default function NewCorporatePage() {
  const router = useLocalizedRouter();
  const [companyName, setCompanyName] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !vatNumber.trim() || !billingAddress.trim()) {
      setError('All fields are required');
      return;
    }
    if (!/^BE\d{10}$/.test(vatNumber)) {
      setError('Invalid VAT number (format: BE + 10 digits)');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_URL}/api/v1/corporate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, vatNumber, billingAddress }),
      });
      if (res.ok) {
        const data = await res.json() as { corpId: string };
        router.push(`/corporate/${data.corpId}`);
      } else {
        const body = await res.json();
        setError(body.error ?? 'Failed to create corporate account');
      }
    } finally { setLoading(false); }
  };

  return (
    <main className="max-w-xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-[#004526] mb-6">Create Corporate Account</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="companyName" className="block text-sm font-medium text-[#1C2B1A] mb-1">Company name</label>
          <input id="companyName" type="text" value={companyName} onChange={e => setCompanyName(e.target.value)}
            className="w-full rounded-lg border border-[#C8DDD2] px-4 py-2.5 text-sm focus:border-[#006B3C] focus:outline-none" />
        </div>
        <div>
          <label htmlFor="vatNumber" className="block text-sm font-medium text-[#1C2B1A] mb-1">VAT number</label>
          <input id="vatNumber" type="text" value={vatNumber} onChange={e => setVatNumber(e.target.value)}
            placeholder="BE0123456789"
            className="w-full rounded-lg border border-[#C8DDD2] px-4 py-2.5 text-sm focus:border-[#006B3C] focus:outline-none" />
        </div>
        <div>
          <label htmlFor="billingAddress" className="block text-sm font-medium text-[#1C2B1A] mb-1">Billing address</label>
          <input id="billingAddress" type="text" value={billingAddress} onChange={e => setBillingAddress(e.target.value)}
            className="w-full rounded-lg border border-[#C8DDD2] px-4 py-2.5 text-sm focus:border-[#006B3C] focus:outline-none" />
        </div>
        {error && <p className="text-sm text-[#AD3614]">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full rounded-lg bg-[#006B3C] py-2.5 text-sm font-medium text-white hover:bg-[#004526] disabled:opacity-40">
          {loading ? 'Creating...' : 'Create corporate account'}
        </button>
      </form>
    </main>
  );
}
