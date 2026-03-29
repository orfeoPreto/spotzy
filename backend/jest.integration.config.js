/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/integration/**/*.test.ts'],
  testTimeout: 30000,
  // Integration tests do NOT mock AWS SDK — they hit real DynamoDB Local
  setupFiles: [],
  globals: {
    'ts-jest': {
      tsconfig: { esModuleInterop: true },
    },
  },
};
