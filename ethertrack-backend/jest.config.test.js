export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/tests'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.mjs'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      isolatedModules: true,
      tsconfig: 'tsconfig.test.json'
    }]
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@upstash/redis|ethers|uuid|@supabase/supabase-js|@opentelemetry/.*|uuid).*)'
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
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
    '^uuid$': '<rootDir>/__mocks__/uuid.js',
    // Map .js imports to .ts files for ESM
    '^(.*)\\.js$': '$1.ts'
  },
  collectCoverageFrom: [
    'src/services/**/*.ts',
    '!src/services/**/*.test.ts',
    '!src/tests/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 30000,
  verbose: true,
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.test.json',
      useESM: true
    }
  },
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/tests/unit/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/tests/setup.mjs'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { useESM: true, isolatedModules: true, tsconfig: 'tsconfig.test.json' }]
      }
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/src/tests/integration/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/tests/setup.mjs'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { useESM: true, isolatedModules: true, tsconfig: 'tsconfig.test.json' }]
      }
    },
    {
      displayName: 'concurrency',
      testMatch: ['<rootDir>/src/tests/concurrency/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/tests/setup.mjs'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { useESM: true, isolatedModules: true, tsconfig: 'tsconfig.test.json' }]
      }
    },
    {
      displayName: 'failure-injection',
      testMatch: ['<rootDir>/src/tests/failure-injection/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/tests/setup.mjs'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { useESM: true, isolatedModules: true, tsconfig: 'tsconfig.test.json' }]
      }
    },
    {
      displayName: 'e2e',
      testMatch: ['<rootDir>/src/tests/e2e/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/tests/setup.mjs'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { useESM: true, isolatedModules: true, tsconfig: 'tsconfig.test.json' }]
      }
    }
  ]
};