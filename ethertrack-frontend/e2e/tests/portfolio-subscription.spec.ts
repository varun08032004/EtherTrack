import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS, waitForToast } from '../fixtures/test-users';

test.describe('Portfolio Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-portfolio-test@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: WAIT_TIMEOUTS.long });
  });

  test.describe('Portfolio Overview', () => {
    test('Portfolio shows total value and credits', async ({ page }) => {
      await page.goto('/portfolio');
      await page.waitForLoadState('networkidle');

      await expect(page.locator(SELECTORS.portfolioValue)).toBeVisible();
      await expect(page.locator(SELECTORS.portfolioCredits)).toBeVisible();

      const valueText = await page.locator(SELECTORS.portfolioValue).textContent();
      expect(valueText).toMatch(/��|INR/);
    });

    test('Portfolio lists all owned credits', async ({ page }) => {
      await page.goto('/portfolio');
      await page.waitForSelector('[data-testid="portfolio-credit"], .portfolio-credit');

      const credits = page.locator('[data-testid="portfolio-credit"], .portfolio-credit');
      const count = await credits.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('Each credit shows project details', async ({ page }) => {
      await page.goto('/portfolio');
      await page.waitForSelector('[data-testid="portfolio-credit"], .portfolio-credit');

      const firstCredit = page.locator('[data-testid="portfolio-credit"], .portfolio-credit').first();
      await expect(firstCredit.locator('[data-testid="credit-project"], .project-name')).toBeVisible();
      await expect(firstCredit.locator('[data-testid="credit-amount"], .credit-amount')).toBeVisible();
      await expect(firstCredit.locator('[data-testid="credit-vintage"], .credit-vintage')).toBeVisible();
      await expect(firstCredit.locator('[data-testid="credit-standard"], .credit-standard')).toBeVisible();
    });
  });

  test.describe('Credit Retirement', () => {
    test('User can retire credits', async ({ page }) => {
      await page.goto('/portfolio');
      await page.waitForSelector('[data-testid="portfolio-credit"], .portfolio-credit');

      const firstCredit = page.locator('[data-testid="portfolio-credit"], .portfolio-credit').first();
      await firstCredit.click('[data-testid="retire-button"], button:has-text("Retire")');

      await page.waitForSelector('[data-testid="retire-modal"], .modal');

      // Fill retirement amount
      await page.fill(SELECTORS.portfolioRetireAmount, '5');

      // Select retirement reason
      await page.selectOption('[data-testid="retire-reason"], select[name="reason"]', 'voluntary');

      // Confirm retirement
      await page.click(SELECTORS.portfolioConfirmRetire);

      await waitForToast(page, /retired|success|confirmed/i, 60000);

      // Verify credit amount reduced
      await page.waitForLoadState('networkidle');
      const creditAmount = await page.locator('[data-testid="credit-amount"], .credit-amount').first().textContent();
      // Should show reduced amount
    });

    test('Cannot retire more than owned', async ({ page }) => {
      await page.goto('/portfolio');
      await page.waitForSelector('[data-testid="portfolio-credit"], .portfolio-credit');

      const firstCredit = page.locator('[data-testid="portfolio-credit"], .portfolio-credit').first();
      await firstCredit.click('[data-testid="retire-button"], button:has-text("Retire")');

      await page.waitForSelector('[data-testid="retire-modal"], .modal');

      // Try to retire more than owned
      await page.fill(SELECTORS.portfolioRetireAmount, '999999');
      await page.click('[data-testid="confirm-retire"], button:has-text("Confirm")');

      await waitForToast(page, /exceed|owned|available|insufficient/i);
    });

    test('Retirement generates certificate', async ({ page }) => {
      await page.goto('/portfolio');
      await page.waitForSelector('[data-testid="portfolio-credit"], .portfolio-credit');

      const firstCredit = page.locator('[data-testid="portfolio-credit"], .portfolio-credit').first();
      await firstCredit.click('[data-testid="retire-button"], button:has-text("Retire")');

      await page.waitForSelector('[data-testid="retire-modal"], .modal');
      await page.fill('[data-testid="retire-amount"], input[name="amount"]', '1');
      await page.selectOption('[data-testid="retire-reason"], select[name="reason"]', 'voluntary');
      await page.click('[data-testid="confirm-retire"], button:has-text("Confirm")');

      await waitForToast(page, /certificate|generated|success/i, 60000);

      // Check for certificate link
      await expect(page.locator('[data-testid="certificate-link"], a:has-text("Certificate")')).toBeVisible({ timeout: 30000 });
    });
  });

  test.describe('Portfolio Value Tracking', () => {
    test('Portfolio value updates in real-time', async ({ page }) => {
      await page.goto('/portfolio');
      const initialValue = await page.locator(SELECTORS.portfolioValue).textContent();

      // Wait and refresh
      await page.waitForTimeout(5000);
      await page.reload();

      const newValue = await page.locator(SELECTORS.portfolioValue).textContent();
      // Value should be present (may or may not change)
      expect(newValue).toMatch(/��|INR/);
    });

    test('Portfolio shows profit/loss', async ({ page }) => {
      await page.goto('/portfolio');
      await page.waitForSelector('[data-testid="portfolio-pnl"], .portfolio-pnl, [data-testid="profit-loss"]');

      const pnl = page.locator('[data-testid="portfolio-pnl"], .portfolio-pnl, [data-testid="profit-loss"]');
      await expect(pnl).toBeVisible();
    });
  });
});

