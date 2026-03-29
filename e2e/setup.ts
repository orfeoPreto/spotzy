export const TEST_SPOTTER = {
  email: 'spotter@test.spotzy.com',
  password: process.env.TEST_SPOTTER_PASSWORD ?? 'TestPassword123!',
};

export const TEST_HOST = {
  email: 'host@test.spotzy.com',
  password: process.env.TEST_HOST_PASSWORD ?? 'TestPassword123!',
};

export const TEST_SPOTTER_2 = {
  email: 'spotter2@test.spotzy.com',
  password: process.env.TEST_SPOTTER_2_PASSWORD ?? 'TestPassword123!',
};

/** Completed booking ID pre-seeded for review/dispute tests */
export const COMPLETED_BOOKING_ID = process.env.COMPLETED_BOOKING_ID ?? 'bk-seed-completed';
