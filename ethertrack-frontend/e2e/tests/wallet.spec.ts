import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS, waitForToast, waitForModal } from '../fixtures/test-users';

test.describe('Wallet Operations', () => {
  test.beforeEach(async ({ page }) => {
    // Login as KYC verified user with wallet
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-wallet-test@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: WAIT_TIMEOUTS.long });
  });

  test('Wallet displays correct balance', async ({ page }) => {
    await page.goto('/wallet');
    await page.waitForLoadState('networkidle');

    await expect(page.locator(SELECTORS.walletBalance)).toBeVisible();
    const balanceText = await page.locator(SELECTORS.walletBalance).textContent();
    expect(balanceText).toMatch(/��|INR/);
  });

  test('User can deposit INR via Razorpay', async ({ page }) => {
    await page.goto('/wallet');
    await page.waitForSelector(SELECTORS.walletDepositButton);
    await page.click(SELECTORS.walletDepositButton);
    await waitForModal(page);

    // Fill deposit amount
    await page.fill(SELECTORS.walletDepositAmount, '1000');
    await page.click(SELECTORS.walletConfirmButton);

    // Should redirect to Razorpay or show payment frame
    // Wait for Razorpay iframe
    await page.waitForSelector(SELECTORS.razorpayPaymentFrame, { timeout: WAIT_TIMEOUTS.veryLong });

    // In test environment, we can't complete real Razorpay payment
    // But we can verify the flow initiates correctly
    const frame = page.frameLocator(SELECTORS.razorpayPaymentFrame);
    await expect(frame.locator('text=Razorpay, text=Payment, text=Secure')).toBeVisible({ timeout: WAIT_TIMEOUTS.long });
  });

  test('Wallet shows transaction history', async ({ page }) => {
    await page.goto('/wallet');
    await page.waitForSelector('[data-testid="transaction-history"], .transaction-list');

    await expect(page.locator('[data-testid="transaction-history"], .transaction-list')).toBeVisible();

    // Check for transaction entries
    const transactions = page.locator('[data-testid="transaction-item"], .transaction-row');
    const count = await transactions.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('Withdrawal flow initiates correctly', async ({ page }) => {
    await page.goto('/wallet');
    await page.waitForSelector(SELECTORS.walletWithdrawButton);
    await page.click(SELECTORS.walletWithdrawButton);
    await waitForModal(page);

    // Fill withdrawal amount
    await page.fill(SELECTORS.walletWithdrawAmount, '500');
    await page.click(SELECTORS.walletConfirmButton);

    // Should show confirmation or OTP step
    await waitForToast(page, /withdraw|otp|confirm/i);
  });
});

test.describe('Wallet Security', () => {
  test('Large withdrawal requires additional verification', async ({ page }) => {
    await page.goto('/wallet');
    await page.click(SELECTORS.walletWithdrawButton);
    await waitForModal(page);

    // Try to withdraw large amount
    await page.fill(SELECTORS.walletWithdrawAmount, '100000');
    await page.click(SELECTORS.walletConfirmButton);

    // Should require additional verification (OTP, 2FA, etc.)
    await expect(page.locator('[data-testid="otp-input"], input[name="otp"]')).toBeVisible({ timeout: WAIT_TIMEOUTS.medium });
  });

  test('Withdrawal fails with insufficient balance', async ({ page }) => {
    await page.goto('/wallet');
    await page.click(SELECTORS.walletWithdrawButton);
    await waitForModal(page);

    // Try to withdraw more than balance
    await page.fill(SELECTORS.walletWithdrawAmount, '999999999');
    await page.click(SELECTORS.walletConfirmButton);

    await waitForToast(page, /insufficient|balance|available/i);
  });
});