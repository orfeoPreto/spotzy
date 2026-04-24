'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminGuard } from '../../components/AdminGuard';
import { DisputeCard, type AdminDispute } from '../../components/admin/DisputeCard';
import { useAuth } from '../../hooks/useAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

function BackofficeHome() {
  const { user } = useAuth();
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [hasMoreResolved, setHasMoreResolved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetch(`${API_URL}/api/v1/admin/disputes`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        const data = d as { disputes: AdminDispute[]; hasMoreResolved?: boolean };
        setDisputes(data.disputes ?? []);
        setHasMoreResolved(data.hasMoreResolved ?? false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user?.userId]);

  const escalated = disputes.filter((d) => d.status === 'ESCALATED');
  const resolved = disputes.filter((d) => d.status === 'RESOLVED');

  return (
    <div className="animate-page-enter">
      {/* Forest nav bar header */}
      <div className="nav-forest mb-8 -mx-8 -mt-8 px-8 py-5 flex items-center gap-3">
        <span className="font-head text-xl font-bold text-white tracking-tight">Spotzy Admin</span>
        <span className="ml-auto text-xs font-semibold text-white/60 uppercase tracking-wider">Backoffice</span>
      </div>

      {/* Escalated disputes */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-head text-2xl font-bold text-[#004526]">Escalated Disputes</h1>
        {escalated.length > 0 && (
          <span
            data-testid="dispute-count-badge"
            className="bg-[#AD3614] text-white text-xs font-bold px-2.5 py-0.5 rounded-full shadow-brick"
          >
            {escalated.length}
          </span>
        )}
      </div>

      {loading && (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-[#EFF5F1]" />
          ))}
        </div>
      )}

      {!loading && escalated.length === 0 && (
        <p className="text-sm text-[#4B6354]">No escalated disputes.</p>
      )}

      {/* Escalated dispute cards: white bg, radius-lg, Brick 4px left border for unread */}
      <div className="space-y-4">
        {escalated.map((d) => (
          <div key={d.disputeId} className="rounded-lg border-l-4 border-[#AD3614] bg-white shadow-brick overflow-hidden">
            <DisputeCard dispute={d} />
          </div>
        ))}
      </div>

      {/* Recently resolved */}
      {!loading && resolved.length > 0 && (
        <div className="mt-10">
          <h2 className="font-head text-lg font-bold text-[#004526] mb-4">Recently Resolved</h2>
          <div className="space-y-4">
            {resolved.map((d) => (
              <div key={d.disputeId} className="rounded-lg bg-white border border-[#C8DDD2] shadow-sm overflow-hidden">
                <DisputeCard dispute={d} />
              </div>
            ))}
          </div>
          {hasMoreResolved && (
            <div className="mt-4">
              <Link
                href="/backoffice/disputes/archive"
                className="text-sm font-semibold text-[#006B3C] hover:underline"
              >
                View all resolved disputes &rarr;
              </Link>
            </div>
          )}
        </div>
      )}

      <div className="mt-8 pt-6 border-t border-[#C8DDD2]">
        <Link
          href="/backoffice/customers"
          className="text-sm font-semibold text-[#006B3C] hover:underline"
        >
          View all customers &rarr;
        </Link>
      </div>
    </div>
  );
}

export default function BackofficePage() {
  return (
    <AdminGuard>
      <BackofficeHome />
    </AdminGuard>
  );
}
