import { useState, useMemo } from 'react';

export interface BookingDates {
  startDate: string;
  endDate: string;
}

export interface BookingFlowState {
  step: 1 | 2 | 3;
  dates: BookingDates;
  subtotal: number;
  platformFee: number;
  total: number;
  bookingId: string | null;
  setDates: (dates: BookingDates) => void;
  advanceStep: () => void;
  setBookingId: (id: string) => void;
}

function calcSubtotal(pricePerHour: number, dates: BookingDates): number {
  if (!dates.startDate || !dates.endDate) return 0;
  const start = new Date(dates.startDate).getTime();
  const end = new Date(dates.endDate).getTime();
  if (end <= start) return 0;
  const hours = (end - start) / (1000 * 60 * 60);
  return Math.ceil(hours) * pricePerHour;
}

export function useBookingFlow(
  listingId: string,
  pricePerHour: number,
  initialDates?: BookingDates,
): BookingFlowState {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [dates, setDatesState] = useState<BookingDates>(
    initialDates ?? { startDate: '', endDate: '' },
  );
  const [bookingId, setBookingIdState] = useState<string | null>(null);

  const subtotal = useMemo(() => calcSubtotal(pricePerHour, dates), [pricePerHour, dates]);
  const platformFee = useMemo(() => parseFloat((subtotal * 0.15).toFixed(2)), [subtotal]);
  const total = useMemo(() => parseFloat((subtotal + platformFee).toFixed(2)), [subtotal, platformFee]);

  const setDates = (d: BookingDates) => setDatesState(d);

  const advanceStep = () => {
    if (step === 1) setStep(2);
    else if (step === 2 && bookingId) setStep(3);
  };

  const setBookingId = (id: string) => setBookingIdState(id);

  return { step, dates, subtotal, platformFee, total, bookingId, setDates, advanceStep, setBookingId };
}
