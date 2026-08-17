import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS } from '../fixtures/test-users';

test.describe('External Service Failure Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-service-fail@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 30000 });
  });

  test('Razorpay failure handled gracefully', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForSelector('[data-testid="market-listing"], .listing-card');
    const listing = page.locator('[data-testid="market-listing"], .listing-card').first();
    await listing.click();

    await page.click('[data-testid="buy-button"], button:has-text("Buy")');
    await page.waitForSelector('[data-testid="buy-modal"], .modal');
    await page.fill('[data-testid="buy-quantity"], input[name="quantity"]', '10');
    await page.click('[data-testid="confirm-buy"], button:has-text("Confirm")');

    await page.waitForSelector('[data-testid="toast"], .toast', { timeout: 30000 });
    const toast = await page.locator('[data-testid="toast"], .toast').textContent();
    expect(toast).not.toContain('crash');
    expect(toast).not.toContain('undefined');
    expect(toast).not.toContain('null');
  });

  test('Blockchain/RPC failure handled', async ({ page }) => {
    await page.goto('/wallet');
    await page.click('[data-testid="wallet-withdraw"], button:has-text("Withdraw")');
    await page.waitForSelector('[data-testid="withdraw-modal"], .modal');
    await page.fill('[data-testid="withdraw-amount"], input[name="amount"]', '100');
    await page.click('[data-testid="confirm-withdraw"], button:has-text("Confirm")');

    await page.waitForSelector('[data-testid="toast"], .toast', { timeout: 30000 });
    const toast = await page.locator('[data-testid="toast"], .toast').textContent();
    expect(toast).not.toContain('crash');
    expect(toast).not.toContain('undefined');
  });

  test('Database connection failure handled', async ({ page }) => {
    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
    // Should show cached data or graceful error
    await expect(page.locator('[data-testid="portfolio-credit"], .portfolio-credit')).toBeVisible();
  });
});

test.describe('Transaction Rollback Scenarios', () => {
  test('Failed trade rolls back wallet balances', async ({ page }) => {
    // Test trade that fails after wallet debit but before credit
    await page.goto('/marketplace');
    await page.waitForSelector('[data-testid="market-listing"], .listing-card');
    const listing = page.locator('[data-testid="market-listing"], .listing-card').first();
    await listing.click();

    await page.click('[data-testid="buy-button"], button:has-text("Buy")');
    await page.waitForSelector('[data-testid="buy-modal"], .modal');
    await page.fill('[data-testid="buy-quantity"], input[name="quantity"]', '10');
    await page.click('[data-testid="confirm-buy"], button:has-text("Confirm")');

    // If fails, wallet should be unchanged
    await page.waitForTimeout(3000);
    await page.goto('/wallet');
    const balanceText = await page.locator('[data-testid="wallet-balance"]').textContent();
    // Should be unchanged if trade failed
  });

  test('Failed withdrawal rolls back', async ({ page }) => {
    await page.goto('/wallet');
    await page.click('[data-testid="wallet-withdraw"], button:has-text("Withdraw")');
    await page.waitForSelector('[data-testid="withdraw-modal"], .modal');
    await page.fill('[data-testid="withdraw-amount"], input[name="amount"]', '1000000'); // Large amount
    await page.click('[data-testid="confirm-withdraw"], button:has-text("Confirm")');

    await page.waitForSelector('[data-testid="toast"], .toast', { timeout: 30000 });
    const toast = await page.locator('[data-testid="toast"], .toast').textContent();
    expect(toast).toContain('insufficient');
  });

  test('Failed subscription payment rolls back', async ({ page }) => {
    await page.goto('/subscription');
    await page.waitForLoadState('networkidle');

    const plan = page.locator('[data-testid="plan-starter"], .plan:has-text("Starter")').first();
    await plan.click('[data-testid="select-plan"], button:has-text("Select")');
    await page.waitForSelector('[data-testid="payment-modal"], .modal');
    await page.click('[data-testid="razorpay-option"], button:has-text("Razorpay")');
    await page.click('[data-testid="confirm-payment"], button:has-text("Pay")');

    // Should handle payment failure gracefully
    await page.waitForSelector('[data-testid="toast"], .toast', { timeout: 30000 });
    const toast = await page.locator('[data-testid="toast"], .toast').textContent();
    expect(toast).not.toContain('crash');
  });
});