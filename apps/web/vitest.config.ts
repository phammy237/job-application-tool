import { defineConfig } from 'vitest/config';

/**
 * apps/web has two separate test runners: Playwright for e2e/*.spec.ts (real browser, real
 * server) and Vitest for everything else (route-handler unit tests). Without excluding e2e/,
 * Vitest's default *.spec.ts glob would try to execute Playwright specs using Playwright's own
 * test/expect globals, which fail outside `playwright test`.
 */
export default defineConfig({
  test: {
    exclude: ['node_modules/**', '.next/**', 'e2e/**'],
  },
});
