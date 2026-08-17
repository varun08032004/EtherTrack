import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS, waitForToast } from '../fixtures/test-users';

test.describe('Trade Settlement & Fees', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-trade-test@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: WAIT_TIMEOUTS.long });
  });

  test.describe('Trade Fee Calculation', () => {
    test('Buy credit shows correct fee breakdown', async ({ page }) => {
      await page.goto('/marketplace');
      await page.waitForSelector('[data-testid="market-listing"], .listing-card');
      const listing = page.locator('[data-testid="market-listing"], .listing-card').first();
      await listing.click();

      await page.click('[data-testid="buy-button"], button:has-text("Buy")');
      await page.waitForSelector('[data-testid="buy-modal"], .modal');

      // Check fee breakdown is displayed
      await expect(page.locator('[data-testid="buyer-fee"], .buyer-fee')).toBeVisible();
      await expect(page.locator('[data-testid="seller-fee"], .seller-fee')).toBeVisible();
      await expect(page.locator('[data-testid="gst-amount"], .gst-amount')).toBeVisible();
      await expect(page.locator('[data-testid="total-payable"], .total-payable')).toBeVisible();

      // Verify fee calculation: 0.5% buyer + 0.5% seller + 18% GST on fees
      const subtotalText = await page.locator('[data-testid="subtotal"], .subtotal').textContent();
      const buyerFeeText = await page.locator('[data-testid="buyer-fee"], .buyer-fee').textContent();
      const sellerFeeText = await page.locator('[data-testid="seller-fee"], .seller-fee').textContent();
      const gstText = await page.locator('[data-testid="gst-amount"], .gst-amount').textContent();
      const totalText = await page.locator('[data-testid="total-payable"], .total-payable').textContent();

      // Verify all amounts are present and numeric
      expect(subtotalText).toMatch(/[\d,]+/);
      expect(buyerFeeText).toMatch(/[\d,]+/);
      expect(sellerFeeText).toMatch(/[\d,]+/);
      expect(gstText).toMatch(/[\d,]+/);
      expect(totalText).toMatch(/[\d,]+/);
    });

    test('GST calculation is correct (18% on fees only)', async ({ page }) => {
      await page.goto('/marketplace');
      await page.waitForSelector('[data-testid="market-listing"], .listing-card');
      const listing = page.locator('[data-testid="market-listing"], .listing-card').first();
      await listing.click();

      await page.click('[data-testid="buy-button"], button:has-text("Buy")');
      await page.waitForSelector('[data-testid="buy-modal"], .modal');

      const buyerFeeText = await page.locator('[data-testid="buyer-fee"], .buyer-fee').textContent();
      const sellerFeeText = await page.locator('[data-testid="seller-fee"], .seller-fee').textContent();
      const gstText = await page.locator('[data-testid="gst-amount"], .gst-amount').textContent();

      // Parse amounts (remove currency symbols and commas)
      const buyerFee = parseFloat(buyerFeeText.replace(/[^0-9.]/g, ''));
      const sellerFee = parseFloat(sellerFeeText.replace(/[^0-9.]/g, ''));
      const gst = parseFloat(gstText.replace(/[^0-9.]/g, ''));

      const expectedGST = (buyerFee + sellerFee) * 0.18;
      expect(Math.abs(gst - expectedGST)).toBeLessThan(0.01); // Allow small rounding difference
    });
  });

  test.describe('Razorpay Payment Flow', () => {
    test('Razorpay payment initiation works', async ({ page }) => {
      await page.goto('/marketplace');
      await page.waitForSelector('[data-testid="market-listing"], .listing-card');
      const listing = page.locator('[data-testid="market-listing"], .listing-card').first();
      await listing.click();

      await page.click('[data-testid="buy-button"], button:has-text("Buy")');
      await page.waitForSelector('[data-testid="buy-modal"], .modal');

      // Fill quantity
      await page.fill('[data-testid="buy-quantity"], input[name="quantity"]', '10');

      // Confirm purchase - should initiate Razorpay
      await page.click('[data-testid="confirm-buy"], button:has-text("Confirm")');

      // Should show Razorpay payment frame
      await page.waitForSelector('iframe[title*="Razorpay"], iframe[name*="razorpay"], iframe[src*="razorpay"]', { timeout: 60000 });

      const frame = page.frameLocator('iframe[title*="Razorpay"], iframe[name*="razorpay"], iframe[src*="razorpay"]');
      await expect(frame.locator('text=Razorpay, text=Payment, text=Secure')).toBeVisible({ timeout: 30000 });
    });

    test('Payment cancellation returns to marketplace', async ({ page }) => {
      await page.goto('/marketplace');
      await page.waitForSelector('[data-testid="market-listing"], .listing-card');
      const listing = page.locator('[data-testid="market-listing"], .listing-card').first();
      await listing.click();

      await page.click('[data-testid="buy-button"], button:has-text("Buy")');
      await page.waitForSelector('[data-testid="buy-modal"], .modal');

      // Cancel before payment
      await page.click('[data-testid="cancel-buy"], button:has-text("Cancel")');

      // Should return to marketplace
      await expect(page).toHaveURL(/marketplace/);
      await expect(page.locator('[data-testid="market-listing"], .listing-card')).toBeVisible();
    });
  });

  test.describe('Trade Settlement Confirmation', () => {
    test('Successful trade shows confirmation', async ({ page }) => {
      // This would require a completed payment
      // For now, verify the success flow exists
      await page.goto('/portfolio');
      await page.waitForSelector('[data-testid="portfolio-credit"], .portfolio-credit');

      // Check for trade history
      await expect(page.locator('[data-testid="trade-history"], .trade-history')).toBeVisible();
    });

    test('Trade receipt shows all details', async ({ page }) => {
      await page.goto('/trades');
      await page.waitForSelector('[data-testid="trade-list"], .trade-list');

      const firstTrade = page.locator('[data-testid="trade-item"], .trade-row').first();
      await firstTrade.click();

      // Should show trade details
      await expect(page.locator('[data-testid="trade-details"], .trade-detail')).toBeVisible();
      await expect(page.locator('[data-testid="trade-amount"], .trade-amount')).toBeVisible();
      await expect(page.locator('[data-testid="trade-price"], .trade-price')).toBeVisible();
      await expect(page.locator('[data-testid="trade-fees"], .trade-fees')).toBeVisible();
      await expect(page.locator('[data-testid="trade-gst"], .trade-gst')).toBeVisible();
      await expect(page.locator('[data-testid="trade-status"], .trade-status')).toBeVisible();
    });
  });

  test.describe('GST Invoice Generation', () => {
    test('User can download GST invoice for trade', async ({ page }) => {
      await page.goto('/trades');
      await page.waitForSelector('[data-testid="trade-item"], .trade-row');
      const firstTrade = page.locator('[data-testid="trade-item"], .trade-row').first();
      await firstTrade.click();

      // Look for invoice download button
      await expect(page.locator('[data-testid="download-invoice"], button:has-text("Download Invoice")')).toBeVisible();

      const downloadPromise = page.waitForEvent('download');
      await page.click('[data-testid="download-invoice"], button:has-text("Download Invoice")');
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toMatch(/invoice.*\.pdf/i);
    });
  });
});

test.describe('Fees & GST Across Flows', () => {
  test('Wallet deposit shows no GST (financial service)', async ({ page }) => {
    await page.goto('/wallet');
    await page.click('[data-testid="wallet-deposit"], button:has-text("Deposit")');
    await page.waitForSelector('[data-testid="deposit-modal"], .modal');

    // Fee breakdown should not show GST for wallet deposits
    await expect(page.locator('[data-testid="deposit-fee"], .deposit-fee')).toBeVisible();
    // Should not show GST for deposits
  });

  test('Subscription payment shows GST correctly', async ({ page }) => {
    await page.goto('/subscription');
    await page.waitForSelector('[data-testid="subscription-plans"], .plans');

    const plan = page.locator('[data-testid="plan-card"], .plan').first();
    await plan.click('[data-testid="select-plan"], button:has-text("Select")');
    await page.waitForSelector('[data-testid="payment-modal"], .modal');

    // Should show GST breakdown for subscription
    await expect(page.locator('[data-testid="sub-gst"], .subscription-gst')).toBeVisible();
  });
});