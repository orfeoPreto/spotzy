'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '../../../hooks/useAuth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

const QUICK_REPLIES = [
  'Damage to my vehicle',
  'Spot was unavailable',
  'Incorrect listing info',
  'Billing issue',
];

const INITIAL_AI_MESSAGE = 'Hello! I\'m the Spotzy Support assistant. How can I help you today?';

interface AiMessage {
  messageId: string;
  role: 'AI' | 'USER';
  contentType: 'TEXT' | 'SUMMARY' | 'ESCALATED';
  text?: string;
  requestsEvidence?: boolean;
  summary?: { category: string; description: string; photoCount: number };
  reference?: string;
}

export default function DisputePage() {
  const _pathname = usePathname();
  const bookingId = _pathname.split('/').filter(Boolean)[1] ?? '';
  const { user } = useAuth();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [hasSentFirst, setHasSentFirst] = useState(false);
  const [evidenceThumbnails, setEvidenceThumbnails] = useState<string[]>([]);
  const [escalated, setEscalated] = useState(false);
  const [escalationReason, setEscalationReason] = useState('');
  const [escalationRef, setEscalationRef] = useState('');
  const [agentConnected, setAgentConnected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showEvidenceUpload = messages.some((m) => m.role === 'AI' && m.requestsEvidence);

  // On mount, check for existing dispute and load previous messages
  useEffect(() => {
    if (!user || !bookingId) { setLoadingExisting(false); return; }

    const loadExistingDispute = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/disputes?bookingId=${encodeURIComponent(bookingId)}`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (res.ok) {
          const data = await res.json() as {
            disputeId?: string;
            referenceNumber?: string;
            status?: string;
            escalationReason?: string;
            messages?: Array<{ messageId: string; role: 'AI' | 'USER'; text: string; contentType?: string; requestsEvidence?: boolean }>;
          };
          if (data.disputeId && data.messages && data.messages.length > 0) {
            setDisputeId(data.disputeId);
            setHasSentFirst(true);
            const loaded: AiMessage[] = data.messages.map((m) => ({
              messageId: m.messageId,
              role: m.role,
              contentType: (m.contentType as AiMessage['contentType']) ?? 'TEXT',
              text: m.text,
              requestsEvidence: m.requestsEvidence,
            }));
            setMessages(loaded);
            if (data.status === 'ESCALATED') {
              setEscalated(true);
              setEscalationReason(data.escalationReason ?? '');
            }
          }
        }
      } catch {
        // Silently fail — user can start fresh
      } finally {
        setLoadingExisting(false);
      }
    };

    void loadExistingDispute();
  }, [user?.token, bookingId]);

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;
    const userMsg: AiMessage = {
      messageId: `u-${Date.now()}`,
      role: 'USER',
      contentType: 'TEXT',
      text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputText('');

    const reloadMessages = async (dId: string) => {
      const r = await fetch(`${API_URL}/api/v1/disputes?bookingId=${encodeURIComponent(bookingId)}`, {
        headers: { Authorization: `Bearer ${user?.token}` },
      });
      if (r.ok) {
        const data = await r.json() as { status?: string; escalationReason?: string; messages?: Array<{ messageId: string; role: 'AI' | 'USER'; text: string; contentType?: string; requestsEvidence?: boolean }> };
        if (data.messages) {
          setMessages(data.messages.map((m) => ({
            messageId: m.messageId,
            role: m.role,
            contentType: (m.contentType as AiMessage['contentType']) ?? 'TEXT',
            text: m.text,
            requestsEvidence: m.requestsEvidence,
          })));
        }
        if (data.status === 'ESCALATED') {
          setEscalated(true);
          setEscalationReason(data.escalationReason ?? '');
        }
      }
    };

    try {
      if (!hasSentFirst) {
        // First message -> create dispute
        setHasSentFirst(true);
        const res = await fetch(`${API_URL}/api/v1/disputes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.token}` },
          body: JSON.stringify({ bookingId, reason: text }),
        });
        if (res.ok) {
          const data = await res.json() as { disputeId: string; referenceNumber: string };
          setDisputeId(data.disputeId);
          await reloadMessages(data.disputeId);
        } else {
          const err = await res.json().catch(() => ({ error: 'Failed to create dispute' })) as { error: string };
          const aiReply: AiMessage = {
            messageId: `ai-${Date.now()}`,
            role: 'AI',
            contentType: 'TEXT',
            text: err.error ?? 'Something went wrong. Please try again.',
          };
          setMessages((prev) => [...prev, aiReply]);
          setHasSentFirst(false);
        }
      } else if (disputeId) {
        // Subsequent messages -> add to existing dispute
        const res = await fetch(`${API_URL}/api/v1/disputes/${disputeId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.token}` },
          body: JSON.stringify({ content: text }),
        });
        if (res.ok) {
          await reloadMessages(disputeId);
        }
      }
    } catch {
      const aiReply: AiMessage = {
        messageId: `ai-${Date.now()}`,
        role: 'AI',
        contentType: 'TEXT',
        text: 'Network error. Please check your connection and try again.',
      };
      setMessages((prev) => [...prev, aiReply]);
    }
  };

  const handleConfirmSubmit = async () => {
    setSubmitting(true);
    await fetch(`${API_URL}/api/v1/disputes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.token}` },
      body: JSON.stringify({ bookingId, messages, evidenceCount: evidenceThumbnails.length }),
    });
    setSubmitting(false);
    setSubmitted(true);
  };

  const handleEvidenceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setEvidenceThumbnails((prev) => [...prev, ev.target?.result as string]);
    };
    reader.readAsDataURL(file);
  };

  return (
    <main
      data-testid="dispute-page"
      className="flex h-screen flex-col bg-[#004526]/5"
    >
      {/* Header */}
      <div className="border-b border-blue-200 bg-[#004526] px-4 py-3 text-white">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          Spotzy Support
        </h1>
      </div>

      {/* Escalation banner */}
      {escalated && (
        <div
          data-testid="escalation-banner"
          className="border-b border-[#B8E6D0] bg-[#EBF7F1] px-4 py-3 flex items-center gap-3"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5 text-[#004526] flex-shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-[#004526]">Transferred to our support team</p>
            <p className="text-xs text-[#4B6354] mt-0.5">
              A Spotzy agent will review your case and respond shortly.
            </p>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loadingExisting ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-gray-400">Loading conversation...</p>
          </div>
        ) : (
          <>
            {/* Initial AI message */}
            <div data-testid="ai-message-initial" className="mb-4 flex justify-start">
              <div className="max-w-[75%] rounded-2xl bg-white px-4 py-2 shadow-sm">
                <p className="text-sm text-gray-800">{INITIAL_AI_MESSAGE}</p>
              </div>
            </div>

            {/* Quick reply chips */}
            {!hasSentFirst && (
              <div className="mb-4 flex flex-wrap gap-2">
                {QUICK_REPLIES.map((reply) => (
                  <button
                    key={reply}
                    type="button"
                    data-testid="quick-reply-chip"
                    onClick={() => void sendMessage(reply)}
                    className="rounded-full border border-[#004526] px-3 py-1 text-xs font-medium text-[#004526] hover:bg-blue-50"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            )}

            {/* Conversation */}
            {messages.map((m) => (
              <div key={m.messageId} className={`mb-3 flex ${m.role === 'USER' ? 'justify-end' : 'justify-start'}`}>
                {m.contentType === 'SUMMARY' && m.summary ? (
                  <div data-testid="dispute-summary-card" className="w-full max-w-sm rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
                    <p className="mb-1 text-xs font-semibold uppercase text-[#004526]">Summary</p>
                    <p className="text-sm font-medium text-gray-900">{m.summary.category}</p>
                    <p className="mt-1 text-sm text-gray-600">{m.summary.description}</p>
                    <p className="mt-1 text-xs text-gray-400">{m.summary.photoCount} photo{m.summary.photoCount !== 1 ? 's' : ''} attached</p>
                    {!submitted && (
                      <button
                        type="button"
                        onClick={() => void handleConfirmSubmit()}
                        disabled={submitting}
                        className="mt-3 w-full rounded-lg bg-[#006B3C] py-2 text-sm font-medium text-white disabled:opacity-40"
                      >
                        {submitting ? 'Submitting\u2026' : 'Confirm and submit'}
                      </button>
                    )}
                    {submitted && <p className="mt-2 text-center text-sm text-green-600">Dispute submitted</p>}
                  </div>
                ) : m.contentType === 'ESCALATED' ? (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-sm text-gray-600">Transferring to agent\u2026</p>
                    {agentConnected && (
                      <>
                        <p className="text-sm font-semibold text-green-700">Agent connected</p>
                        <span data-testid="escalation-reference" className="font-mono rounded bg-gray-100 px-2 py-0.5 text-xs">
                          {escalationRef}
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${m.role === 'USER' ? 'bg-[#004526] text-white' : 'bg-white text-gray-800 shadow-sm'}`}>
                    <p className="text-sm">{m.text}</p>
                  </div>
                )}
              </div>
            ))}

            {/* Evidence thumbnails */}
            {evidenceThumbnails.length > 0 && (
              <div className="mb-3 flex gap-2">
                {evidenceThumbnails.map((src, i) => (
                  <img key={i} data-testid="evidence-thumbnail" src={src} alt="Evidence" className="h-16 w-16 rounded-lg object-cover" />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Evidence upload button */}
      {showEvidenceUpload && (
        <div className="border-t border-gray-200 bg-white px-4 py-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-[#004526] px-3 py-1.5 text-sm font-medium text-[#004526]"
          >
            Add photos
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleEvidenceFile}
          />
        </div>
      )}

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !escalated) { e.preventDefault(); void sendMessage(inputText); } }}
            placeholder={escalated ? 'Case transferred to support team' : 'Describe your issue\u2026'}
            disabled={escalated}
            data-testid="dispute-input"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
          />
          <button
            type="button"
            data-testid="send-message"
            onClick={() => void sendMessage(inputText)}
            disabled={!inputText.trim() || escalated}
            className="rounded-lg bg-[#006B3C] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </main>
  );
}
