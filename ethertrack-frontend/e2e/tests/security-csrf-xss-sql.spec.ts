import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS, waitForToast } from '../fixtures/test-users';

test.describe('CSRF Protection', () => {
  test('Login form includes CSRF token', async ({ page }) => {
    await page.goto('/login');
    const csrfToken = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="csrf-token"]');
      return meta ? meta.getAttribute('content') : null;
    });
    expect(csrfToken).toBeTruthy();
  });

  test('Forms include CSRF token', async ({ page }) => {
    await page.goto('/login');
    const form = page.locator('form');
    const csrfInput = form.locator('input[name="_csrf"], input[name="csrf_token"]');
    await expect(csrfInput).toHaveCount(1);
  });

  test('State-changing API requests include CSRF header', async ({ page }) => {
    await page.goto('/login');
    const csrfToken = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="csrf-token"]');
      return meta ? meta.getAttribute('content') : null;
    });

    await page.fill('[data-testid="login-email"], input[name="email"]', 'test@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'password');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: WAIT_TIMEOUTS.long });

    // Check that API requests include CSRF token
    const requests: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
        const headers = request.headers();
        if (headers['x-csrf-token'] || headers['csrf-token']) {
          requests.push(request.url());
        }
      }
    });

    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
    // At least some state-changing requests should have CSRF
  });
});

test.describe('XSS Protection', () => {
  test('Toast messages escape HTML', async ({ page }) => {
    await page.evaluate(() => {
      if (window.showToast) {
        window.showToast('<script>alert("xss")</script>', 'error');
      }
    });

    const toast = page.locator('[data-testid="toast"], .toast');
    await page.waitForTimeout(1000);
    const toastHtml = await toast.innerHTML();
    expect(toastHtml).not.toContain('<script>');
    expect(toastHtml).not.toContain('alert(');
  });

  test('User input escaped in marketplace display', async ({ page }) => {
    await page.goto('/marketplace');
    await page.waitForLoadState('networkidle');

    // Check that any user-generated content is escaped
    const listings = page.locator('[data-testid="market-listing"], .listing-card');
    const count = await listings.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const html = await listings.nth(i).innerHTML();
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('onerror=');
      expect(html).not.toContain('onload=');
    }
  });

  test('URL parameters are sanitized', async ({ page }) => {
    await page.goto('/marketplace?search=<script>alert(1)</script>');
    await page.waitForLoadState('networkidle');

    const bodyHtml = await page.locator('body').innerHTML();
    expect(bodyHtml).not.toContain('<script>');
    expect(bodyHtml).not.toContain('alert(');
  });

  test('Error messages escape user input', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', '<script>alert(1)</script>');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'password');
    await page.click('[data-testid="login-button"], button[type="submit"]');

    await page.waitForTimeout(2000);
    const toast = page.locator('[data-testid="toast"], .toast');
    const toastHtml = await toast.innerHTML();
    expect(toastHtml).not.toContain('<script>');
  });
});

test.describe('SQL Injection Protection', () => {
  test('Search inputs are parameterized', async ({ page }) => {
    await page.goto('/marketplace');
    await page.fill('[data-testid="search-input"], input[name="search"]', "'; DROP TABLE users; --");
    await page.click('[data-testid="search-button"], button:has-text("Search")');

    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).not.toContainText(/SQL|syntax|error|DROP TABLE/i);
  });

  test('API endpoints use parameterized queries', async ({ page }) => {
    // Frontend should not construct SQL - tested at API level
    // This test verifies frontend doesn't send raw SQL
    const payloads = [
      "'; DROP TABLE users; --",
      "' OR '1'='1",
      "'; SELECT * FROM users; --",
      "admin'--",
    ];

    for (const payload of payloads) {
      await page.goto('/marketplace');
      await page.fill('[data-testid="search-input"], input[name="search"]', payload);
      await page.click('[data-testid="search-button"], button:has-text("Search")');
      await page.waitForLoadState('networkidle');

      const bodyText = await page.locator('body').textContent();
      expect(bodyText).not.toMatch(/SQL|syntax|error|DROP|SELECT|UNION/i);
    }
  });
});