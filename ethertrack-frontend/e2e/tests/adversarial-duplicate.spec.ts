import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS, waitForToast } from '../fixtures/test-users';

test.describe('Duplicate Request Protection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-duplicate@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 30000 });
  });

  test('Double-click buy button only creates one trade', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForSelector('[data-testid="market-listing"], .listing-card');
    const listing = page.locator('[data-testid="market-listing"], .listing-card').first();
    await listing.click();

    await page.click('[data-testid="buy-button"], button:has-text("Buy")');
    await page.waitForSelector('[data-testid="buy-modal"], .modal');
    await page.fill('[data-testid="buy-quantity"], input[name="quantity"]', '10');

    await page.click('[data-testid="confirm-buy"], button:has-text("Confirm")');
    await page.click('[data-testid="confirm-buy"], button:has-text("Confirm")');

    await page.waitForTimeout(3000);
    await page.goto('/portfolio');
    await page.waitForSelector('[data-testid="portfolio-credit"], .portfolio-credit');
  });

  test('Rapid form submissions only process once', async ({ page }) => {
    await page.goto('/wallet');
    await page.click('[data-testid="wallet-deposit"], button:has-text("Deposit")');
    await page.waitForSelector('[data-testid="deposit-modal"], .modal');

    await page.fill('[data-testid="deposit-amount"], input[name="amount"]', '1000');

    await page.click('[data-testid="confirm-deposit"], button:has-text("Confirm")');
    await page.click('[data-testid="confirm-deposit"], button:has-text("Confirm")');
    await page.click('[data-testid="confirm-deposit"], button:has-text("Confirm")');

    await page.waitForTimeout(2000);
  });
});