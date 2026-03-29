'use client';

const STORAGE_KEY = 'bookingIntent';

export interface BookingIntent {
  listingId: string;
  startTime: string;
  endTime: string;
  listingData?: {
    address: string;
    primaryPhotoUrl: string | null;
    pricePerHour: number | null;
    spotType: string;
    hostName: string;
  };
}

export function useBookingIntent() {
  const saveIntent = (intent: BookingIntent) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
    } catch {
      // sessionStorage unavailable (private browsing)
    }
  };

  const getRedirectUrl = (intent: BookingIntent): string => {
    const params = new URLSearchParams({
      next: 'checkout',
      listingId: intent.listingId,
      start: intent.startTime,
      end: intent.endTime,
    });
    return `/auth/login?${params.toString()}`;
  };

  const readIntent = (): BookingIntent | null => {
    // 1. Try sessionStorage first (has full listingData)
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}

    // 2. Fall back to URL params (partial intent — no listingData)
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const listingId = params.get('listingId');
    const startTime = params.get('start');
    const endTime = params.get('end');
    if (listingId && startTime && endTime) {
      return { listingId, startTime, endTime };
    }

    return null;
  };

  const clearIntent = () => {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  };

  return { saveIntent, getRedirectUrl, readIntent, clearIntent };
}
