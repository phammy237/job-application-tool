import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

/**
 * Phase 1 end-to-end coverage (docs/IMPLEMENTATION_PLAN.md Phase 1 "Tests"): account creation →
 * login → edit profile → create application → logout, run against a real Supabase project —
 * there is no mocked backend.
 *
 * The account itself is created via the Admin API with `email_confirm: true` rather than
 * through the public /join form, because Supabase's built-in mailer rate-limits confirmation
 * emails heavily (a few per hour on the free tier) and this test can't click a confirmation
 * link anyway. This matches the fallback this file's comments used to describe: "log in with a
 * user you created directly ... instead" of exercising the public signup form. The public
 * /join → /login redirect-on-success behavior is exercised manually / is covered by the
 * app's own signup unit coverage, not by this spec.
 *
 * Before running (`npm run test:e2e` from apps/web, or the repo root):
 *   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must point at a Supabase project
 *   with supabase/migrations/0001_init.sql applied — locally via apps/web/.env.local, in CI via
 *   injected secrets (see .github/workflows/ci.yml). The service-role key is used here only to
 *   seed the test account server-side — never sent to the browser.
 *
 * Each run creates a new real account (unique email per run) — expected for a personal/dev
 * project; not meant to run against a project with real user data.
 */

function readEnv(): Record<string, string | undefined> {
  // CI injects these as real process.env vars (see .github/workflows/ci.yml); local dev keeps
  // them in apps/web/.env.local, which process.env won't have picked up since this file runs
  // outside Next.js's own env loading.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env;

  const envPath = path.join(__dirname, '..', '.env.local');
  const content = fs.readFileSync(envPath, 'utf8');
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return vars;
}

test('login → edit profile → create application → logout', async ({ page }) => {
  const uniqueEmail = `e2e-${Date.now()}@gmail.com`;
  const password = 'TestPassword123!';

  // ---- Seed a pre-confirmed account via the Admin API (never exposed to the browser) ------
  const env = readEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('.env.local is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: createError } = await adminClient.auth.admin.createUser({
    email: uniqueEmail,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  // ---- Login ------------------------------------------------------------------------------
  await page.goto('/login');
  await page.getByLabel('Email').fill(uniqueEmail);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/dashboard/);

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(uniqueEmail).first()).toBeVisible();

  // ---- Edit profile -----------------------------------------------------------------------
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await page.waitForURL(/\/profile/);

  const fullName = 'E2E Test User';
  await page.getByLabel('Full name').fill(fullName);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('Full name')).toHaveValue(fullName);

  await page.locator('summary', { hasText: 'Add experience' }).click();
  await page.getByLabel('Company').fill('Acme Corp');
  await page.getByLabel('Title', { exact: true }).fill('Software Engineer');
  await page.locator('button[type="submit"]', { hasText: 'Add experience' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Software Engineer · Acme Corp')).toBeVisible();

  // ---- Create application ------------------------------------------------------------------
  await page.getByRole('link', { name: 'Applications' }).click();
  await page.waitForURL(/\/applications$/);

  await page.locator('summary', { hasText: 'Add application' }).click();
  await page.getByLabel('Company').fill('Globex Corporation');
  await page.getByLabel('Title').fill('Backend Engineer');
  await page.locator('button[type="submit"]', { hasText: 'Add application' }).click();

  // createApplication redirects straight to the new application's detail page.
  await page.waitForURL(/\/applications\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Backend Engineer' })).toBeVisible();
  await expect(
  page.getByText('Globex Corporation', { exact: true }),
).toBeVisible();

  await page.getByLabel('Status').selectOption('INTERVIEW');
  await page.getByRole('button', { name: 'Update status' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('SAVED → INTERVIEW')).toBeVisible();

  await page.getByRole('link', { name: 'Applications' }).click();
  await page.waitForURL(/\/applications$/);
  await expect(page.getByText('Globex Corporation')).toBeVisible();

  // ---- Logout -------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('/');

  // Session is gone — the authenticated area redirects to /login again.
  await page.goto('/dashboard');
  await page.waitForURL(/\/login/);
  });