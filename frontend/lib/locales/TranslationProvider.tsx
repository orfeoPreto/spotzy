'use client';

import { createContext, useContext, useEffect, useState, useRef, ReactNode, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from './constants';

type Messages = Record<string, any>;

interface TranslationContextValue {
  locale: string;
  messages: Messages;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const TranslationContext = createContext<TranslationContextValue>({
  locale: 'en',
  messages: {},
  t: (key) => key,
});

export function useTranslation(namespace?: string) {
  const ctx = useContext(TranslationContext);
  const t = (key: string, params?: Record<string, string | number>) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    return ctx.t(fullKey, params);
  };
  return { t, locale: ctx.locale };
}

function getNestedValue(obj: any, path: string): string | undefined {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return params[key] !== undefined ? String(params[key]) : `{${key}}`;
  });
}

function extractLocaleFromPath(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] && (SUPPORTED_LOCALES as readonly string[]).includes(segments[0])) {
    return segments[0];
  }
  return DEFAULT_LOCALE;
}

// In-memory cache so switching back to a previously loaded locale is instant
const messageCache: Record<string, Messages> = {};

export function TranslationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const locale = extractLocaleFromPath(pathname);
  const [messages, setMessages] = useState<Messages>(() => messageCache[locale] ?? {});
  const fetchingRef = useRef<string | null>(null);

  useEffect(() => {
    // Already cached in memory
    if (messageCache[locale]) {
      setMessages(messageCache[locale]);
      return;
    }

    // Prevent duplicate fetches for the same locale
    if (fetchingRef.current === locale) return;
    fetchingRef.current = locale;

    fetch(`/_translations/${locale}.json?v=${Date.now()}`)
      .then(res => res.ok ? res.json() : {})
      .then(data => {
        messageCache[locale] = data;
        // Only apply if locale hasn't changed during fetch
        if (fetchingRef.current === locale) {
          setMessages(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (fetchingRef.current === locale) {
          fetchingRef.current = null;
        }
      });
  }, [locale]);

  const t = useMemo(() => {
    return (key: string, params?: Record<string, string | number>): string => {
      const value = getNestedValue(messages, key);
      if (value) return interpolate(value, params);
      return key.split('.').pop() ?? key;
    };
  }, [messages]);

  const contextValue = useMemo(() => ({ locale, messages, t }), [locale, messages, t]);

  return (
    <TranslationContext.Provider value={contextValue}>
      {children}
    </TranslationContext.Provider>
  );
}
