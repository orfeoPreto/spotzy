import { test, expect } from '@playwright/test';
import path from 'path';
import { TEST_HOST } from '../setup';

test('Host creates and publishes a parking listing', async ({ page }) => {
  // 1. Login as host
  await page.goto('/auth/login');
  await page.fill('[data-testid="email-input"]', TEST_HOST.email);
  await page.fill('[data-testid="password-input"]', TEST_HOST.password);
  await page.click('[data-testid="sign-in-btn"]');
  await page.waitForURL(/\/dashboard\/host/);

  // 2. Navigate to listing wizard
  await page.click('[data-testid="add-listing-btn"]');
  await expect(page).toHaveURL('/listings/new');

  // 3. Step 1 — Enter Brussels address
  const addressInput = page.getByPlaceholder(/address|location|street/i);
  await addressInput.fill('Chaussée de Waterloo 1, Brussels');
  await page.waitForSelector('[data-testid="address-suggestion"]', { timeout: 5000 });
  await page.locator('[data-testid="address-suggestion"]').first().click();

  const nextBtn = page.getByRole('button', { name: /next/i });
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();

  // 4. Step 2 — Select COVERED_GARAGE, set price
  await page.waitForSelector('[data-testid="spot-type-tile"]');
  const garageCard = page.locator('[data-testid="spot-type-tile"]', { hasText: /covered garage/i });
  await garageCard.click();
  await expect(garageCard).toHaveClass(/border-amber/);

  await page.fill('input[type="number"]', '3.50');
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();

  // 5. Step 3 — Upload 2 photos
  await page.waitForSelector('[data-testid="upload-zone"]');
  const photoFixture = path.join(__dirname, '../fixtures/test-photo.jpg');
  const uploadZones = page.locator('[data-testid="upload-zone"] input[type="file"]');

  await uploadZones.nth(0).setInputFiles(photoFixture);
  await uploadZones.nth(1).setInputFiles(photoFixture);

  // Wait for AI validation to pass both photos (PASS status)
  await expect(page.locator('[data-testid="upload-zone"]').nth(0)).toHaveClass(/border-green/, { timeout: 15000 });
  await expect(page.locator('[data-testid="upload-zone"]').nth(1)).toHaveClass(/border-green/, { timeout: 15000 });

  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();

  // 6. Step 4 — Set weekday 8am–8pm availability
  await page.waitForSelector('table');
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const HOURS = ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19'];

  for (const day of DAYS) {
    for (const hour of HOURS) {
      const cell = page.locator(`button[data-day="${day}"][data-hour="${hour}"]`).first();
      if (await cell.count() > 0) await cell.click();
    }
  }

  // 7. Publish
  await page.click('[data-testid="publish-btn"]');
  await expect(page).toHaveURL(/\/dashboard\/host/, { timeout: 15000 });
  await expect(page.locator('text=/your spot is live|listing published/i')).toBeVisible({ timeout: 10000 });

  // 8. Verify listing appears in host dashboard
  await expect(page.locator('[data-testid="listing-card"]').first()).toBeVisible();
});
