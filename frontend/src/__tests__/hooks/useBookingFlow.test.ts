import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { useBookingFlow } from '../../../hooks/useBookingFlow';

const LISTING_ID = 'l1';
const PRICE_PER_HOUR = 3.50;
const INITIAL_DATES = {
  startDate: '2025-07-01T10:00',
  endDate: '2025-07-01T12:00',
};

describe('useBookingFlow', () => {
  it('initial state: step=1, dates from initialDates', () => {
    const { result } = renderHook(() =>
      useBookingFlow(LISTING_ID, PRICE_PER_HOUR, INITIAL_DATES),
    );
    expect(result.current.step).toBe(1);
    expect(result.current.dates.startDate).toBe(INITIAL_DATES.startDate);
    expect(result.current.dates.endDate).toBe(INITIAL_DATES.endDate);
  });

  it('setDates() updates dates and recalculates price', () => {
    const { result } = renderHook(() =>
      useBookingFlow(LISTING_ID, PRICE_PER_HOUR, INITIAL_DATES),
    );
    act(() => {
      result.current.setDates({
        startDate: '2025-07-01T10:00',
        endDate: '2025-07-01T14:00', // 4 hours
      });
    });
    expect(result.current.dates.endDate).toBe('2025-07-01T14:00');
    // 4 hours * €3.50 = €14.00
    expect(result.current.subtotal).toBeCloseTo(14.0, 1);
  });

  it('advanceStep() increments step from 1 to 2', () => {
    const { result } = renderHook(() =>
      useBookingFlow(LISTING_ID, PRICE_PER_HOUR, INITIAL_DATES),
    );
    act(() => { result.current.advanceStep(); });
    expect(result.current.step).toBe(2);
  });

  it('cannot advance to step 3 without bookingId set', () => {
    const { result } = renderHook(() =>
      useBookingFlow(LISTING_ID, PRICE_PER_HOUR, INITIAL_DATES),
    );
    act(() => { result.current.advanceStep(); }); // step 2
    act(() => { result.current.advanceStep(); }); // should NOT advance to 3
    expect(result.current.step).toBe(2);
  });

  it('advances to step 3 after bookingId is set', () => {
    const { result } = renderHook(() =>
      useBookingFlow(LISTING_ID, PRICE_PER_HOUR, INITIAL_DATES),
    );
    act(() => { result.current.advanceStep(); }); // step 2
    act(() => { result.current.setBookingId('bk1'); });
    act(() => { result.current.advanceStep(); }); // step 3
    expect(result.current.step).toBe(3);
  });

  it('computes platformFee as 15% of subtotal', () => {
    const { result } = renderHook(() =>
      useBookingFlow(LISTING_ID, PRICE_PER_HOUR, INITIAL_DATES),
    );
    // 2 hours * €3.50 = €7.00 subtotal, 15% = €1.05
    expect(result.current.platformFee).toBeCloseTo(1.05, 2);
    expect(result.current.total).toBeCloseTo(8.05, 2);
  });
});
