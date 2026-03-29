import { ulid } from 'ulid';
export const buildListing = (overrides: Record<string, unknown> = {}) => ({
  listingId: ulid(),
  hostId: 'test-host-1',
  address: 'Rue de la Loi 1, Brussels',
  addressLat: 50.8503,
  addressLng: 4.3517,
  spotType: 'COVERED_GARAGE',
  dimensions: 'STANDARD',
  evCharging: false,
  pricePerHour: 3.50,
  minDurationHours: 1,
  maxDurationHours: 720,
  reclaimNoticeHours: 2,
  status: 'live',
  availabilityWindows: [{ dayOfWeek: '*', startTime: '00:00', endTime: '23:59' }],
  ...overrides,
});
