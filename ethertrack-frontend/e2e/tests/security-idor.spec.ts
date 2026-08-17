import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS, generateUniqueEmail, waitForToast } from '../fixtures/test-users';

test.describe('Security & IDOR Protection', () => {
  test.describe('Unauthorized Access Prevention', () => {
    test('Unauthenticated user cannot access dashboard', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForURL(/login/, { timeout: WAIT_TIMEOUTS.medium });
      await expect(page.locator('[data-testid="login-email"], input[name="email"]')).toBeVisible();
    });

    test('Unauthenticated user cannot access marketplace actions', async ({ page }) => {
      await page.goto('/marketplace');
      await page.waitForSelector('[data-testid="market-listing"], .listing-card');
      const listing = page.locator('[data-testid="market-listing"], .listing-card').first();
      await listing.click();

      await page.click('[data-testid="buy-button"], button:has-text("Buy")');
      await page.waitForURL(/login/, { timeout: WAIT_TIMEOUTS.medium });
    });

    test('User cannot access admin panel', async ({ page }) => {
      await page.goto('/login');
      await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-regular@example.com');
      await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
      await page.click('[data-testid="login-button"], button[type="submit"]');
      await page.waitForURL('/dashboard', { timeout: WAIT_TIMEOUTS.long });

      await page.goto('/admin');
      await page.waitForURL(/login|403|404/, { timeout: WAIT_TIMEOUTS.medium });
    });

    test('User cannot access other user portfolio', async ({ page }) => {
      await page.goto('/portfolio/other-user-id');
      await page.waitForURL(/login|403|404/, { timeout: WAIT_TIMEOUTS.medium });
    });
  });

  test.describe('IDOR Protection', () => {
    test('Cannot access other user trade details', async ({ page }) => {
      await page.goto('/trades/other-trade-id');
      await page.waitForURL(/login|403|404/, { timeout: WAIT_TIMEOUTS.medium });
    });

    test('Cannot access other user wallet', async ({ page }) => {
      await page.goto('/wallet/other-user-id');
      await page.waitForURL(/login|403|404/, { timeout: WAIT_TIMEOUTS.medium });
    });
  });
});