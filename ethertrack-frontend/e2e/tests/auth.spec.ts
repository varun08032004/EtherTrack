import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS, generateUniqueEmail, waitForToast } from '../fixtures/test-users';

test.describe('Authentication Flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('User can register with valid credentials', async ({ page }) => {
    const email = generateUniqueEmail('register');
    const password = 'TestPassword123!';

    await page.goto('/signup');
    await page.waitForLoadState('networkidle');

    // Step 1: Info slide
    await page.fill(SELECTORS.signupName, 'Test User');
    await page.click(SELECTORS.signupSubmit); // Continue
    await page.waitForTimeout(500);

    // Step 2: Credentials slide
    await page.waitForSelector(SELECTORS.signupEmail);
    await page.fill(SELECTORS.signupEmail, email);
    await page.fill(SELECTORS.signupPassword, password);
    await page.fill(SELECTORS.signupConfirm, password);
    
    // Agree to terms
    await page.check('input[type="checkbox"]');
    
    await page.click(SELECTORS.signupSubmit); // Create Account
    await waitForToast(page, /created|verification|code|sent/i, 60000);
  });

  test('User can login with valid credentials', async ({ page }) => {
    // First register a user
    const email = generateUniqueEmail('login');
    const password = 'TestPassword123!';

    await page.goto('/signup');
    await page.waitForLoadState('networkidle');

    await page.fill(SELECTORS.signupName, 'Test User');
    await page.click(SELECTORS.signupSubmit);
    await page.waitForTimeout(500);

    await page.fill(SELECTORS.signupEmail, email);
    await page.fill(SELECTORS.signupPassword, password);
    await page.fill(SELECTORS.signupConfirm, password);
    await page.check('input[type="checkbox"]');
    
    await page.click(SELECTORS.signupSubmit);
    await waitForToast(page, /created|verification|code|sent/i, 60000);

    // Now login
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.fill(SELECTORS.loginEmail, email);
    await page.fill(SELECTORS.loginPassword, password);
    await page.click(SELECTORS.loginButton);

    await page.waitForURL('/dashboard', { timeout: 60000 });
    await expect(page.locator('a[href="/dashboard"]')).toBeVisible();
  });

  test('Login fails with invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.fill(SELECTORS.loginEmail, 'nonexistent@example.com');
    await page.fill(SELECTORS.loginPassword, 'wrongpassword');
    await page.click(SELECTORS.loginButton);

    await waitForToast(page, /incorrect|invalid|failed/i);
    await expect(page).toHaveURL(/login/);
  });

  test('Login fails with empty fields', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.click('button[type="submit"]');

    await waitForToast(page, /required|empty|both/i);
  });

  test('User can logout', async ({ page }) => {
    // Register and login first
    const logoutEmail = generateUniqueEmail('logout');
    const password = 'TestPassword123!';

    await page.goto('/signup');
    await page.waitForLoadState('networkidle');

    await page.fill('#signup-name', 'Test User');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);

    await page.fill('#signup-email', logoutEmail);
    await page.fill('#signup-password', 'TestPassword123!');
    await page.fill('#signup-confirm', 'TestPassword123!');
    await page.check('input[type="checkbox"]');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.fill('#login-email', logoutEmail);
    await page.fill('#login-password', 'TestPassword123!');
    await page.click('button[type="submit"]');

    await page.waitForURL('/dashboard', { timeout: 60000 });
    
    // Now logout - find logout button in header
    const logoutButton = page.locator('button:has-text("Logout"), a:has-text("Logout")').first();
    await expect(logoutButton).toBeVisible({ timeout: 15000 });
    await logoutButton.click();

    await page.waitForURL(/login|home/, { timeout: 15000 });
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('Session persists across page refresh', async ({ page }) => {
    const email = generateUniqueEmail('session');
    const password = 'TestPassword123!';

    // Register and login
    await page.goto('/signup');
    await page.waitForLoadState('networkidle');

    await page.fill('#signup-name', 'Test User');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);

    await page.fill('#signup-email', email);
    await page.fill('#signup-password', password);
    await page.fill('#signup-confirm', password);
    await page.check('input[type="checkbox"]');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.fill('#login-email', email);
    await page.fill('#login-password', password);
    await page.click('button[type="submit"]');

    await page.waitForURL('/dashboard', { timeout: 60000 });
    
    // Refresh
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still be logged in
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.locator('a[href="/dashboard"]')).toBeVisible();
  });
});

test.describe('Password Reset Flow', () => {
  test('User can request password reset', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.click('a:has-text("Forgot Password")');
    await page.waitForTimeout(500);

    const email = generateUniqueEmail('reset');
    await page.fill('input[name="email"]', email);
    await page.click('button:has-text("Send Reset Link")');

    await waitForToast(page, /reset|email|sent/i);
  });
});