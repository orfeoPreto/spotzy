'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '../../hooks/useAuth';
import { ConversationRow, ConversationItem } from '../../components/ConversationRow';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function MessagesClient() {
  const { user, isLoading } = useAuth();
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetch(`${API_URL}/api/v1/messages`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setConversations((data as { conversations: ConversationItem[] }).conversations ?? []);
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
