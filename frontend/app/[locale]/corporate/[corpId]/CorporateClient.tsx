'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

async function getAuthToken(): Promise<string> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? '';
  } catch { return ''; }
}

export default function CorporateDashboardPage() {
  const pathname = usePathname();
  const corpId = pathname.split('/').pop() ?? '';
  const [loading, setLoading] = useState(true);
  const [corp, setCorp] = useState<any>(null);

  useEffect(() => {
    if (!corpId || corpId === '_') return;
    const load = async () => {
      const token = await getAuthToken();
      const res = await fetch(`${API_URL}/api/v1/corporate/${corpId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setCorp(await res.json());
      setLoading(false);
    };
    load();
  }, [corpId]);

  if (loading) return <main className="max-w-3xl mx-auto px-6 py-12"><p className="text-[#4B6354]">Loading...</p></main>;
  if (!corp) return <main className="max-w-3xl mx-auto px-6 py-12"><p className="text-[#AD3614]">Corporate account not found</p></main>;

  return (
    <main className="max-w-3xl mx-auto px-6 py-12 space-y-6">
      <h1 className="text-2xl font-bold text-[#004526]">{corp.name}</h1>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#EBF7F1] rounded-xl p-4">
          <p className="text-sm text-[#4B6354]">VAT</p>
          <p className="font-medium text-[#004526]">{corp.vatNumber}</p>
        </div>
        <div className="bg-[#EBF7F1] rounded-xl p-4">
          <p className="text-sm text-[#4B6354]">Status</p>
          <p className="font-medium text-[#004526]">{corp.status}</p>
        </div>
      </div>
      <div className="flex gap-3">
        <Link href={`/corporate/${corpId}/invoices`}
          className="flex-1 text-center rounded-lg border border-[#004526] py-2.5 text-sm font-medium text-[#004526]">
          View invoices
        </Link>
      </div>
    </main>
  );
}
