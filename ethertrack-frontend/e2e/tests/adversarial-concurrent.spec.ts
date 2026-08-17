import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS } from '../fixtures/test-users';

test.describe('Concurrent Operations', () => {
  test('Simultaneous buy attempts for last credit', async ({ page, context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await page1.goto('/login');
    await page1.fill('[data-testid="login-email"], input[name="email"]', 'e2e-concurrent-buy1@example.com');
    await page1.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page1.click('[data-testid="login-button"], button[type="submit"]');
    await page1.waitForURL('/dashboard', { timeout: 30000 });

    await page2.goto('/login');
    await page2.fill('[data-testid="login-email"], input[name="email"]', 'e2e-concurrent-buy2@example.com');
    await page2.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page2.click('[data-testid="login-button"], button[type="submit"]');
    await page2.waitForURL('/dashboard', { timeout: 30000 });

    await page1.goto('/marketplace');
    await page1.waitForSelector('[data-testid="market-listing"], .listing-card');
    const listing = page1.locator('[data-testid="market-listing"], .listing-card').first();
    await listing.click();

    await page2.goto('/marketplace');
    await page2.waitForSelector('[data-testid="market-listing"], .listing-card');
    const listing2 = page2.locator('[data-testid="market-listing"], .listing-card').first();
    await listing2.click();

    await Promise.all([
      page1.click('[data-testid="buy-button"], button:has-text("Buy")'),
      page2.click('[data-testid="buy-button"], button:has-text("Buy")'),
    ]);

    await Promise.all([
      page1.waitForSelector('[data-testid="buy-modal"], .modal'),
      page2.waitForSelector('[data-testid="buy-modal"], .modal'),
    ]);

    await Promise.all([
      page1.fill('[data-testid="buy-quantity"], input[name="quantity"]', '1'),
      page2.fill('[data-testid="buy-quantity"], input[name="quantity"]', '1'),
    ]);

    await Promise.all([
      page1.click('[data-testid="confirm-buy"], button:has-text("Confirm")'),
      page2.click('[data-testid="confirm-buy"], button:has-text("Confirm")'),
    ]);

    const results = await Promise.all([
      page1.waitForSelector('[data-testid="toast"], .toast', { timeout: 30000 }),
      page2.waitForSelector('[data-testid="toast"], .toast', { timeout: 30000 }),
    ]);

    const messages = await Promise.all([
      results[0].textContent(),
      results[1].textContent(),
    ]);

    const successCount = messages.filter(m => m?.includes('success') || m?.includes('bought') || m?.includes('purchased')).length;
    const failCount = messages.filter(m => m?.includes('available') || m?.includes('exceed') || m?.includes('failed')).length;
    
    expect(successCount + failCount).toBe(2);
    expect(successCount).toBeLessThanOrEqual(1);
  });

  test('Simultaneous wallet deposits', async ({ page, context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    for (const p of [page1, page2]) {
      await p.goto('/login');
      await p.fill('[data-testid="login-email"], input[name="email"]', 'e2e-wallet-deposit@example.com');
      await p.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
      await p.click('[data-testid="login-button"], button[type="submit"]');
      await p.waitForURL('/dashboard', { timeout: 30000 });
    }

    for (const p of [page1, page2]) {
      await p.goto('/wallet');
      await p.click('[data-testid="wallet-deposit"], button:has-text("Deposit")');
      await p.waitForSelector('[data-testid="deposit-modal"], .modal');
      await p.fill('[data-testid="deposit-amount"], input[name="amount"]', '1000');
      await p.click('[data-testid="confirm-deposit"], button:has-text("Confirm")');
    }

    await Promise.all([
      page1.waitForSelector('[data-testid="toast"], .toast', { timeout: 30000 }),
      page2.waitForSelector('[data-testid="toast"], .toast', { timeout: 30000 }),
    ]);
  });

  test('Simultaneous withdrawals from same wallet', async ({ page, context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    for (const p of [page1, page2]) {
      await p.goto('/login');
      await p.fill('[data-testid="login-email"], input[name="email"]', 'e2e-withdraw-concurrent@example.com');
      await p.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
      await p.click('[data-testid="login-button"], button[type="submit"]');
      await p.waitForURL('/dashboard', { timeout: 30000 });
    }

    for (const p of [page1, page2]) {
      await p.goto('/wallet');
      await p.click('[data-testid="wallet-withdraw"], button:has-text("Withdraw")');
      await p.waitForSelector('[data-testid="withdraw-modal"], .modal');
      await p.fill('[data-testid="withdraw-amount"], input[name="amount"]', '500');
      await p.click('[data-testid="confirm-withdraw"], button:has-text("Confirm")');
    }

    const results = await Promise.all([
      page1.waitForSelector('[data-testid="toast"], .toast', { timeout: 30000 }),
      page2.waitForSelector('[data-testid="toast"], .toast', { timeout: 30000 }),
    ]);

    const messages = await Promise.all([
      results[0].textContent(),
      results[2].textContent(),
    ]);

    const successCount = messages.filter(m => m?.includes('success') || m?.includes('withdrawn')).length;
    const failCount = messages.filter(m => m?.includes('insufficient') || m?.includes('balance')).length;
    
    expect(successCount + failCount).toBe(2);
  });
});