const shared = {
  rootDir: '.',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  setupFiles: ['reflect-metadata'],
};

const withPostgres = {
  ...shared,
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  globalTeardown: '<rootDir>/test/support/global-teardown.ts',
};

/** @type {import('jest').Config} */
module.exports = {
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/**/migrate.ts',
    '!src/**/seed.ts',
    '!src/openapi/generate.ts',
  ],
  coverageDirectory: 'coverage',
  // The domain core decides what is bookable, so CI fails when its tests stop covering it (SD §11).
  coverageThreshold: {
    './src/domain/': { lines: 95, branches: 95 },
  },
  testTimeout: 30_000,
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
    },
    {
      ...withPostgres,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
    },
    {
      ...withPostgres,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
    },
  ],
};
