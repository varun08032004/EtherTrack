# Phase 5 Test Infrastructure Documentation

**Date:** 2026-08-19

---

## Environment Versions

| Component | Version |
|-----------|---------|
| Node.js | v20.x |
| npm | v10.x |
| TypeScript | 5.3.x |
| Jest | 30.4.x |
| ts-jest | 29.4.x |
| uuid | 14.0.x |
| ethers | 6.9.x |

---

## Module System

The project uses **CommonJS** (`require`/`module.exports`) for the main codebase.

**Critical:** The production service files in `src/services/` currently use **ES Module syntax** (`import`/`export`). This creates a module system mismatch with the Jest test environment which expects CommonJS.

### Required Conversion Pattern

```typescript
// ❌ Current (ES Modules) - BREAKS TESTS
import { safeQuery: query, withTransaction } from '../../db/pool';
import { FeeService } from '../fee/FeeService';
export class FeeService { ... }

// ✅ Required (CommonJS) - WORKS WITH TESTS
const { safeQuery: query, withTransaction } = require('../../db/pool');
const { FeeService } = require('../fee/FeeService');
module.exports = { FeeService };
```

---

## Jest Configuration

### Main Config: `jest.config.test.js`

Key settings:
- **Preset:** `ts-jest`
- **Test Environment:** `node`
- **Module System:** CommonJS (`useESM: false`)
- **Module Resolution:** `NodeNext`
- **Transform:** TypeScript files via `ts-jest`

### Module Name Mapping

```javascript
moduleNameMapper: {
  '^../services/email$': '<rootDir>/__mocks__/email.js',
  '^../services/ipfs$': '<rootDir>/__mocks__/ipfs.js',
  '^../services/blockchain$': '<rootDir>/__mocks__/blockchain.js',
  '^../db/pool$': '<rootDir>/__mocks__/pool.js',
  '^../../db/pool$': '<rootDir>/__mocks__/pool.js',
  '^../lib/circuitBreaker$': '<rootDir>/__mocks__/circuitBreaker.js',
  '^../../lib/circuitBreaker$': '<rootDir>/__mocks__/circuitBreaker.js',
  '^../lib/advisoryLock$': '<rootDir>/__mocks__/advisoryLock.js',
  '^../../lib/advisoryLock$': '<rootDir>/__mocks__/advisoryLock.js',
  '^@supabase/supabase-js$': '<rootDir>/__mocks__/supabase.js',
  '^uuid$': '<rootDir>/__mocks__/uuid.js'
}
```

### Transform Ignore Patterns

```javascript
transformIgnorePatterns: [
  '/node_modules/(?!(@upstash/redis|ethers|uuid|@supabase/supabase-js|@opentelemetry/.*|uuid).*)'
]
```

---

## TypeScript Configuration

### Production: `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "NodeNext",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "ignoreDeprecations": "6.0"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "src/tests/**"]
}
```

### Test: `tsconfig.test.json`
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["jest", "node"],
    "noEmit": true,
    "isolatedModules": true
  },
  "include": ["src/**/*", "src/tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Mock Files

All mocks are in `__mocks__/` directory:

| Mock File | Purpose |
|-----------|---------|
| `__mocks__/pool.js` | Database pool mock with `safeQuery`, `withTransaction`, `healthCheck`, `shutdown` |
| `__mocks__/circuitBreaker.js` | Circuit breaker mock for external services |
| `__mocks__/advisoryLock.js` | PostgreSQL advisory lock mock |
| `__mocks__/uuid.js` | UUID v4/v5 mock returning deterministic values |
| `__mocks__/supabase.js` | Supabase client mock |
| `__mocks__/email.js` | Email service mock |
| `__mocks__/ipfs.js` | IPFS service mock |
| `__mocks__/blockchain.js` | Blockchain service mock |
| `__mocks__/circuitBreaker.js` | Circuit breaker mock |
| `__mocks__/advisoryLock.js` | Advisory lock mock |

---

## Test Database Setup

### Requirements
- **Separate test database** (not production)
- **Migration runner** for schema setup
- **Transaction rollback** for test isolation
- **Connection pooling** with test limits

### Implementation Needed
```javascript
// jest.setup.ts
beforeAll(async () => {
  // 1. Create test database
  // 2. Run migrations
  // 3. Seed test data
});

