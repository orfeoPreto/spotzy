'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useLocalizedRouter } from '../../../../lib/locales/useLocalizedRouter';
import { useAuth } from '../../../../hooks/useAuth';
import { useChat } from '../../../../hooks/useChat';
import ChatBubble from '../../../../components/ChatBubble';
import { AccessCodeMessage } from '../../../../components/chat/AccessCodeMessage';
import { useTranslation } from '../../../../lib/locales/TranslationProvider';

interface BookingContext {
  bookingId: string;
  address: string;
  reference: string;
  spotterId?: string;
  hostId?: string;
  spotterName?: string;
  hostName?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function ChatPage() {
  const { t } = useTranslation('chat');
  const _pathname = usePathname();
  const bookingId = _pathname.split('/').filter(Boolean)[2] ?? '';
  const router = useLocalizedRouter();
  const { user } = useAuth();
  const [booking, setBooking] = useState<BookingContext | null>(null);
  const [otherPartyName, setOtherPartyName] = useState<string | null>(null);
  const [otherPartyId, setOtherPartyId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, sendText, sendImage } = useChat(
    bookingId ?? '',
    user?.token ?? '',
    user?.userId ?? '',
  );

  useEffect(() => {
    if (!user || !bookingId) return;
    fetch(`${API_URL}/api/v1/bookings/${bookingId}`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        const data = d as BookingContext;
        setBooking(data);
        // Determine the other party (if I'm the spotter, show host; if I'm the host, show spotter)
        const isSpotter = user?.userId === data.spotterId;
        const name = isSpotter ? data.hostName : data.spotterName;
        const id = isSpotter ? data.hostId : data.spotterId;
        setOtherPartyName(name ?? null);
        setOtherPartyId(id ?? null);
        // If name not embedded, fetch profile
        if (!name && id) {
          fetch(`${API_URL}/api/v1/users/${id}/public`, {
            headers: { Authorization: `Bearer ${user!.token}` },
          })
            .then((r) => r.ok ? r.json() : null)
            .then((profile) => {
              if (profile?.name) setOtherPartyName(profile.name);
            })
            .catch(() => {});
        }
      });
  }, [bookingId, user?.userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (pendingImage) {
      const res = await fetch(`${API_URL}/api/v1/chat/${bookingId}/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.token}` },
        body: JSON.stringify({ filename: pendingImage.file.name }),
      });
      const { uploadUrl, imageUrl } = await res.json() as { uploadUrl: string; imageUrl: string };
      await fetch(uploadUrl, { method: 'PUT', body: pendingImage.file });
      sendImage(imageUrl);
      setPendingImage(null);
    } else if (inputText.trim()) {
      sendText(inputText);
      setInputText('');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPendingImage({ file, preview: ev.target?.result as string });
    };
    reader.readAsDataURL(file);
  };

  const currentUserId = user?.userId ?? '';

  return (
    <main className="flex flex-col bg-gray-50 pt-2 pb-2" style={{ height: 'calc(100vh - 200px)' }}>
      <div className="mx-auto flex w-full max-w-2xl flex-1 min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Header with back button and booking context */}
      <div className="border-b border-gray-200 bg-[#F0F7F3] px-4 py-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => router.back()} className="text-[#004526] hover:text-[#006B3C]" aria-label={t('back_to_bookings')}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            {booking && (
              <>
                {otherPartyName && (
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    <a href={`/users/${otherPartyId}`} className="hover:underline">{otherPartyName}</a>
                  </p>
                )}
                <p className="text-sm font-medium text-gray-900 truncate">{booking.address}</p>
                <p className="text-xs text-gray-500">{t('booking_reference', { reference: booking.reference })}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div data-testid="message-area" className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-gray-400">{t('no_messages')}</p>
        ) : (
          messages.map((m) => (
            m.type === 'ACCESS_CODE' ? (
              <AccessCodeMessage key={m.messageId} code={m.code ?? ''} validFrom={m.validFrom ?? ''} validUntil={m.validUntil ?? ''} revokedAt={m.revokedAt} />
            ) : (
              <ChatBubble key={m.messageId} message={m} own={m.senderId === currentUserId} />
            )
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Image preview */}
      {pendingImage && (
        <div className="border-t border-gray-200 px-4 py-2">
          <img
            data-testid="image-preview"
            src={pendingImage.preview}
            alt={t('image_preview_alt')}
            className="h-20 w-20 rounded-lg object-cover"
          />
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t('attach_image')}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg p-2 text-gray-400 hover:text-gray-600"
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleFileChange}
          />
          <input
            type="text"
            placeholder={t('message_placeholder')}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
            }}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            aria-label={t('send_button')}
            onClick={() => void handleSend()}
            disabled={!inputText.trim() && !pendingImage}
            className="rounded-lg bg-[#006B3C] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {t('send_button')}
          </button>
        </div>
      </div>
      </div>
    </main>
  );
}
