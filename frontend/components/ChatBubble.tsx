'use client';

import type { ChatMessage } from '../hooks/useChat';

interface ChatBubbleProps {
  message: ChatMessage;
  own: boolean;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function ChatBubble({ message, own }: ChatBubbleProps) {
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
          <p className="text-sm">{message.text}</p>
        )}
        <p
          data-testid="message-time"
          className={`mt-1 text-[10px] ${own ? 'text-blue-200 text-right' : 'text-gray-400'}`}
        >
          {formatTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}
