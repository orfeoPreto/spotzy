import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './journeys',
  use: {
    baseURL: process.env.STAGING_URL ?? 'https://staging.spotzy.com',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
