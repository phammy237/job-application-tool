import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 1 e2e coverage (docs/IMPLEMENTATION_PLAN.md Phase 1 "Tests"): signup → login → edit
 * profile → create application → logout. Runs against a real Supabase project — there is no
 * mocked backend, so `apps/web/.env.local` must point at a project with the Phase 1
 * migration applied and `public_signups_enabled` on (or run against a pre-created user via
 * SEED_USER_EMAIL/SEED_USER_PASSWORD — see e2e/signup-flow.spec.ts).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