afterAll(async () => {
  // 1. Drop test database
  // 2. Close connections
});
```

### Current Status
- ❌ Not implemented
- Tests use mocked database pool instead

---

## Redis Test Setup

### Requirements
- **Separate Redis instance** (not production)
- **Flush between test suites**
- **Key prefix isolation**

### Current Status
- ❌ Not implemented
- Cache tests use mocked Redis

---

## Blockchain Test Setup

### Options
1. **Local Anvil/Ganache** - Deterministic, fast, no network
2. **Public Testnet** - Real conditions, flaky, rate limited
3. **Mock Provider** - Fast, deterministic, limited realism

### Recommended: Local Anvil
```bash
anvil --port 8545 --chain-id 31337 --accounts 10 --balance 10000
```

### Required Simulations
- RPC timeout
- Transaction revert
- Transaction submission
- Confirmation (1 block)
- Duplicate event
- Event replay
- Missing response

### Current Status
- ❌ Not implemented
- Event processor tests use mocked ethers.js

---

## Payment Test Setup

### Razorpay Mock Requirements
- Order creation
- Payment verification (signature validation)
- Payment capture
- Refund processing
- Webhook handling (success, failure, duplicate, out-of-order)

### Test Scenarios
| Scenario | Expected Behavior |
|----------|-------------------|
| Success | Payment captured, seller credited |
| Failure | Payment failed, buyer refunded |
| Timeout | Payment failed, buyer refunded |
| Duplicate webhook | Idempotent, no double processing |
| Out-of-order webhook | Handled correctly |
| Refund | Refund processed, accounts updated |
| Refund failure | Alert, manual intervention |

### Current Status
- ❌ Not implemented
- Payment tests use mocked Razorpay

---

## Running Tests

### All Tests
```bash
npx jest --config=jest.config.test.js
```

### By Category
```bash
# Unit tests only
npx jest --config=jest.config.test.js --projects=unit

# Integration tests only
npx jest --config=jest.config.test.js --projects=integration

# Concurrency tests only
npx jest --config=jest.config.test.js --projects=concurrency

# Failure injection tests only
npx jest --config=jest.config.test.js --projects=failure-injection

# E2E tests only
npx jest --config=jest.config.test.js --projects=e2e
```

### Coverage Report
```bash
npx jest --config=jest.config.test.js --coverage
```

---

## Troubleshooting

### Module Resolution Errors
```
Cannot find module '../../db/pool'
```
**Fix:** Ensure `moduleNameMapper` in Jest config maps the path correctly, and the mock file exists at `__mocks__/pool.js`.

### TypeScript Compilation Errors
```
error TS5101: Option 'baseUrl' is deprecated
```
**Fix:** Add `"ignoreDeprecations": "6.0"` to tsconfig.json compilerOptions.

### UUID Import Errors
```
SyntaxError: Unexpected token 'export'
```
**Fix:** Add `'^uuid$': '<rootDir>/__mocks__/uuid.js'` to `moduleNameMapper`.

### ts-jest Isolated Modules Warning
```
The "ts-jest" config option "isolatedModules" is deprecated
```
**Fix:** Add `"isolatedModules": true` to tsconfig.test.json compilerOptions.

---

## Test Execution Checklist

Before running full test suite, verify:

- [ ] All service files converted to CommonJS
- [ ] Mock files exist in `__mocks__/`
- [ ] Jest config moduleNameMapper matches import paths
- [ ] tsconfig.test.json extends tsconfig.json correctly
- [ ] Test database available and migrated
- [ ] Redis instance available (or mocked)
- [ ] Anvil/Ganache running for blockchain tests (or mocked)
- [ ] Razorpay test keys configured (or mocked)

---

## Continuous Integration

### GitHub Actions Example
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run db:migrate:test
      - run: npx jest --config=jest.config.test.js --ci --coverage
```

---

## Known Issues

1. **Service files use ES Modules** - Must convert to CommonJS for tests to work
2. **No test database** - Integration tests disabled
3. **No local blockchain** - E2E tests disabled
4. **No Redis instance** - Cache tests disabled
5. **Razorpay not mocked** - Payment tests disabled

---

## Future Improvements

1. **Convert all services to CommonJS** - Unlock full test suite
2. **Add test database with Docker Compose** - Enable integration tests
3. **Add Anvil for local blockchain** - Enable E2E tests
4. **Add proper Razorpay mock** - Enable payment tests
5. **Add property-based testing** - For financial invariants
6. **Add contract testing** - For API contracts
7. **Add chaos engineering** - For failure injection