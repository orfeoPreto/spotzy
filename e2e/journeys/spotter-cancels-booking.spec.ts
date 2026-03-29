import { test, expect } from '@playwright/test';
import { TEST_SPOTTER } from '../setup';

test('Spotter cancels an upcoming booking and receives correct refund', async ({ page }) => {
  // 1. Log in as spotter
  await page.goto('/auth/login');
  await page.fill('[data-testid="email-input"]', TEST_SPOTTER.email);
  await page.fill('[data-testid="password-input"]', TEST_SPOTTER.password);
  await page.click('[data-testid="sign-in-btn"]');
  await page.waitForURL(/\/dashboard/);

  // 2. Navigate to spotter dashboard
  await page.goto('/dashboard/spotter');
  await expect(page.locator('h1')).toContainText(/my bookings/i);

  // 3. Find an upcoming booking (>48h away → full refund)
  const upcomingTab = page.getByRole('tab', { name: /upcoming/i });
  await upcomingTab.click();

  const cancelBtn = page.locator('[data-testid="cancel-booking-btn"]').first();
  await expect(cancelBtn).toBeVisible({ timeout: 5000 });

  // Note the total price shown on the booking card
  const bookingCard = page.locator('[data-testid="booking-card"]').first();
  const totalText = await bookingCard.locator('[data-testid="booking-total"]').textContent();

  // 4. Click cancel and verify refund amount shown
  await cancelBtn.click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await expect(page.locator('[role="dialog"]')).toContainText(/refund/i);

  // Refund amount = 100% of total (>48h ahead)
  if (totalText) {
    const amountMatch = totalText.match(/[\d.]+/);
    if (amountMatch) {
      await expect(page.locator('[role="dialog"]')).toContainText(amountMatch[0]);
    }
  }

  // 5. Confirm cancellation
  await page.click('[aria-label="Yes, cancel"]');
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 });

  // 6. Verify booking no longer appears in upcoming tab
  await expect(bookingCard).not.toBeVisible({ timeout: 5000 });
});
