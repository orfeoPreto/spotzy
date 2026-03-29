import { test, expect } from '@playwright/test';
import { TEST_SPOTTER, TEST_HOST } from '../setup';

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

test('Listing card shows host avatar and name in footer', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/search?lat=48.8566&lng=2.3522');
  const card = page.getByTestId('spot-summary-card').first();
  const count = await card.count();
  if (count > 0) {
    await expect(card.getByTestId('host-footer')).toBeVisible();
  }
});

test('Clicking host name in listing card footer opens host profile', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/search?lat=48.8566&lng=2.3522');
  const footer = page.getByTestId('host-footer-link').first();
  const count = await footer.count();
  if (count > 0) {
    await footer.click();
    await expect(page).toHaveURL(/\/users\//);
  }
});

test('Host footer NOT shown on own listings', async ({ page }) => {
  await loginAsHost(page);
  await page.goto('/dashboard/host');
  const ownCard = page.getByTestId('spot-summary-card').first();
  const count = await ownCard.count();
  if (count > 0) {
    await expect(ownCard.getByTestId('host-footer')).not.toBeVisible();
  }
});
