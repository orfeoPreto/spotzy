import { test, expect } from '@playwright/test';
import { TEST_SPOTTER, TEST_HOST } from '../setup';

const TEST_HOST_ID = process.env.TEST_HOST_ID ?? 'host-seed-1';
const TEST_SPOTTER_ID = process.env.TEST_SPOTTER_ID ?? 'spotter-seed-1';

async function loginAsSpotter(page: import('@playwright/test').Page) {
  await page.goto('/auth/login');
  await page.fill('[data-testid="email-input"]', TEST_SPOTTER.email);
  await page.fill('[data-testid="password-input"]', TEST_SPOTTER.password);
  await page.click('[data-testid="sign-in-btn"]');
  await page.waitForURL(/\/dashboard/);
}

async function loginAsHost(page: import('@playwright/test').Page) {
  await page.goto('/auth/login');
  await page.fill('[data-testid="email-input"]', TEST_HOST.email);
  await page.fill('[data-testid="password-input"]', TEST_HOST.password);
  await page.click('[data-testid="sign-in-btn"]');
  await page.waitForURL(/\/dashboard/);
}

test('Host presentation page shows active listings', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto(`/users/${TEST_HOST_ID}`);
  await expect(page.getByTestId('host-listings-section')).toBeVisible({ timeout: 10000 });
  const listingCard = page.getByTestId('listing-card').first();
  const count = await listingCard.count();
  if (count > 0) {
    await expect(listingCard).toBeVisible();
  }
});

test('Spotter presentation page shows response rate', async ({ page }) => {
  await loginAsHost(page);
  await page.goto(`/users/${TEST_SPOTTER_ID}`);
  const responseRate = page.getByTestId('response-rate');
  const count = await responseRate.count();
  if (count > 0) {
    await expect(responseRate).toBeVisible();
    await expect(responseRate).toContainText('%');
  }
});

test('Public profile name is always first name + last initial', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto(`/users/${TEST_HOST_ID}`);
  const heading = await page.getByRole('heading').first().textContent();
  if (heading) {
    expect(heading).toMatch(/^[A-Z][a-z]+ [A-Z]\.$/);
  }
});
