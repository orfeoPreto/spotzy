import { test, expect } from '@playwright/test';

import { TEST_SPOTTER } from '../setup';

test.skip('Spotter finds and books a parking spot end-to-end', async ({ page }) => {
  // 1. Log in as test spotter
  await page.goto('/auth/login');
  await page.fill('[data-testid="email-input"]', TEST_SPOTTER.email);
  await page.fill('[data-testid="password-input"]', TEST_SPOTTER.password);
  await page.click('[data-testid="sign-in-btn"]');
  await page.waitForURL(/\/search|\/dashboard/);

  // 2. Navigate to search and find a spot in Brussels
  await page.goto('/search');
  await page.fill('[data-testid="destination-input"]', 'Grand Place, Brussels');
  await page.waitForSelector('[data-testid="suggestion-0"]', { timeout: 5000 });
  await page.click('[data-testid="suggestion-0"]');

  // Wait for map pins to appear
  await expect(page.locator('[data-testid="spot-pin"]').first()).toBeVisible({ timeout: 10000 });

  // 3. Select first spot from the results list
  const firstCard = page.locator('[data-testid="spot-summary-card"]').first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();
  await expect(page).toHaveURL(/\/listing\//);

  // 4. Select dates and proceed to booking
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 10);
  const dayAfter = new Date(tomorrow);
  dayAfter.setHours(dayAfter.getHours() + 2);

  const startDateStr = tomorrow.toISOString().slice(0, 16);
  const endDateStr = dayAfter.toISOString().slice(0, 16);

  await page.fill('[data-testid="start-date"]', startDateStr);
  await page.fill('[data-testid="end-date"]', endDateStr);

  const bookBtn = page.locator('[data-testid="book-this-spot"]');
  await expect(bookBtn).toBeEnabled({ timeout: 5000 });
  await bookBtn.click();
  await expect(page).toHaveURL(/\/book\//);

  // 5. Pay with Stripe test card
  await page.waitForSelector('[data-testid="stripe-payment-element"]', { timeout: 15000 });
  const stripeFrame = page.frameLocator('iframe[name*="__privateStripeFrame"]').first();
  await stripeFrame.locator('[placeholder="Card number"]').fill('4242424242424242');
  await stripeFrame.locator('[placeholder="MM / YY"]').fill('12/26');
  await stripeFrame.locator('[placeholder="CVC"]').fill('123');
  await stripeFrame.locator('[placeholder="ZIP"]').fill('10001').catch(() => {}); // optional field

  const payBtn = page.locator('[data-testid="pay-button"]');
  await expect(payBtn).toBeEnabled();
  await payBtn.click();

  // 6. Confirm booking success
  await page.waitForURL(/step=3|confirmation/, { timeout: 30000 });
  await expect(page.locator('[data-testid="booking-reference"]')).toBeVisible();
  await expect(page.locator('[data-testid="success-message"]')).toContainText("You're all parked!");
});
