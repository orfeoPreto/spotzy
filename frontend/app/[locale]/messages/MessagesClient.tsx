'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../../../hooks/useAuth';
import { ConversationRow, ConversationItem } from '../../../components/ConversationRow';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface DisputeItem {
  disputeId: string;
  bookingId: string;
  status: string;
  reason: string;
  referenceNumber: string;
  listingAddress: string | null;
  createdAt: string;
}

export default function MessagesClient() {
  const { user, isLoading } = useAuth();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetch(`${API_URL}/api/v1/messages`, {
        headers: { Authorization: `Bearer ${user.token}` },
      }).then((r) => r.json()),
      fetch(`${API_URL}/api/v1/disputes`, {
        headers: { Authorization: `Bearer ${user.token}` },
      }).then((r) => r.ok ? r.json() : { disputes: [] }),
    ])
      .then(([msgData, disputeData]) => {
        setConversations((msgData as { conversations: ConversationItem[] }).conversations ?? []);
        setDisputes((disputeData as { disputes: DisputeItem[] }).disputes ?? []);
      })
      .finally(() => setLoading(false));
  }, [user?.userId]);

  if (isLoading || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading messages...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="px-4 text-xl font-semibold text-[#1C2B1A] mb-4">Messages</h1>

        {conversations.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-gray-400">No active conversations</p>
          </div>
        ) : (
          <div className="divide-y divide-[#EBF7F1] rounded-xl border border-[#EBF7F1] bg-white shadow-sm">
            {conversations.map((c, i) => (
              <ConversationRow key={c.bookingId} conversation={c} index={i} />
            ))}
          </div>
        )}

        {/* Disputes section */}
        {disputes.length > 0 && (
          <div className="mt-8">
            <h2 className="px-4 text-lg font-semibold text-[#1C2B1A] mb-3">Disputes</h2>
            <div className="divide-y divide-[#EBF7F1] rounded-xl border border-[#EBF7F1] bg-white shadow-sm">
              {disputes.map((d) => (
                <Link
                  key={d.disputeId}
                  href={`/dispute/${d.bookingId}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-[#F0F7F3] transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#004526] truncate">
                        {d.listingAddress ?? d.reason ?? `Dispute ${d.referenceNumber}`}
                      </span>
                      <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
                        d.status === 'ESCALATED' ? 'bg-red-50 text-[#AD3614]'
                        : d.status === 'RESOLVED' ? 'bg-[#EBF7F1] text-[#006B3C]'
                        : 'bg-amber-50 text-amber-700'
                      }`}>
                        {d.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <p className="text-xs text-[#4B6354] truncate">{d.reason}</p>
                      <Link
                        href={`/dashboard/spotter`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-[#006B3C] hover:underline flex-shrink-0"
                      >
                        View booking
                      </Link>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 ml-3 flex-shrink-0">
                    {new Date(d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 text-center">
          <Link
            href="/messages?archived=true"
            className="text-sm text-[#4B6354] hover:text-[#004526] hover:underline"
          >
            View archived conversations
          </Link>
        </div>
      </div>
    </main>
  );
}
