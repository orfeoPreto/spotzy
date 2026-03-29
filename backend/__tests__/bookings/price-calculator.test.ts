import { calculatePrice, NoPriceConfiguredError } from '../../functions/bookings/shared/price-calculator';

const hours = (n: number) => new Date(Date.now() + n * 3600000).toISOString();
const makeRange = (offsetHours: number, durationHours: number) => ({
  start: new Date(Date.now() + offsetHours * 3600000).toISOString(),
  end: new Date(Date.now() + offsetHours * 3600000 + durationHours * 3600000).toISOString(),
});

describe('calculatePrice', () => {
  it('1h at €3/hr → €3.00', () => {
    const r = makeRange(24, 1);
    expect(calculatePrice({ pricePerHour: 3 }, r.start, r.end)).toBe(3.00);
  });

  it('1.5h at €3/hr → €4.50 (rounds up to 2h)', () => {
    const r = makeRange(24, 1.5);
    expect(calculatePrice({ pricePerHour: 3 }, r.start, r.end)).toBe(6.00);
  });

  it('24h with daily rate €15 → €15.00', () => {
    const r = makeRange(24, 24);
    expect(calculatePrice({ pricePerDay: 15 }, r.start, r.end)).toBe(15.00);
  });

  it('25h with daily rate €15 → €30.00 (rounds up to 2 days)', () => {
    const r = makeRange(24, 25);
    expect(calculatePrice({ pricePerDay: 15 }, r.start, r.end)).toBe(30.00);
  });

  it('30 days with monthly rate €200 → €200.00', () => {
    const r = makeRange(24, 30 * 24);
    expect(calculatePrice({ pricePerMonth: 200 }, r.start, r.end)).toBe(200.00);
  });

  it('31 days with monthly rate €200 → €400.00 (rounds up to 2 months)', () => {
    const r = makeRange(24, 31 * 24);
    expect(calculatePrice({ pricePerMonth: 200 }, r.start, r.end)).toBe(400.00);
  });

  it('2h with no hourly rate, daily rate €15 → €15.00 (1 day minimum)', () => {
    const r = makeRange(24, 2);
    expect(calculatePrice({ pricePerDay: 15 }, r.start, r.end)).toBe(15.00);
  });

  it('no rates → throws NoPriceConfiguredError', () => {
    const r = makeRange(24, 2);
    expect(() => calculatePrice({}, r.start, r.end)).toThrow(NoPriceConfiguredError);
  });
});
