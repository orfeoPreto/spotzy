'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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

export function TranslationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<Messages>({});
  const [locale, setLocale] = useState(DEFAULT_LOCALE);

  // Extract locale from URL
  useEffect(() => {
    const segments = pathname.split('/').filter(Boolean);
    const urlLocale = (SUPPORTED_LOCALES as readonly string[]).includes(segments[0])
      ? segments[0]
      : DEFAULT_LOCALE;
    setLocale(urlLocale);
  }, [pathname]);

  // Load translations when locale changes
  useEffect(() => {
    if (!locale) return;
    fetch(`/_translations/${locale}.json`)
      .then(res => res.ok ? res.json() : {})
      .then(setMessages)
      .catch(() => setMessages({}));
  }, [locale]);

  const t = (key: string, params?: Record<string, string | number>): string => {
    const value = getNestedValue(messages, key);
    if (value) return interpolate(value, params);
    // Fallback: return the last segment of the key as readable text
    return key.split('.').pop() ?? key;
  };

  return (
    <TranslationContext.Provider value={{ locale, messages, t }}>
      {children}
    </TranslationContext.Provider>
  );
}
