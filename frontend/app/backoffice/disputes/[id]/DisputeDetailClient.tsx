'use client';

import { useEffect, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { AdminGuard } from '../../../../components/AdminGuard';
import { useAuth } from '../../../../hooks/useAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface DisputeMessage {
  messageId: string;
  senderId: string;
  senderRole: 'guest' | 'host' | 'bot' | 'admin' | 'system';
  text: string;
  createdAt: string;
}

interface DisputeDetail {
  disputeId: string;
  bookingRef: string;
  hostDisplayName: string;
  guestDisplayName: string;
  listingAddress: string;
  escalationSummary: string | null;
  status: string;
  messages: DisputeMessage[];
}

type Outcome = '' | 'RESOLVED_FOR_GUEST' | 'RESOLVED_FOR_HOST' | 'PARTIAL_REFUND' | 'NO_ACTION';

function DisputeDetailContent() {
  const pathname = usePathname();
  const id = pathname.split('/').filter(Boolean)[2] ?? '';
  const { user } = useAuth();
  const [dispute, setDispute] = useState<DisputeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminMessage, setAdminMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>('');
  const [refundAmount, setRefundAmount] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const showRefund = outcome === 'RESOLVED_FOR_GUEST' || outcome === 'PARTIAL_REFUND';

  useEffect(() => {
    if (!user || !id) return;
    const headers = { Authorization: `Bearer ${user.token}` };

    fetch(`${API_URL}/api/v1/admin/disputes/${id}`, { headers })
      .then((r) => r.json())
      .then((d) => {
        setDispute(d as DisputeDetail);
        if ((d as { status?: string }).status === 'RESOLVED') setResolved(true);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user?.userId, id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [dispute?.messages.length]);

  const handleSendMessage = async () => {
    if (!adminMessage.trim() || !user) return;
    setSending(true);
    try {
      await fetch(`${API_URL}/api/v1/admin/disputes/${id}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({ text: adminMessage }),
      });
      setDispute((prev) =>
        prev
          ? {
              ...prev,
              messages: [
                ...prev.messages,
                {
                  messageId: `admin-${Date.now()}`,
                  senderId: user.userId,
                  senderRole: 'admin',
                  text: adminMessage,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : prev,
      );
      setAdminMessage('');
    } finally {
      setSending(false);
    }
  };

  const handleResolve = async () => {
    if (!outcome || !user) return;
    setResolving(true);
    try {
      await fetch(`${API_URL}/api/v1/admin/disputes/${id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`,
        },
        body: JSON.stringify({
          outcome,
          refundAmount: showRefund ? Number(refundAmount) || 0 : 0,
          adminNote,
        }),
      });
      setResolved(true);
    } finally {
      setResolving(false);
    }
  };

  if (loading) {
    return <div className="animate-pulse h-64 rounded-xl bg-gray-200" />;
  }

  if (!dispute) {
    return <p className="text-sm text-gray-500">Dispute not found.</p>;
  }

  return (
    <div className="max-w-4xl">
      {/* AI Summary pinned box */}
      {dispute.escalationSummary && (
        <div
          data-testid="ai-summary-box"
          className="rounded-xl p-4 mb-6"
          style={{ backgroundColor: '#F5E6E1' }}
        >
          <h3 className="text-sm font-semibold text-[#AD3614] mb-1">AI Escalation Summary</h3>
          <p className="text-sm text-[#1C2B1A]">{dispute.escalationSummary}</p>
        </div>
      )}

      {/* Dispute header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-[#004526]">
          Dispute {dispute.bookingRef}
        </h1>
        <p className="text-sm text-[#4B6354]">
          {dispute.hostDisplayName} &#x2194; {dispute.guestDisplayName} &mdash; {dispute.listingAddress}
        </p>
      </div>

      {/* Chat history */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-6 max-h-[400px] overflow-y-auto">
        <h2 className="text-sm font-semibold text-[#004526] mb-3">Chat History</h2>
        <div className="space-y-3">
          {dispute.messages.map((msg) => {
            const isUser = msg.senderRole === 'guest' || msg.senderRole === 'host';
            const isAdmin = msg.senderRole === 'admin';
            return (
              <div
                key={msg.messageId}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                    isAdmin
                      ? 'bg-[#004526] text-white'
                      : isUser
                      ? 'bg-[#006B3C] text-white'
                      : 'bg-gray-100 text-[#1C2B1A]'
                  }`}
                >
                  <span className="block text-xs opacity-70 mb-0.5">
                    {msg.senderRole}
                  </span>
                  {msg.text}
                </div>
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Admin message input */}
      {!resolved && (
        <div className="flex gap-2 mb-6">
          <input
            data-testid="admin-message-input"
            type="text"
            value={adminMessage}
            onChange={(e) => setAdminMessage(e.target.value)}
            placeholder="Type a message to parties..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#006B3C]"
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
          />
          <button
            data-testid="send-admin-message"
            onClick={handleSendMessage}
            disabled={sending || !adminMessage.trim()}
            className="rounded-lg bg-[#006B3C] px-4 py-2 text-sm font-medium text-white hover:bg-[#004526] disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}

      {/* Resolution panel */}
      {resolved ? (
        <div className="rounded-xl border-2 border-[#006B3C] bg-white p-6 text-center">
          <p className="text-lg font-semibold text-[#006B3C]">Dispute resolved successfully</p>
          <p className="text-sm text-[#4B6354] mt-1">Both parties have been notified.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-[#004526] mb-4">Resolution</h2>

          <div className="space-y-4">
            <div>
              <label htmlFor="resolution-outcome" className="block text-sm font-medium text-gray-700 mb-1">
                Resolution outcome
              </label>
              <select
                id="resolution-outcome"
                aria-label="Resolution outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as Outcome)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#006B3C]"
              >
                <option value="">Select outcome...</option>
                <option value="RESOLVED_FOR_GUEST">Resolved for Guest</option>
                <option value="RESOLVED_FOR_HOST">Resolved for Host</option>
                <option value="PARTIAL_REFUND">Partial refund</option>
                <option value="NO_ACTION">No action</option>
              </select>
            </div>

            {showRefund && (
              <div>
                <label htmlFor="refund-amount" className="block text-sm font-medium text-gray-700 mb-1">
                  Refund amount (cents)
                </label>
                <input
                  id="refund-amount"
                  type="number"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#006B3C]"
                />
              </div>
            )}

            <div>
              <label htmlFor="admin-note" className="block text-sm font-medium text-gray-700 mb-1">
                Admin note
              </label>
              <textarea
                id="admin-note"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                rows={3}
                placeholder="Optional notes about this resolution..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#006B3C]"
              />
            </div>

            <button
              onClick={handleResolve}
              disabled={!outcome || resolving}
              className="rounded-lg bg-[#AD3614] px-5 py-2 text-sm font-semibold text-white hover:bg-[#8B2C10] disabled:opacity-50"
            >
              {resolving ? 'Applying...' : 'Apply resolution'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DisputeDetailPage() {
  return (
    <AdminGuard>
      <DisputeDetailContent />
    </AdminGuard>
  );
}
