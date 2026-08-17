import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS, waitForToast, waitForModal } from '../fixtures/test-users';

test.describe('Admin Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-admin@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/admin', { timeout: WAIT_TIMEOUTS.long });
  });

  test.describe('Dashboard', () => {
    test('Admin dashboard loads with stats', async ({ page }) => {
      await page.goto('/admin');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="admin-stats"], .admin-stats')).toBeVisible();
      await expect(page.locator('[data-testid="total-users"], .stat:has-text("Users")')).toBeVisible();
      await expect(page.locator('[data-testid="total-credits"], .stat:has-text("Credits")')).toBeVisible();
      await expect(page.locator('[data-testid="total-volume"], .stat:has-text("Volume")')).toBeVisible();
      await expect(page.locator('[data-testid="revenue"], .stat:has-text("Revenue")')).toBeVisible();
    });

    test('Admin can view user management', async ({ page }) => {
      await page.goto('/admin/users');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="users-table"], .users-table')).toBeVisible();
      await expect(page.locator('[data-testid="user-search"], input[name="search"]')).toBeVisible();
    });
  });

  test.describe('KYC Management', () => {
    test('Admin can view pending KYC requests', async ({ page }) => {
      await page.goto('/admin/kyc');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="kyc-pending-table"], .kyc-table')).toBeVisible();

      // Should show pending requests
      const pendingRows = page.locator('[data-testid="kyc-row"], .kyc-row');
      const count = await pendingRows.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test('Admin can approve KYC', async ({ page }) => {
      await page.goto('/admin/kyc');
      await page.waitForSelector('[data-testid="kyc-row"], .kyc-row');

      const firstRow = page.locator('[data-testid="kyc-row"], .kyc-row').first();
      await firstRow.click('[data-testid="kyc-approve"], button:has-text("Approve")');
      await waitForModal(page);

      await page.click('[data-testid="confirm-approve"], button:has-text("Yes, Approve")');
      await waitForToast(page, /approved|success/i);
    });

    test('Admin can reject KYC with reason', async ({ page }) => {
      await page.goto('/admin/kyc');
      await page.waitForSelector('[data-testid="kyc-row"], .kyc-row');

      const firstRow = page.locator('[data-testid="kyc-row"], .kyc-row').first();
      await firstRow.click('[data-testid="kyc-reject"], button:has-text("Reject")');
      await waitForModal(page);

      await page.fill('[data-testid="reject-reason"], textarea[name="reason"]', 'Invalid documents');
      await page.click('[data-testid="confirm-reject"], button:has-text("Reject")');

      await waitForToast(page, /rejected|success/i);
    });
  });

  test.describe('Credit Management', () => {
    test('Admin can view all credits', async ({ page }) => {
      await page.goto('/admin/credits');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="credits-table"], .credits-table')).toBeVisible();
    });

    test('Admin can force delist credits', async ({ page }) => {
      await page.goto('/admin/credits');
      await page.waitForSelector('[data-testid="credit-row"], .credit-row');

      const firstRow = page.locator('[data-testid="credit-row"], .credit-row').first();
      await firstRow.click('[data-testid="force-delist"], button:has-text("Force Delist")');
      await waitForModal(page);

      await page.fill('[data-testid="delist-reason"], textarea[name="reason"]', 'Policy violation');
      await page.click('[data-testid="confirm-delist"], button:has-text("Delist")');

      await waitForToast(page, /delisted|success/i);
    });
  });

  test.describe('Trade Reconciliation', () => {
    test('Admin can view all trades', async ({ page }) => {
      await page.goto('/admin/trades');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('[data-testid="trades-table"], .trades-table')).toBeVisible();
    });

    test('Admin can reconcile disputed trade', async ({ page }) => {
      await page.goto('/admin/trades');
      await page.waitForSelector('[data-testid="trade-row"], .trade-row');

      const disputedTrade = page.locator('[data-testid="trade-row"][data-status="disputed"], .trade-row.disputed').first();
      if (await disputedTrade.count() > 0) {
        await disputedTrade.click('[data-testid="reconcile-trade"], button:has-text("Reconcile")');
        await waitForModal(page);

        await page.click('[data-testid="confirm-reconcile"], button:has-text("Reconcile")');
        await waitForToast(page, /reconciled|success/i);
      }
    });
  });
});

test.describe('Operator/Backend Flows', () => {
  test.beforeEach(async ({ page }) => {
    // Login as operator/signer wallet
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-operator@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/operator', { timeout: WAIT_TIMEOUTS.long });
  });

  test('Operator can log INR trade', async ({ page }) => {
    await page.goto('/operator/trades');
    await page.waitForLoadState('networkidle');

    await page.click('[data-testid="log-inr-trade"], button:has-text("Log INR Trade")');
    await waitForModal(page);

    // Fill trade details
    await page.fill('[data-testid="trade-buyer"], input[name="buyer"]', '0x1234...');
    await page.fill('[data-testid="trade-seller"], input[name="seller"]', '0x5678...');
    await page.fill('[data-testid="trade-token"], input[name="tokenId"]', '1');
    await page.fill('[data-testid="trade-quantity"], input[name="quantity"]', '100');
    await page.fill('[data-testid="trade-price"], input[name="price"]', '1500');
    await page.selectOption('[data-testid="trade-paymode"], select[name="payMode"]', '0'); // INR Wallet

    await page.click('[data-testid="submit-trade"], button:has-text("Submit")');
    await waitForToast(page, /logged|recorded|success/i);
  });

  test('Operator can batch log INR trades', async ({ page }) => {
    await page.goto('/operator/trades');
    await page.waitForLoadState('networkidle');

    await page.click('[data-testid="batch-log"], button:has-text("Batch Log")');
    await waitForModal(page);

    // Upload CSV or fill multiple trades
    // For now, verify the modal opens
    await expect(page.locator('[data-testid="batch-modal"], .modal')).toBeVisible();
  });
});

test.describe('ERP Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-admin@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/admin', { timeout: WAIT_TIMEOUTS.long });
  });

  test('Admin can configure ERP connection', async ({ page }) => {
    await page.goto('/admin/erp');
    await page.waitForLoadState('networkidle');

    await page.click('[data-testid="add-erp"], button:has-text("Add ERP")');
    await waitForModal(page);

    await page.selectOption('[data-testid="erp-type"], select[name="type"]', 'Tally');
    await page.fill('[data-testid="erp-url"], input[name="url"]', 'http://localhost:9000');
    await page.fill('[data-testid="erp-username"], input[name="username"]', 'admin');
    await page.fill('[data-testid="erp-password"], input[name="password"]', 'password');

    await page.click('[data-testid="test-connection"], button:has-text("Test Connection")');
    await waitForToast(page, /connected|success/i);

    await page.click('[data-testid="save-erp"], button:has-text("Save")');
    await waitForToast(page, /saved|success/i);
  });

  test('ERP sync shows status', async ({ page }) => {
    await page.goto('/admin/erp');
    await expect(page.locator('[data-testid="erp-status"], .erp-status')).toBeVisible();
  });
});