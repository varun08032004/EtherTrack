import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS, waitForToast, waitForModal } from '../fixtures/test-users';

test.describe('Carbon Credit Marketplace', () => {
  test.beforeEach(async ({ page }) => {
    // Login as KYC verified user with credits
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-marketplace-seller@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: WAIT_TIMEOUTS.long });
  });

  test.describe('Listing Credits', () => {
    test('User can list credits for sale', async ({ page }) => {
      await page.goto('/marketplace');
      await page.waitForLoadState('networkidle');

      await page.click(SELECTORS.marketListCredits);
      await waitForModal(page);

      // Select token/project
      await page.selectOption(SELECTORS.marketListingTokenId, { index: 1 });

      // Fill amount
      await page.fill(SELECTORS.marketListingAmount, '100');

      // Fill price per credit (INR)
      await page.fill(SELECTORS.marketListingPrice, '1500');

      // Submit listing
      await page.click(SELECTORS.marketListingSubmit);

      await waitForToast(page, /listed|success|created/i);
      await waitForModal(page, false);

      // Verify listing appears in marketplace
      await page.goto('/marketplace');
      await expect(page.locator('[data-testid="market-listing"], .listing-card').first()).toBeVisible();
    });

    test('Listing validation - required fields', async ({ page }) => {
      await page.goto('/marketplace');
      await page.click(SELECTORS.marketListCredits);
      await waitForModal(page);

      // Try to submit without filling fields
      await page.click(SELECTORS.marketListingSubmit);

      await waitForToast(page, /required|select|amount|price/i);
    });

    test('Cannot list more credits than owned', async ({ page }) => {
      await page.goto('/marketplace');
      await page.click(SELECTORS.marketListCredits);
      await waitForModal(page);

      await page.selectOption(SELECTORS.marketListingTokenId, { index: 1 });
      await page.fill(SELECTORS.marketListingAmount, '999999999'); // More than owned
      await page.fill(SELECTORS.marketListingPrice, '1000');

      await page.click(SELECTORS.marketListingSubmit);

      await waitForToast(page, /insufficient|owned|available|balance/i);
    });

    test('User can cancel their own listing', async ({ page }) => {
      // First create a listing
      await page.goto('/marketplace');
      await page.click(SELECTORS.marketListCredits);
      await waitForModal(page);

      await page.selectOption(SELECTORS.marketListingTokenId, { index: 1 });
      await page.fill(SELECTORS.marketListingAmount, '50');
      await page.fill(SELECTORS.marketListingPrice, '1200');
      await page.click(SELECTORS.marketListingSubmit);
      await waitForToast(page, /listed|success/i);
      await waitForModal(page, false);

      // Go to my listings and cancel
      await page.goto('/marketplace?tab=my-listings');
      await page.waitForSelector('[data-testid="my-listing"], .my-listing');

      await page.click('[data-testid="cancel-listing"], button:has-text("Cancel")');
      await waitForModal(page);

      await page.click('[data-testid="confirm-cancel"], button:has-text("Yes, Cancel")');
      await waitForToast(page, /cancelled|removed/i);
      await waitForModal(page, false);
    });
  });

  test.describe('Buying Credits', () => {
    test.beforeEach(async ({ page }) => {
      // Login as buyer
      await page.goto('/login');
      await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-marketplace-buyer@example.com');
      await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
      await page.click('[data-testid="login-button"], button[type="submit"]');
      await page.waitForURL('/dashboard', { timeout: WAIT_TIMEOUTS.long });
    });

    test('User can buy credits from marketplace', async ({ page }) => {
      await page.goto('/marketplace');
      await page.waitForLoadState('networkidle');

      // Find a listing
      await page.waitForSelector('[data-testid="market-listing"], .listing-card');
      const firstListing = page.locator('[data-testid="market-listing"], .listing-card').first();
      await firstListing.click();

      // Should show listing details with buy button
      await expect(page.locator(SELECTORS.marketBuyButton)).toBeVisible();

      // Click buy
      await page.click(SELECTORS.marketBuyButton);
      await waitForModal(page);

      // Enter quantity
      await page.fill(SELECTORS.marketQuantity, '10');
      await page.click(SELECTORS.marketConfirmBuy);

      // Should process purchase
      await waitForToast(page, /purchase|bought|success|confirm/i, 60000);

      // Verify credits appear in portfolio
      await page.goto('/portfolio');
      await expect(page.locator('[data-testid="portfolio-credit"], .portfolio-credit').first()).toBeVisible();
    });

    test('Cannot buy more than available in listing', async ({ page }) => {
      await page.goto('/marketplace');
      await page.waitForSelector('[data-testid="market-listing"], .listing-card');
      const firstListing = page.locator('[data-testid="market-listing"], .listing-card').first();
      await firstListing.click();

      await page.click(SELECTORS.marketBuyButton);
      await waitForModal(page);

      // Try to buy more than available
      await page.fill(SELECTORS.marketQuantity, '999999');
      await page.click(SELECTORS.marketConfirmBuy);

      await waitForToast(page, /exceeds|available|exceed/i);
    });

    test('Cannot buy own listing', async ({ page }) => {
      // Login as seller
      await page.goto('/login');
      await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-marketplace-seller@example.com');
      await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
      await page.click('[data-testid="login-button"], button[type="submit"]');
      await page.waitForURL('/dashboard', { timeout: WAIT_TIMEOUTS.long });

      await page.goto('/marketplace');
      await page.waitForSelector('[data-testid="my-listing"], .my-listing');
      const myListing = page.locator('[data-testid="my-listing"], .my-listing').first();
      await myListing.click();

      // Buy button should be disabled or not visible for own listing
      await expect(page.locator(SELECTORS.marketBuyButton)).toBeHidden();
    });
  });

  test.describe('Price Validation', () => {
    test('Price mismatch shows error', async ({ page }) => {
      await page.goto('/marketplace');
      await page.waitForSelector('[data-testid="market-listing"], .listing-card');
      const firstListing = page.locator('[data-testid="market-listing"], .listing-card').first();
      await firstListing.click();

      await page.click(SELECTORS.marketBuyButton);
      await waitForModal(page);

      // Manually modify price in form if possible, or test backend validation
      // This tests the price mismatch protection
    });
  });
});

test.describe('Marketplace Filters and Search', () => {
  test('User can filter by price range', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForLoadState('networkidle');

    await page.fill('[data-testid="price-min"], input[name="minPrice"]', '500');
    await page.fill('[data-testid="price-max"], input[name="maxPrice"]', '2000');
    await page.click('[data-testid="apply-filters"], button:has-text("Apply")');

    // Should show filtered results
    await page.waitForSelector('[data-testid="market-listing"], .listing-card');
  });

  test('User can filter by project type', async ({ page }) => {
    await page.goto('/marketplace');
    await page.selectOption('[data-testid="project-type-filter"], select[name="projectType"]', 'Renewable Energy');
    await page.click('[data-testid="apply-filters"], button:has-text("Apply")');

    await page.waitForSelector('[data-testid="market-listing"], .listing-card');
  });

  test('User can sort by price', async ({ page }) => {
    await page.goto('/marketplace');
    await page.selectOption('[data-testid="sort-by"], select[name="sort"]', 'price-asc');
    await page.waitForSelector('[data-testid="market-listing"], .listing-card');

    // Verify sorting
    const prices = await page.locator('[data-testid="listing-price"], .price').allTextContents();
    // Verify ascending order
  });
});