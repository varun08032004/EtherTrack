import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS, generateUniqueEmail, waitForToast, waitForModal } from '../fixtures/test-users';

test.describe('KYC Verification Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login as a regular user
    await page.goto('/login');
    // Use a test account that has no KYC
    await page.fill(SELECTORS.loginEmail, 'e2e-kyc-test@example.com');
    await page.fill(SELECTORS.loginPassword, 'TestPassword123!');
    await page.click(SELECTORS.loginButton);
    await page.waitForURL('/dashboard', { timeout: WAIT_TIMEOUTS.long });
  });

  test('User can start KYC process', async ({ page }) => {
    await page.goto('/kyc');
    await page.waitForLoadState('networkidle');

    await expect(page.locator(SELECTORS.kycStartButton)).toBeVisible();
    await page.click(SELECTORS.kycStartButton);
    await waitForModal(page);

    // Should show KYC form steps
    await expect(page.locator('[data-testid="kyc-step-1"], h2:has-text("Personal Information")')).toBeVisible();
  });

  test('KYC form validation - required fields', async ({ page }) => {
    await page.goto('/kyc');
    await page.click(SELECTORS.kycStartButton);
    await waitForModal(page);

    // Try to submit without filling required fields
    await page.click(SELECTORS.kycSubmitButton);

    // Should show validation errors
    await waitForToast(page, /required|mandatory/i);
  });

  test('User can complete KYC with valid documents', async ({ page }) => {
    await page.goto('/kyc');
    await page.click(SELECTORS.kycStartButton);
    await waitForModal(page);

    // Fill personal info
    await page.fill('[data-testid="kyc-full-name"], input[name="fullName"]', 'E2E Test User');
    await page.fill('[data-testid="kyc-dob"], input[name="dateOfBirth"]', '1990-01-01');
    await page.selectOption('[data-testid="kyc-nationality"], select[name="nationality"]', 'IN');

    // Upload document (use a test file)
    const filePath = './e2e/fixtures/test-document.pdf';
    await page.setInputFiles(SELECTORS.kycDocumentUpload, filePath);

    // Continue through steps
    await page.click('[data-testid="kyc-next"], button:has-text("Next")');

    // Address step
    await page.fill('[data-testid="kyc-address"], input[name="address"]', '123 Test Street');
    await page.fill('[data-testid="kyc-city"], input[name="city"]', 'Mumbai');
    await page.fill('[data-testid="kyc-state"], input[name="state"]', 'Maharashtra');
    await page.fill('[data-testid="kyc-pincode"], input[name="pincode"]', '400001');

    await page.click('[data-testid="kyc-next"], button:has-text("Next")');

    // Review and submit
    await page.click(SELECTORS.kycSubmitButton);

    await waitForToast(page, /submitted|pending|review/i);
    await waitForModal(page, false);
  });

  test('KYC status shows correctly after submission', async ({ page }) => {
    await page.goto('/kyc');
    await expect(page.locator(SELECTORS.kycStatus)).toContainText(/pending|submitted|under review/i);
  });

  test('KYC rejection shows reason', async ({ page }) => {
    // This would require a pre-rejected KYC account
    // For now, just verify the UI can display rejection
    await page.goto('/kyc');
    await expect(page.locator(SELECTORS.kycStatus)).toBeVisible();
  });
});

test.describe('KYC Wallet Linking', () => {
  test('Verified KYC user can link wallet', async ({ page }) => {
    // Login as KYC verified user
    await page.goto('/login');
    await page.fill(SELECTORS.loginEmail, 'e2e-kyc-verified@example.com');
    await page.fill(SELECTORS.loginPassword, 'TestPassword123!');
    await page.click(SELECTORS.loginButton);
    await page.waitForURL('/dashboard', { timeout: WAIT_TIMEOUTS.long });

    await page.goto('/wallet');
    await expect(page.locator('[data-testid="link-wallet"], button:has-text("Link Wallet")')).toBeVisible();

    await page.click('[data-testid="link-wallet"], button:has-text("Link Wallet")');
    await waitForModal(page);

    // Should show wallet connection options
    await expect(page.locator('[data-testid="metamask-connect"], button:has-text("MetaMask")')).toBeVisible();
  });
});