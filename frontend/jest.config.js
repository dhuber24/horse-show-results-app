const nextJest = require('next/jest');

// `next/jest` wires the SWC transform, tsconfig path aliases (`@/`), .env
// loading and the .next ignores, so there is no Babel config to maintain
// alongside Next 15 / React 19.
const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jest-environment-jsdom',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  // Scoped to lib/ on purpose. This suite covers pure helpers — money
  // formatting, the redirect sanitiser, report cells — and a coverage number
  // spread across every page and component would report ~0% and tell nobody
  // anything. Widen it when there is something else worth counting.
  collectCoverageFrom: ['lib/**/*.ts', '!lib/**/*.test.ts'],
};

module.exports = createJestConfig(config);
