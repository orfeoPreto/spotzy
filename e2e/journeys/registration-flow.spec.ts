import { test, expect } from '@playwright/test';

test('Host registration shows Stripe gate after persona selection', async ({ page }) => {
  await page.goto('/auth/register');
  await page.click('[data-testid="persona-host"]');
  await page.click('[data-testid="continue-btn"]');
  await expect(page.getByText(/set up your payout account/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /continue to stripe/i })).toBeVisible();
});

test('Guest registration skips Stripe gate, shows profile form directly', async ({ page }) => {
  await page.goto('/auth/register');
  await page.click('[data-testid="persona-guest"]');
  await page.click('[data-testid="continue-btn"]');
  await expect(page.getByLabel(/first name/i)).toBeVisible();
  await expect(page.queryByText(/payout account/i)).not.toBeVisible();
});

test('Host can skip Stripe and proceed to profile form', async ({ page }) => {
  await page.goto('/auth/register');
  await page.click('[data-testid="persona-host"]');
  await page.click('[data-testid="continue-btn"]');
  await page.click('button:has-text("Skip for now")');
  await expect(page.getByLabel(/first name/i)).toBeVisible();
  await expect(page.getByTestId('payout-incomplete-banner')).toBeVisible();
});
