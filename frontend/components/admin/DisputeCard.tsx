'use client';

import Link from 'next/link';

export interface AdminDispute {
  disputeId: string;
  bookingRef: string;
  hostDisplayName: string;
  guestDisplayName: string;
  listingAddress: string;
  escalationSummary: string | null;
  escalatedAt: string | null;
  resolvedAt: string | null;
  outcome: string | null;
  unreadForAdmin: boolean;
  status: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DisputeCard({ dispute }: { dispute: AdminDispute }) {
  return (
    <div
      data-testid={`dispute-card-${dispute.disputeId}`}
      className={`bg-white rounded-xl shadow-sm p-5 border-l-[4px] ${
        dispute.unreadForAdmin ? 'border-l-[#AD3614]' : 'border-l-transparent'
      }`}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-[#004526]">{dispute.bookingRef}</span>
          {dispute.unreadForAdmin && (
            <span className="w-2 h-2 rounded-full bg-[#AD3614]" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {dispute.status === 'RESOLVED' && (
            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-[#EBF7F1] text-[#006B3C]">Resolved</span>
          )}
          <span className="text-xs text-[#4B6354]">{relativeTime(dispute.resolvedAt ?? dispute.escalatedAt ?? '')}</span>
        </div>
      </div>
      <p className="text-sm text-[#4B6354] mb-1">
        {dispute.hostDisplayName} &#x2194; {dispute.guestDisplayName} &mdash; {dispute.listingAddress}
      </p>
      {dispute.escalationSummary && (
        <p
          data-testid="escalation-summary"
          className="text-sm text-[#1C2B1A] mt-2 mb-3"
          style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {dispute.escalationSummary}
        </p>
      )}
      <Link
        href={`/backoffice/disputes/${dispute.disputeId}`}
        className="text-sm font-semibold text-[#006B3C] hover:underline"
      >
        View dispute &rarr;
      </Link>
    </div>
  );
}
