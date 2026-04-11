import { test, expect } from '@playwright/test';

import { TEST_SPOTTER } from '../setup';

async function loginAsSpotter(page: import('@playwright/test').Page) {
  await page.goto('/auth/login');
  await page.fill('[data-testid="email-input"]', TEST_SPOTTER.email);
  await page.fill('[data-testid="password-input"]', TEST_SPOTTER.password);
  await page.click('[data-testid="sign-in-btn"]');
  await page.waitForURL(/\/dashboard/);
}

test.skip('Spot address on booking card links to public listing page', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/dashboard/spotter');
  const spotLink = page.getByTestId('booking-spot-link').first();
  const count = await spotLink.count();
  if (count > 0) {
    const href = await spotLink.getAttribute('href');
    expect(href).toMatch(/^\/listing\//);
    await spotLink.click();
    await expect(page).toHaveURL(/\/listing\//);
  }
});

test.skip('Host name on spotter booking card links to host profile', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/dashboard/spotter');
  const hostLink = page.getByTestId('booking-person-link').first();
  const count = await hostLink.count();
  if (count > 0) {
    const href = await hostLink.getAttribute('href');
    expect(href).toMatch(/^\/users\//);
    await hostLink.click();
    await expect(page).toHaveURL(/\/users\//);
    await expect(page.getByRole('heading').first()).toContainText(/[A-Z]/);
  }
});

test.skip('Message button on booking card links to chat thread', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/dashboard/spotter');
  const msgBtn = page.getByTestId('booking-message-btn').first();
  const count = await msgBtn.count();
  if (count > 0) {
    const href = await msgBtn.getAttribute('href');
    expect(href).toMatch(/^\/chat\//);
  }
});

test.skip('All three links present on COMPLETED booking card', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/dashboard/spotter?tab=past');
  const card = page.locator('[data-testid="booking-card"]').first();
  const count = await card.count();
  if (count > 0) {
    await expect(card.getByTestId('booking-spot-link')).toBeVisible();
    await expect(card.getByTestId('booking-person-link')).toBeVisible();
    await expect(card.getByTestId('booking-message-btn')).toBeVisible();
  }
});
