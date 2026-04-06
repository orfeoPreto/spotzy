'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminGuard } from '../../../../components/AdminGuard';
import { DisputeCard, type AdminDispute } from '../../../../components/admin/DisputeCard';
import { useAuth } from '../../../../hooks/useAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

function ArchivedDisputes() {
  const { user } = useAuth();
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetch(`${API_URL}/api/v1/admin/disputes?status=resolved`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        setDisputes((d as { disputes: AdminDispute[] }).disputes ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user?.userId]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/backoffice" className="text-sm text-[#006B3C] hover:underline">&larr; Back</Link>
        <h1 className="text-2xl font-bold text-[#004526]">Resolved Disputes</h1>
        <span className="text-sm text-gray-500">({disputes.length})</span>
      </div>

      {loading && (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      )}

      {!loading && disputes.length === 0 && (
        <p className="text-sm text-gray-500">No resolved disputes.</p>
      )}

      <div className="space-y-4">
        {disputes.map((d) => (
          <DisputeCard key={d.disputeId} dispute={d} />
        ))}
      </div>
    </div>
  );
}

export default function ArchivedDisputesPage() {
  return (
    <AdminGuard>
      <ArchivedDisputes />
    </AdminGuard>
  );
}
