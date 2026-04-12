'use client';

import { useState } from 'react';
import type { ChatMessage } from '../hooks/useChat';

interface ChatBubbleProps {
  message: ChatMessage;
  own: boolean;
  userLocale?: string;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function ChatBubble({ message, own, userLocale }: ChatBubbleProps) {
  const [showTranslated, setShowTranslated] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Determine if translation is needed (message locale differs from user locale)
  const messageLocale = (message as any).originalLocale;
  const needsTranslation = userLocale && messageLocale && messageLocale !== userLocale && message.contentType !== 'IMAGE';

  const handleTranslate = async () => {
    if (translatedText) {
      setShowTranslated(true);
      return;
    }
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      const { fetchAuthSession } = await import('aws-amplify/auth');
      const session = await fetchAuthSession();
      const token = session.tokens?.idToken?.toString();
      if (!apiUrl || !token) return;

      const res = await fetch(`${apiUrl}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          contentType: 'chat',
          sourceText: message.text,
          sourceLocale: messageLocale,
          targetLocale: userLocale,
        }),
      });
      const data = await res.json();
      if (data.data?.translatedText) {
        setTranslatedText(data.data.translatedText);
        setShowTranslated(true);
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`flex ${own ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        data-testid="chat-bubble"
        data-own={own ? 'true' : 'false'}
        className={`max-w-[70%] rounded-2xl px-4 py-2 ${
          own ? 'bg-[#004526] text-white' : 'bg-[#F0F4F8] text-gray-900'
        }`}
      >
        {message.contentType === 'IMAGE' && message.imageUrl ? (
          <img
            src={message.imageUrl}
            alt="Shared image"
            className="max-w-full rounded-lg"
          />
        ) : (
          <p className="text-sm">
            {showTranslated && translatedText ? translatedText : message.text}
          </p>
        )}
        <p
          data-testid="message-time"
          className={`mt-1 text-[10px] ${own ? 'text-blue-200 text-right' : 'text-gray-400'}`}
        >
          {formatTime(message.createdAt)}
        </p>
        {needsTranslation && (
          <div className={`mt-0.5 text-[10px] ${own ? 'text-right' : ''}`}>
            {showTranslated ? (
              <button
                onClick={() => setShowTranslated(false)}
                className={`underline ${own ? 'text-blue-200 hover:text-white' : 'text-slate-500 hover:text-slate-700'}`}
              >
                View original
              </button>
            ) : (
              <button
                onClick={handleTranslate}
                disabled={loading}
                className={`underline ${own ? 'text-blue-200 hover:text-white' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {loading ? 'Translating...' : 'Translate'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
