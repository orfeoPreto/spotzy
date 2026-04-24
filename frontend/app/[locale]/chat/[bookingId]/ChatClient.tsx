'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useLocalizedRouter, useLocalizePath } from '../../../../lib/locales/useLocalizedRouter';
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

  const lp = useLocalizePath();
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
    <main className="flex flex-col bg-[#EFF5F1] animate-page-enter" style={{ minHeight: '100dvh' }}>
      {/* Pinned back navigation */}
      <div className="sticky top-0 z-20 flex items-center gap-2 bg-[#EFF5F1] px-4 py-2 border-b border-[#B8E6D0]">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-[#004526] hover:text-[#006B3C] transition-colors duration-200"
          aria-label={t('back_to_bookings')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          <span className="font-['Inter'] text-xs font-medium">{t('back_to_bookings')}</span>
        </button>
      </div>

      {/* Booking context banner — Forest bg, white text, 48px */}
      {booking && (
        <div className="bg-[#004526] px-4 text-white" style={{ minHeight: '48px', display: 'flex', alignItems: 'center' }}>
          <div className="min-w-0 flex-1 py-2">
            {otherPartyName && (
              <p className="font-['DM_Sans'] text-sm font-semibold truncate">
                <Link href={lp(`/users/${otherPartyId}`)} className="hover:underline">{otherPartyName}</Link>
              </p>
            )}
            <p className="font-['DM_Sans'] text-sm font-medium truncate">{booking.address}</p>
            <p className="font-['Inter'] text-[11px] text-[#B8E6D0]">{t('booking_reference', { reference: booking.reference })}</p>
          </div>
        </div>
      )}

      {/* Message area — dynamic height, max 80vh, scrolls to bottom */}
      <div
        data-testid="message-area"
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ maxHeight: '80vh' }}
      >
        {messages.length === 0 ? (
          <p className="text-center font-['Inter'] text-sm text-[#4B6354]">{t('no_messages')}</p>
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
        <div className="border-t border-[#B8E6D0] bg-[#EBF7F1] px-4 py-2">
          <img
            data-testid="image-preview"
            src={pendingImage.preview}
            alt={t('image_preview_alt')}
            className="h-20 w-20 rounded-lg object-cover ring-2 ring-[#004526]/20"
          />
        </div>
      )}

      {/* Input bar — Sage bg, Forest send button */}
      <div className="border-t border-[#B8E6D0] bg-[#EBF7F1] px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t('attach_image')}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg p-2 text-[#4B6354] hover:text-[#004526] transition-colors duration-200"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
            </svg>
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
            className="flex-1 rounded-lg border border-[#B8E6D0] bg-white px-3 py-2 font-['Inter'] text-sm text-[#1C2B1A] placeholder-[#4B6354]/60 focus:outline-none focus:ring-2 focus:ring-[#004526]/30"
          />
          <button
            type="button"
            aria-label={t('send_button')}
            onClick={() => void handleSend()}
            disabled={!inputText.trim() && !pendingImage}
            className="rounded-lg bg-[#004526] px-4 py-2 font-['Inter'] text-sm font-medium text-white transition-all duration-200 hover:bg-[#006B3C] active:scale-95 disabled:opacity-40"
          >
            {t('send_button')}
          </button>
        </div>
      </div>
    </main>
  );
}
