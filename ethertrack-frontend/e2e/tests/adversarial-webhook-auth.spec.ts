import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS } from '../fixtures/test-users';

test.describe('Expired/Invalid Authentication', () => {
  test('Expired JWT token rejected', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid');
    });

    await page.goto('/dashboard');
    await page.waitForURL(/login/, { timeout: 10000 });
  });

  test('Malformed JWT rejected', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('token', 'invalid.token.here');
    });

    await page.goto('/dashboard');
    await page.waitForURL(/login/, { timeout: 10000 });
  });

  test('Missing Authorization header rejected', async ({ page }) => {
    const response = await page.request.get('/api/portfolio', {
      headers: { 'Authorization': '' }
    });
    expect(response.status()).toBe(401);
  });

  test('Invalid token format rejected', async ({ page }) => {
    const response = await page.request.get('/api/portfolio', {
      headers: { 'Authorization': 'Bearer not-a-valid-jwt' }
    });
    expect(response.status()).toBe(401);
  });
});

test.describe('Unauthorized Object Access (IDOR)', () => {
  test('Cannot access other user trades', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-user-a@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 30000 });

    const response = await page.request.get('/api/trades/user-b-trade-id');
    expect([403, 404]).toContain(response.status());
  });

  test('Cannot access other user wallet', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-user-a@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 30000 });

    const response = await page.request.get('/api/wallet/user-b-id');
    expect([403, 404]).toContain(response.status());
  });

  test('Cannot cancel other user listing', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-user-a@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 30000 });

    const response = await page.request.post('/api/marketplace/listings/user-b-listing-id/cancel');
    expect([403, 404]).toContain(response.status());
  });

  test('Cannot access other user KYC', async ({ page }) => {
    const response = await page.request.get('/api/kyc/user-b-id');
    expect([403, 404]).toContain(response.status());
  });
});

test.describe('Rate Limit Bypass Attempts', () => {
  test('Burst requests handled correctly', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-burst@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 30000 });

    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(page.request.get('/api/portfolio'));
    }

    const responses = await Promise.all(promises);
    const successCount = responses.filter(r => r.status() === 200).length;
    const rateLimitedCount = responses.filter(r => r.status() === 429).length;

    expect(successCount + rateLimitedCount).toBe(20);
  });
});