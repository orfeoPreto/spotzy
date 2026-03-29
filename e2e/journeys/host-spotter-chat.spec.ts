import { test, expect, Browser } from '@playwright/test';
import { TEST_HOST, TEST_SPOTTER, COMPLETED_BOOKING_ID } from '../setup';

async function loginAs(browser: Browser, email: string, password: string, baseURL: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto('/auth/login');
  await page.fill('[data-testid="email-input"]', email);
  await page.fill('[data-testid="password-input"]', password);
  await page.click('[data-testid="sign-in-btn"]');
  await page.waitForURL(/\/dashboard/);
  return { context, page };
}

test('Host and spotter can exchange messages in real time', async ({ browser, baseURL }) => {
  const base = baseURL ?? 'https://staging.spotzy.com';

  // Open two browser contexts simultaneously
  const { page: hostPage, context: hostCtx } = await loginAs(browser, TEST_HOST.email, TEST_HOST.password, base);
  const { page: spotterPage, context: spotterCtx } = await loginAs(browser, TEST_SPOTTER.email, TEST_SPOTTER.password, base);

  try {
    // Both navigate to the same booking chat thread
    await hostPage.goto(`/chat/${COMPLETED_BOOKING_ID}`);
    await spotterPage.goto(`/chat/${COMPLETED_BOOKING_ID}`);

    await expect(hostPage.locator('main')).toBeVisible();
    await expect(spotterPage.locator('main')).toBeVisible();

    // Host sends "Access code is 1234"
    const accessCode = `Access code is ${Date.now()}`; // unique to avoid flakiness
    await hostPage.fill('[placeholder*="message"]', accessCode);
    await hostPage.keyboard.press('Enter');

    // Spotter receives the message without page reload (WebSocket)
    await expect(spotterPage.locator(`text=${accessCode}`)).toBeVisible({ timeout: 10000 });

    // Spotter replies
    const reply = `Thanks! (${Date.now()})`;
    await spotterPage.fill('[placeholder*="message"]', reply);
    await spotterPage.keyboard.press('Enter');

    // Host receives the reply
    await expect(hostPage.locator(`text=${reply}`)).toBeVisible({ timeout: 10000 });
  } finally {
    await hostCtx.close();
    await spotterCtx.close();
  }
});
