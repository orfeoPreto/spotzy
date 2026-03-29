import { ulid } from 'ulid';
export const buildBooking = (overrides: Record<string, unknown> = {}) => ({
  bookingId: ulid(),
  listingId: 'listing-1',
  spotterId: 'spotter-1',
  hostId: 'host-1',
  startTime: new Date(Date.now() + 86400000).toISOString(),
  endTime: new Date(Date.now() + 86400000 + 7200000).toISOString(),
  totalPrice: 7.00,
  platformFeePercent: 15,
  hostPayout: 5.95,
  status: 'CONFIRMED',
  cancellationPolicy: { gt48h: 100, between24and48h: 50, lt24h: 0 },
  version: 1,
  ...overrides,
});
