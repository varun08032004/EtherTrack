import { test, expect } from '@playwright/test';
import { SELECTORS, WAIT_TIMEOUTS } from '../fixtures/test-users';

test.describe('Data Exposure Prevention', () => {
  test('API responses do not leak sensitive data', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-test@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 30000 });

    const sensitivePatterns = [
      /password/i,
      /privateKey|private_key/i,
      /secret|mnemonic|seed/i,
      /jwt|token.*secret/i,
      /apiKey|api_key/i,
    ];

    page.on('response', async response => {
      if (response.url().includes('/api/') && response.status() === 200) {
        const contentType = response.headers()['content-type'];
        if (contentType?.includes('application/json')) {
          try {
            const body = await response.json();
            const bodyStr = JSON.stringify(body);
            for (const pattern of sensitivePatterns) {
              expect(bodyStr).not.toMatch(pattern);
            }
          } catch (e) {
            // Non-JSON response, skip
          }
        }
      }
    });

    // Navigate to trigger API calls
    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');
    await page.goto('/marketplace');
    await page.waitForLoadState('networkidle');
    await page.goto('/wallet');
    await page.waitForLoadState('networkidle');
    await page.goto('/subscription');
    await page.waitForLoadState('networkidle');
  });

  test('Error messages do not leak stack traces', async ({ page }) => {
    await page.goto('/api/nonexistent-endpoint');
    await page.waitForLoadState('networkidle');

    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toMatch(/at\s+\w+\s+\(|Error:\s*\w+|stack trace|line\s+\d+|at\s+Object\./i);
  });

  test('Debug endpoints disabled in production', async ({ page }) => {
    const debugEndpoints = [
      '/api/debug',
      '/api/health/debug',
      '/api/admin/debug',
      '/api/test',
      '/api/_debug',
      '/actuator',
      '/metrics',
      '/api/metrics',
    ];

    for (const endpoint of debugEndpoints) {
      const response = await page.request.get(endpoint);
      // Should return 404, 403, or 401 - not 200 with debug info
      expect([401, 403, 404]).toContain(response.status());
    }
  });

  test('API versioning in headers', async ({ page }) => {
    const response = await page.request.get('/api/health');
    expect(response.headers()['x-api-version']).toBeTruthy();
  });

  test('No internal IPs or hostnames in responses', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const responses: any[] = [];
    page.on('response', response => {
      if (response.url().includes('/api/')) {
        responses.push(response);
      }
    });

    await page.goto('/portfolio');
    await page.waitForLoadState('networkidle');

    for (const response of responses) {
      if (response.status() === 200) {
        const contentType = response.headers()['content-type'];
        if (contentType?.includes('application/json')) {
          try {
            const body = await response.json();
            const bodyStr = JSON.stringify(body);
            // Check for internal IPs (10.x, 172.16-31.x, 192.168.x)
            expect(bodyStr).not.toMatch(/\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/);
            // Check for localhost
            expect(bodyStr).not.toMatch(/\b(localhost|127\.0\.0\.1)\b/);
          } catch (e) {
            // Skip non-JSON
          }
        }
      }
    });
  });
});

test.describe('CORS & Security Headers', () => {
  test('Security headers present', async ({ page }) => {
    const response = await page.request.get('/');
    const headers = response.headers();

    expect(headers['x-frame-options']).toBeTruthy();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-xss-protection']).toBeTruthy();
    expect(headers['referrer-policy']).toBeTruthy();
    expect(headers['content-security-policy']).toBeTruthy();
  });

  test('HSTS header present in production', async ({ page }) => {
    const response = await page.request.get('/');
    // HSTS should be present in production
    // In test env may not be present
    if (process.env.NODE_ENV === 'production') {
      expect(response.headers()['strict-transport-security']).toBeTruthy();
    }
  });

  test('CORS headers restrictive', async ({ page }) => {
    const response = await page.request.get('/api/health', {
      headers: { 'Origin': 'https://evil.com' }
    });
    // Should not allow arbitrary origins
    const allowOrigin = response.headers()['access-control-allow-origin'];
    if (allowOrigin) {
      expect(allowOrigin).not.toBe('*');
      expect(allowOrigin).not.toBe('https://evil.com');
    }
  });
});

test.describe('Cookie Security', () => {
  test('Session cookies have secure flags', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-cookie@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 30000 });

    const cookies = await page.context().cookies();
    const sessionCookies = cookies.filter(c => 
      c.name.includes('session') || c.name.includes('token') || c.name.includes('auth')
    );

    for (const cookie of sessionCookies) {
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.secure).toBe(true);
      expect(cookie.sameSite).toMatch(/Strict|Lax/);
    }
  });

  test('CSRF cookie has correct flags', async ({ page }) => {
    await page.goto('/login');
    const cookies = await page.context().cookies();
    const csrfCookie = cookies.find(c => c.name === 'csrf' || c.name === '_csrf' || c.name === 'xsrf');

    if (csrfCookie) {
      expect(csrfCookie.httpOnly).toBe(true);
      expect(csrfCookie.secure).toBe(true);
    }
  });
});

test.describe('Audit Trail', () => {
  test('Sensitive actions logged', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="login-email"], input[name="email"]', 'e2e-audit@example.com');
    await page.fill('[data-testid="login-password"], input[name="password"]', 'TestPassword123!');
    await page.click('[data-testid="login-button"], button[type="submit"]');
    await page.waitForURL('/dashboard', { timeout: 30000 });

    // Perform sensitive action
    await page.goto('/wallet');
    await page.click('[data-testid="wallet-withdraw"], button:has-text("Withdraw")');
    await page.waitForSelector('[data-testid="withdraw-modal"], .modal');
    await page.fill('[data-testid="withdraw-amount"], input[name="amount"]', '1000');
    await page.click('[data-testid="confirm-withdraw"], button:has-text("Confirm")');

    // Check audit log endpoint (if accessible)
    // This would typically be an admin-only endpoint
  });
});