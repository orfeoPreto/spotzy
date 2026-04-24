'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../../../hooks/useAuth';
import { ConversationRow, ConversationItem } from '../../../components/ConversationRow';
import { useTranslation } from '../../../lib/locales/TranslationProvider';

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
  const { t } = useTranslation('notifications');
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
      <main className="flex min-h-screen items-center justify-center bg-[#EFF5F1]">
        <p className="font-['Inter'] text-sm text-[#4B6354]">{t('messages.loading')}</p>
      </main>
    );
  }

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);

  return (
    <main className="min-h-screen bg-[#EFF5F1] animate-page-enter">
      {/* Desktop two-column layout */}
      <div className="mx-auto flex max-w-5xl gap-0 lg:gap-6 lg:py-8 lg:px-4">

        {/* Conversation list — 400px on desktop, full width on mobile */}
        <aside className="w-full lg:w-[400px] lg:flex-shrink-0">
          {/* Header */}
          <div className="flex items-baseline gap-2 px-4 pt-6 pb-4 lg:pt-0">
            <h1 className="font-['DM_Sans'] text-xl font-bold text-[#004526]">
              {t('messages.page_title')}
            </h1>
            {totalUnread > 0 && (
              <span className="rounded-full bg-[#AD3614] px-2 py-0.5 font-['Inter'] text-[11px] font-bold text-white">
                {totalUnread}
              </span>
            )}
          </div>

          {conversations.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="font-['Inter'] text-sm text-[#4B6354]">{t('messages.no_conversations')}</p>
            </div>
          ) : (
            <div className="divide-y divide-[#B8E6D0] rounded-xl border border-[#B8E6D0] bg-white shadow-sm overflow-hidden">
              {conversations.map((c, i) => (
                <ConversationRow key={c.bookingId} conversation={c} index={i} />
              ))}
            </div>
          )}

          {/* Disputes section */}
          {disputes.length > 0 && (
            <div className="mt-8">
              <h2 className="px-4 font-['DM_Sans'] text-base font-bold text-[#004526] mb-3">{t('messages.disputes_heading')}</h2>
              <div className="divide-y divide-[#B8E6D0] rounded-xl border border-[#B8E6D0] bg-white shadow-sm overflow-hidden">
                {disputes.map((d) => (
                  <Link
                    key={d.disputeId}
                    href={`/dispute/${d.bookingId}`}
                    className="flex items-center justify-between px-4 py-3 transition-colors duration-200 hover:bg-[#EBF7F1]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-['Inter'] text-sm font-medium text-[#004526] truncate">
                          {d.listingAddress ?? d.reason ?? `Dispute ${d.referenceNumber}`}
                        </span>
                        <span className={`font-['Inter'] text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${
                          d.status === 'ESCALATED' ? 'bg-[#AD3614]/10 text-[#AD3614]'
                          : d.status === 'RESOLVED' ? 'bg-[#EBF7F1] text-[#006B3C]'
                          : 'bg-amber-50 text-amber-700'
                        }`}>
                          {d.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <p className="font-['Inter'] text-xs text-[#4B6354] truncate">{d.reason}</p>
                        <Link
                          href={`/dashboard/spotter`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-['Inter'] text-xs text-[#006B3C] hover:underline flex-shrink-0"
                        >
                          {t('messages.view_booking')}
                        </Link>
                      </div>
                    </div>
                    <span className="font-['Inter'] text-xs text-[#4B6354] ml-3 flex-shrink-0">
                      {new Date(d.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 px-4 pb-6 text-center">
            <Link
              href="/messages?archived=true"
              className="font-['Inter'] text-sm text-[#4B6354] hover:text-[#004526] hover:underline transition-colors duration-200"
            >
              {t('messages.view_archived')}
            </Link>
          </div>
        </aside>

        {/* Chat thread pane — visible on desktop when a conversation is selected */}
        <section className="hidden lg:flex flex-1 min-h-[600px] flex-col rounded-xl border border-[#B8E6D0] bg-white shadow-sm overflow-hidden">
          <div className="flex flex-1 items-center justify-center">
            <p className="font-['Inter'] text-sm text-[#4B6354]">{t('messages.select_conversation')}</p>
          </div>
        </section>

      </div>
    </main>
  );
}
