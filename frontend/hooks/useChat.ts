'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface ChatMessage {
  messageId: string;
  senderId: string;
  contentType: 'TEXT' | 'IMAGE';
  text?: string;
  imageUrl?: string;
  createdAt: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

function stripEmoji(text: string): string {
  return text.replace(/\p{Extended_Pictographic}/gu, '').trim();
}

function mapRawMessage(raw: Record<string, unknown>): ChatMessage {
  return {
    messageId: (raw.messageId as string) ?? '',
    senderId: (raw.senderId as string) ?? '',
    contentType: ((raw.type as string) ?? (raw.contentType as string) ?? 'TEXT') as 'TEXT' | 'IMAGE',
    text: (raw.content as string) ?? (raw.text as string),
    imageUrl: raw.imageUrl as string | undefined,
    createdAt: (raw.createdAt as string) ?? '',
  };
}

export function useChat(bookingId: string, token: string, currentUserId: string = '') {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // Fetch messages from REST API
  const fetchMessages = useCallback(async () => {
    if (!bookingId || !tokenRef.current) return;
    try {
      const res = await fetch(`${API_URL}/api/v1/chat/${bookingId}`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      if (!res.ok) return;
      const d = await res.json();
      const raw = (d as { messages: Record<string, unknown>[] }).messages ?? [];
      const serverMessages = raw.map(mapRawMessage);

      setMessages((prev) => {
        // Keep optimistic messages that aren't confirmed yet
        const optimistic = prev.filter(
          (m) => m.messageId.startsWith('optimistic-') &&
            !serverMessages.some((s) => s.text === m.text && s.senderId === m.senderId),
        );
        return [...serverMessages, ...optimistic];
      });
    } catch {
      // ignore
    }
  }, [bookingId]);

  // Initial load + poll every 3 seconds
  useEffect(() => {
    if (!bookingId || !token) return;

    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, [bookingId, token, fetchMessages]);

  // Send via REST API
  const sendViaRest = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const res = await fetch(`${API_URL}/api/v1/chat/${bookingId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenRef.current}`,
          },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          // Fetch fresh messages to replace optimistic ones
          await fetchMessages();
        }
      } catch {
        // optimistic message stays until next poll
      }
    },
    [bookingId, fetchMessages],
  );

  const sendText = useCallback(
    (text: string) => {
      const cleaned = stripEmoji(text);
      if (!cleaned) return;

      // Optimistic update
      setMessages((prev) => [
        ...prev,
        {
          messageId: `optimistic-${Date.now()}`,
          senderId: currentUserId,
          contentType: 'TEXT',
          text: cleaned,
          createdAt: new Date().toISOString(),
        },
      ]);

      sendViaRest({ type: 'TEXT', content: cleaned });
    },
    [currentUserId, sendViaRest],
  );

  const sendImage = useCallback(
    (imageUrl: string) => {
      setMessages((prev) => [
        ...prev,
        {
          messageId: `optimistic-${Date.now()}`,
          senderId: currentUserId,
          contentType: 'IMAGE',
          imageUrl,
          createdAt: new Date().toISOString(),
        },
      ]);

      sendViaRest({ type: 'IMAGE', imageUrl });
    },
    [currentUserId, sendViaRest],
  );

  return { messages, sendText, sendImage, ws: null };
}
