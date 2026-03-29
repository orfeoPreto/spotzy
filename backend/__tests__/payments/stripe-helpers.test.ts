import { toStripeAmount, calculatePlatformFee } from '../../functions/payments/shared/stripe-helpers';

describe('toStripeAmount', () => {
  it('€7.00 → 700', () => expect(toStripeAmount(7.00)).toBe(700));
  it('€3.33 → 333', () => expect(toStripeAmount(3.33)).toBe(333));
  it('€0.01 → 1', () => expect(toStripeAmount(0.01)).toBe(1));
  it('€100.00 → 10000', () => expect(toStripeAmount(100.00)).toBe(10000));
  it('€9.999 → 1000 (rounds to €10.00)', () => expect(toStripeAmount(9.999)).toBe(1000));
});

describe('calculatePlatformFee', () => {
  it('700 → 105', () => expect(calculatePlatformFee(700)).toBe(105));
  it('333 → 49 (floor)', () => expect(calculatePlatformFee(333)).toBe(49));
  it('10000 → 1500', () => expect(calculatePlatformFee(10000)).toBe(1500));
});
