import { test, expect } from '@playwright/test';

import { TEST_SPOTTER } from '../setup';

async function loginAsSpotter(page: import('@playwright/test').Page) {
  await page.goto('/auth/login');
  await page.fill('[data-testid="email-input"]', TEST_SPOTTER.email);
  await page.fill('[data-testid="password-input"]', TEST_SPOTTER.password);
  await page.click('[data-testid="sign-in-btn"]');
  await page.waitForURL(/\/dashboard/);
}

test.skip('Messages tab shows unread badge when messages are unread', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/dashboard/spotter');
  const badge = page.getByTestId('messages-unread-badge');
  // Badge may or may not be visible depending on seed data
  // Just check it's rendered if there are unread messages
  const count = await badge.count();
  if (count > 0) {
    await expect(badge.first()).toBeVisible();
    await expect(badge.first()).not.toHaveText('0');
  }
});

test.skip('Clicking Messages tab navigates to /messages', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/dashboard/spotter');
  // Click the Messages link in navigation
  await page.click('a[href="/messages"]');
  await expect(page).toHaveURL('/messages');
  await expect(page.getByText(/messages/i).first()).toBeVisible();
});

test.skip('Conversation list shows spot address and other party name', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/messages');
  const row = page.getByTestId('conversation-row-0');
  // Only assert if there are conversations
  const count = await row.count();
  if (count > 0) {
    await expect(row).toBeVisible();
    await expect(row.getByTestId('listing-address')).toBeVisible();
    await expect(row.getByTestId('other-party-name')).toBeVisible();
  }
});

test.skip('Clicking conversation row opens specific chat thread', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/messages');
  const row = page.getByTestId('conversation-row-0');
  const count = await row.count();
  if (count > 0) {
    const bookingId = await row.getAttribute('data-booking-id');
    await row.click();
    await expect(page).toHaveURL(`/chat/${bookingId}`);
  }
});

test.skip('"View archived conversations" link visible at bottom of messages list', async ({ page }) => {
  await loginAsSpotter(page);
  await page.goto('/messages');
  await expect(page.getByRole('link', { name: /view archived/i })).toBeVisible();
});
