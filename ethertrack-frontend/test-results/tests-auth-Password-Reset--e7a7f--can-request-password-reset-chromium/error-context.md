# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\auth.spec.ts >> Password Reset Flow >> User can request password reset
- Location: e2e\tests\auth.spec.ts:164:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('a:has-text("Forgot Password")')

```

# Test source

```ts
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
  119 |     await logoutButton.click();
  120 | 
  121 |     await page.waitForURL(/login|home/, { timeout: 15000 });
  122 |     await expect(page.locator('button[type="submit"]')).toBeVisible();
  123 |   });
  124 | 
  125 |   test('Session persists across page refresh', async ({ page }) => {
  126 |     const email = generateUniqueEmail('session');
  127 |     const password = 'TestPassword123!';
  128 | 
  129 |     // Register and login
  130 |     await page.goto('/signup');
  131 |     await page.waitForLoadState('networkidle');
  132 | 
  133 |     await page.fill('#signup-name', 'Test User');
  134 |     await page.click('button[type="submit"]');
  135 |     await page.waitForTimeout(500);
  136 | 
  137 |     await page.fill('#signup-email', email);
  138 |     await page.fill('#signup-password', password);
  139 |     await page.fill('#signup-confirm', password);
  140 |     await page.check('input[type="checkbox"]');
  141 |     await page.click('button[type="submit"]');
  142 |     await page.waitForTimeout(500);
  143 | 
  144 |     await page.goto('/login');
  145 |     await page.waitForLoadState('networkidle');
  146 | 
  147 |     await page.fill('#login-email', email);
  148 |     await page.fill('#login-password', password);
  149 |     await page.click('button[type="submit"]');
  150 | 
  151 |     await page.waitForURL('/dashboard', { timeout: 60000 });
  152 |     
  153 |     // Refresh
  154 |     await page.reload();
  155 |     await page.waitForLoadState('networkidle');
  156 | 
  157 |     // Should still be logged in
  158 |     await expect(page).toHaveURL(/dashboard/);
  159 |     await expect(page.locator('a[href="/dashboard"]')).toBeVisible();
  160 |   });
  161 | });
  162 | 
  163 | test.describe('Password Reset Flow', () => {
  164 |   test('User can request password reset', async ({ page }) => {
  165 |     await page.goto('/login');
  166 |     await page.waitForLoadState('networkidle');
  167 | 
> 168 |     await page.click('a:has-text("Forgot Password")');
      |                ^ Error: page.click: Test timeout of 30000ms exceeded.
  169 |     await page.waitForTimeout(500);
  170 | 
  171 |     const email = generateUniqueEmail('reset');
  172 |     await page.fill('input[name="email"]', email);
  173 |     await page.click('button:has-text("Send Reset Link")');
  174 | 
  175 |     await waitForToast(page, /reset|email|sent/i);
  176 |   });
  177 | });
```