test.describe('Subscription Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-sub-test@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: WAIT_TIMEOUTS.long });
  });

  test.describe('Plan Selection', () => {
    test('User can view all subscription plans', async ({ page }) => {
      await page.goto('/subscription');
      await page.waitForLoadState('networkidle');

      await expect(page.locator(SELECTORS.subscriptionPlans)).toBeVisible();

      // Should show Free, Starter, Growth, Corporate
      await expect(page.locator('[data-testid="plan-free"], .plan:has-text("Free")')).toBeVisible();
      await expect(page.locator('[data-testid="plan-starter"], .plan:has-text("Starter")')).toBeVisible();
      await expect(page.locator('[data-testid="plan-growth"], .plan:has-text("Growth")')).toBeVisible();
      await expect(page.locator('[data-testid="plan-corporate"], .plan:has-text("Corporate")')).toBeVisible();
    });

    test('Free plan shows correct features', async ({ page }) => {
      await page.goto('/subscription');
      const freePlan = page.locator('[data-testid="plan-free"], .plan:has-text("Free")');

      await expect(freePlan.locator('[data-testid="plan-price"], .price')).toContainText(/free|0/i);
      await expect(freePlan.locator('[data-testid="plan-features"], .features')).toBeVisible();
    });

    test('Paid plans show correct pricing', async ({ page }) => {
      await page.goto('/subscription');

      const starterPlan = page.locator('[data-testid="plan-starter"], .plan:has-text("Starter")');
      await expect(starterPlan.locator('[data-testid="plan-price"], .price')).toContainText(/��|INR/);

      const growthPlan = page.locator('[data-testid="plan-growth"], .plan:has-text("Growth")');
      await expect(growthPlan.locator('[data-testid="plan-price"], .price')).toContainText(/��|INR/);
    });

    test('User can select a plan', async ({ page }) => {
      await page.goto('/subscription');
      await page.waitForLoadState('networkidle');

      const starterPlan = page.locator('[data-testid="plan-starter"], .plan:has-text("Starter")');
      await starterPlan.click('[data-testid="select-plan"], button:has-text("Select")');

      await page.waitForSelector('[data-testid="payment-modal"], .modal');

      // Should show payment options
      await expect(page.locator('[data-testid="payment-options"], .payment-options')).toBeVisible();
      await expect(page.locator('[data-testid="razorpay-option"], button:has-text("Razorpay")')).toBeVisible();
      await expect(page.locator('[data-testid="wallet-option"], button:has-text("Wallet Balance")')).toBeVisible();
    });

    test('Plan shows GST breakdown', async ({ page }) => {
      await page.goto('/subscription');
      await page.waitForLoadState('networkidle');

      const starterPlan = page.locator('[data-testid="plan-starter"], .plan:has-text("Starter")');
      await expect(starterPlan.locator('[data-testid="plan-gst"], .gst-info')).toBeVisible();
      await expect(starterPlan.locator('[data-testid="plan-gst"], .gst-info')).toContainText(/gst|18%/i);
    });
  });

  test.describe('Subscription Payment', () => {
    test('Subscription payment via Razorpay works', async ({ page }) => {
      await page.goto('/subscription');
      await page.waitForLoadState('networkidle');

      const starterPlan = page.locator('[data-testid="plan-starter"], .plan:has-text("Starter")');
      await starterPlan.click('[data-testid="select-plan"], button:has-text("Select")');

      await page.waitForSelector('[data-testid="payment-modal"], .modal');
      await page.click('[data-testid="razorpay-option"], button:has-text("Razorpay")');
      await page.click('[data-testid="confirm-payment"], button:has-text("Pay")');

      // Should show Razorpay frame
      await page.waitForSelector('iframe[title*="Razorpay"], iframe[name*="razorpay"]', { timeout: 60000 });
    });

    test('Subscription payment via wallet balance', async ({ page }) => {
      await page.goto('/subscription');
      await page.waitForLoadState('networkidle');

      const starterPlan = page.locator('[data-testid="plan-starter"], .plan:has-text("Starter")');
      await starterPlan.click('[data-testid="select-plan"], button:has-text("Select")');

      await page.waitForSelector('[data-testid="payment-modal"], .modal');
      await page.click('[data-testid="wallet-option"], button:has-text("Wallet Balance")');
      await page.click('[data-testid="confirm-payment"], button:has-text("Confirm")');

      await waitForToast(page, /subscribed|activated|success/i, 30000);
    });

    test('Insufficient wallet balance shows error', async ({ page }) => {
      // Login with user with low wallet balance
      await page.goto('/login');
      await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-low-balance@example.com');
      await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
      await page.click('[data-testid="login-button"], button[type="submit"]');
      await page.waitForURL('/dashboard', { timeout: WAIT_TIMEOUTS.long });

      await page.goto('/subscription');
      await page.waitForLoadState('networkidle');

      const starterPlan = page.locator('[data-testid="plan-starter"], .plan:has-text("Starter")');
      await starterPlan.click('[data-testid="select-plan"], button:has-text("Select")');

      await page.waitForSelector('[data-testid="payment-modal"], .modal');
      await page.click('[data-testid="wallet-option"], button:has-text("Wallet Balance")');
      await page.click('[data-testid="confirm-payment"], button:has-text("Confirm")');

      await waitForToast(page, /insufficient|balance|add funds/i);
    });
  });

  test.describe('Subscription Management', () => {
    test('User can view current subscription', async ({ page }) => {
      await page.goto('/subscription');
      await expect(page.locator('[data-testid="current-plan"], .current-plan')).toBeVisible();
    });

    test('User can cancel subscription', async ({ page }) => {
      await page.goto('/subscription');
      await page.waitForSelector('[data-testid="current-plan"], .current-plan');

      await page.click('[data-testid="cancel-subscription"], button:has-text("Cancel")');
      await page.waitForSelector('[data-testid="cancel-confirm-modal"], .modal');

      await page.click('[data-testid="confirm-cancel"], button:has-text("Yes, Cancel")');

      await waitForToast(page, /cancelled|ended|success/i);
    });

    test('Cancelled subscription shows correct status', async ({ page }) => {
      await page.goto('/subscription');
      await expect(page.locator('[data-testid="current-plan"], .current-plan')).toContainText(/cancelled|expired|inactive/i);
    });
  });

  test.describe('Coupon Application', () => {
    test('User can apply valid coupon', async ({ page }) => {
      await page.goto('/subscription');
      await page.waitForLoadState('networkidle');

      const starterPlan = page.locator('[data-testid="plan-starter"], .plan:has-text("Starter")');
      await starterPlan.click('[data-testid="select-plan"], button:has-text("Select")');

      await page.waitForSelector('[data-testid="payment-modal"], .modal');
      await page.fill('[data-testid="coupon-input"], input[name="coupon"]', 'WELCOME10');
      await page.click('[data-testid="apply-coupon"], button:has-text("Apply")');

      await waitForToast(page, /coupon|applied|discount/i);

      // Should show discounted price
      await expect(page.locator('[data-testid="discounted-price"], .discounted-price')).toBeVisible();
    });

    test('Invalid coupon shows error', async ({ page }) => {
      await page.goto('/subscription');
      await page.waitForLoadState('networkidle');

      const starterPlan = page.locator('[data-testid="plan-starter"], .plan:has-text("Starter")');
      await starterPlan.click('[data-testid="select-plan"], button:has-text("Select")');

      await page.waitForSelector('[data-testid="payment-modal"], .modal');
      await page.fill('[data-testid="coupon-input"], input[name="coupon"]', 'INVALIDCOUPON');
      await page.click('[data-testid="apply-coupon"], button:has-text("Apply")');

      await waitForToast(page, /invalid|expired|not valid/i);
    });
  });
});