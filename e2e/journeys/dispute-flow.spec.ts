import { test, expect } from '@playwright/test';

import path from 'path';
import { TEST_SPOTTER } from '../setup';

test.skip('Spotter opens a dispute via AI chat', async ({ page }) => {
  // 1. Log in as spotter
  await page.goto('/auth/login');
  await page.fill('[data-testid="email-input"]', TEST_SPOTTER.email);
  await page.fill('[data-testid="password-input"]', TEST_SPOTTER.password);
  await page.click('[data-testid="sign-in-btn"]');
  await page.waitForURL(/\/dashboard/);

  // 2. Navigate to spotter dashboard and find a completed booking
  await page.goto('/dashboard/spotter');
  const completedTab = page.getByRole('tab', { name: /completed/i });
  await completedTab.click();

  const completedCard = page.locator('[data-testid="booking-card"]').first();
  await expect(completedCard).toBeVisible({ timeout: 10000 });

  // 3. Click "Report an issue" on the completed booking
  const reportBtn = completedCard.locator('[data-testid="report-issue-btn"]');
  await expect(reportBtn).toBeVisible();
  await reportBtn.click();

  // 4. Verify we're on the dispute page
  await expect(page).toHaveURL(/\/dispute\//);

  // 5. Verify support mode styling (navy tint)
  const disputePage = page.locator('[data-testid="dispute-page"]');
  await expect(disputePage).toBeVisible();

  // 6. Verify initial AI message appears
  await expect(page.locator('[data-testid="ai-message-initial"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-testid="ai-message-initial"]')).toContainText(/hi|hello|help/i);

  // 7. Verify quick-reply chips are displayed
  const chips = page.locator('[data-testid="quick-reply-chip"]');
  await expect(chips).toHaveCount(4);

  // 8. Click "Access problem" quick reply chip
  const accessChip = page.locator('[data-testid="quick-reply-chip"]', { hasText: /access problem/i });
  await expect(accessChip).toBeVisible();
  await accessChip.click();

  // 9. Verify chip text was prefilled in the input
  const messageInput = page.locator('textarea, input[type="text"]').last();
  await expect(messageInput).not.toHaveValue('');

  // 10. Submit the description
  await messageInput.fill('The access code provided did not work and I could not park my car.');
  await page.keyboard.press('Enter');

  // 11. Chips should disappear after first send
  await expect(chips.first()).not.toBeVisible({ timeout: 3000 });

  // 12. Upload a photo as evidence
  const photoFixture = path.join(__dirname, '../fixtures/test-photo.jpg');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(photoFixture);
  await expect(page.locator('[data-testid="evidence-thumbnail"]')).toBeVisible({ timeout: 10000 });

  // 13. Wait for AI summary card to appear
  const summaryCard = page.locator('[data-testid="dispute-summary-card"]');
  await expect(summaryCard).toBeVisible({ timeout: 15000 });
  await expect(summaryCard).toContainText(/access/i);

  // 14. Confirm the dispute submission
  const confirmBtn = summaryCard.locator('button', { hasText: /confirm|submit/i });
  await confirmBtn.click();

  // 15. Verify dispute reference number appears
  await expect(page.locator('[data-testid="escalation-reference"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="escalation-reference"]')).toContainText(/DSP-/);
});
