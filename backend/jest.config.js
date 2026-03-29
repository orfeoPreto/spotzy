module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverageFrom: ['functions/**/*.ts', 'shared/**/*.ts'],
  coverageThreshold: { global: { branches: 80, functions: 90, lines: 90 } },
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/shared/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/factories/'],
};
