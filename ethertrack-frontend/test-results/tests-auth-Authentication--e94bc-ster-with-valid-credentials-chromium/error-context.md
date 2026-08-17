# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\auth.spec.ts >> Authentication Flows >> User can register with valid credentials
- Location: e2e\tests\auth.spec.ts:10:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('#signup-name')

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import { SELECTORS, WAIT_TIMEOUTS, generateUniqueEmail, waitForToast } from '../fixtures/test-users';
  3   | 
  4   | test.describe('Authentication Flows', () => {
  5   |   test.beforeEach(async ({ page }) => {
  6   |     await page.goto('/');
  7   |     await page.waitForLoadState('networkidle');
  8   |   });
  9   | 
  10  |   test('User can register with valid credentials', async ({ page }) => {
  11  |     const email = generateUniqueEmail('register');
  12  |     const password = 'TestPassword123!';
  13  | 
  14  |     await page.goto('/signup');
  15  |     await page.waitForLoadState('networkidle');
  16  | 
  17  |     // Step 1: Info slide
> 18  |     await page.fill(SELECTORS.signupName, 'Test User');
      |                ^ Error: page.fill: Test timeout of 30000ms exceeded.
  19  |     await page.click(SELECTORS.signupSubmit); // Continue
  20  |     await page.waitForTimeout(500);
  21  | 
  22  |     // Step 2: Credentials slide
  23  |     await page.waitForSelector(SELECTORS.signupEmail);
  24  |     await page.fill(SELECTORS.signupEmail, email);
  25  |     await page.fill(SELECTORS.signupPassword, password);
  26  |     await page.fill(SELECTORS.signupConfirm, password);
  27  |     
  28  |     // Agree to terms
  29  |     await page.check('input[type="checkbox"]');
  30  |     
  31  |     await page.click(SELECTORS.signupSubmit); // Create Account
  32  |     await waitForToast(page, /created|verification|code|sent/i, 60000);
  33  |   });
  34  | 
  35  |   test('User can login with valid credentials', async ({ page }) => {
  36  |     // First register a user
  37  |     const email = generateUniqueEmail('login');
  38  |     const password = 'TestPassword123!';
  39  | 
  40  |     await page.goto('/signup');
  41  |     await page.waitForLoadState('networkidle');
  42  | 
  43  |     await page.fill(SELECTORS.signupName, 'Test User');
  44  |     await page.click(SELECTORS.signupSubmit);
  45  |     await page.waitForTimeout(500);
  46  | 
  47  |     await page.fill(SELECTORS.signupEmail, email);
  48  |     await page.fill(SELECTORS.signupPassword, password);
  49  |     await page.fill(SELECTORS.signupConfirm, password);
  50  |     await page.check('input[type="checkbox"]');
  51  |     
  52  |     await page.click(SELECTORS.signupSubmit);
  53  |     await waitForToast(page, /created|verification|code|sent/i, 60000);
  54  | 
  55  |     // Now login
  56  |     await page.goto('/login');
  57  |     await page.waitForLoadState('networkidle');
  58  | 
  59  |     await page.fill(SELECTORS.loginEmail, email);
  60  |     await page.fill(SELECTORS.loginPassword, password);
  61  |     await page.click(SELECTORS.loginButton);
  62  | 
  63  |     await page.waitForURL('/dashboard', { timeout: 60000 });
  64  |     await expect(page.locator('a[href="/dashboard"]')).toBeVisible();
  65  |   });
  66  | 
  67  |   test('Login fails with invalid credentials', async ({ page }) => {
  68  |     await page.goto('/login');
  69  |     await page.waitForLoadState('networkidle');
  70  | 
  71  |     await page.fill(SELECTORS.loginEmail, 'nonexistent@example.com');
  72  |     await page.fill(SELECTORS.loginPassword, 'wrongpassword');
  73  |     await page.click(SELECTORS.loginButton);
  74  | 
  75  |     await waitForToast(page, /incorrect|invalid|failed/i);
  76  |     await expect(page).toHaveURL(/login/);
  77  |   });
  78  | 
  79  |   test('Login fails with empty fields', async ({ page }) => {
  80  |     await page.goto('/login');
  81  |     await page.waitForLoadState('networkidle');
  82  | 
  83  |     await page.click('button[type="submit"]');
  84  | 
  85  |     await waitForToast(page, /required|empty|both/i);
  86  |   });
  87  | 
  88  |   test('User can logout', async ({ page }) => {
  89  |     // Register and login first
  90  |     const logoutEmail = generateUniqueEmail('logout');
  91  |     const password = 'TestPassword123!';
  92  | 
  93  |     await page.goto('/signup');
  94  |     await page.waitForLoadState('networkidle');
  95  | 
  96  |     await page.fill('#signup-name', 'Test User');
  97  |     await page.click('button[type="submit"]');
  98  |     await page.waitForTimeout(500);
  99  | 
  100 |     await page.fill('#signup-email', logoutEmail);
  101 |     await page.fill('#signup-password', 'TestPassword123!');
  102 |     await page.fill('#signup-confirm', 'TestPassword123!');
  103 |     await page.check('input[type="checkbox"]');
  104 |     await page.click('button[type="submit"]');
  105 |     await page.waitForTimeout(500);
  106 | 
  107 |     await page.goto('/login');
  108 |     await page.waitForLoadState('networkidle');
  109 | 
  110 |     await page.fill('#login-email', logoutEmail);
  111 |     await page.fill('#login-password', 'TestPassword123!');
  112 |     await page.click('button[type="submit"]');
  113 | 
  114 |     await page.waitForURL('/dashboard', { timeout: 60000 });
  115 |     
  116 |     // Now logout - find logout button in header
  117 |     const logoutButton = page.locator('button:has-text("Logout"), a:has-text("Logout")').first();
  118 |     await expect(logoutButton).toBeVisible({ timeout: 15000 });
```