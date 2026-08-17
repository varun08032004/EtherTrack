# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests\auth.spec.ts >> Authentication Flows >> Login fails with empty fields
- Location: e2e\tests\auth.spec.ts:79:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('button[type="submit"]')

```

```
Tearing down "context" exceeded the test timeout of 30000ms.
```