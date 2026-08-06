import { expect, test } from '@playwright/test';

/**
 * Phase 1 end-to-end coverage (docs/IMPLEMENTATION_PLAN.md Phase 1 "Tests"): signup → login →
 * edit profile → create application → logout, run against a real Supabase project — there is
 * no mocked backend.
 *
 * Before running (`npm run test:e2e` from apps/web, or the repo root):
 *   1. apps/web/.env.local points at a Supabase project with
 *      supabase/migrations/0001_init.sql applied.
 *   2. feature_flags.public_signups_enabled is `true` (Table Editor), OR remove the signup
 *      step below and log in with a user you created directly in Supabase Studio instead.
 *   3. Authentication → Providers → Email → "Confirm email" is off, so signUp() returns a
 *      live session immediately instead of requiring a confirmation-link click this test
 *      can't follow.
 *
 * Each run creates a new real account (unique email per run) — expected for a personal/dev
 * project; not meant to run against a project with real user data.
 */

test('signup → login → edit profile → create application → logout', async ({ page }) => {
  const uniqueEmail = `e2e-${Date.now()}@example.com`;
  const password = 'TestPassword123!';

  // ---- Signup ---------------------------------------------------------------------------
  await page.goto('/join');

  const inviteOnlyNotice = page.getByText('Sign-ups are invite-only right now');
  if (await inviteOnlyNotice.isVisible().catch(() => false)) {
    throw new Error(
      'public_signups_enabled is off — flip it in the feature_flags table to run this test, ' +
        'or adapt this spec to log in with a pre-created Supabase Studio user.',
    );
  }

  await page.getByLabel('Email').fill(uniqueEmail);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Either straight into the app (email confirmation disabled) or back to /login with a
  // "check your email" notice (confirmation required) — handle both, then ensure we're
  // logged in either way.
  await page.waitForURL(/\/(dashboard|login)/);
  if (page.url().includes('/login')) {
    await page.getByLabel('Email').fill(uniqueEmail);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL(/\/dashboard/);
  }

  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText(uniqueEmail)).toBeVisible();

  // ---- Edit profile -----------------------------------------------------------------------
  await page.getByRole('link', { name: 'Profile' }).click();
  await page.waitForURL(/\/profile/);

  const fullName = 'E2E Test User';
  await page.getByLabel('Full name').fill(fullName);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('Full name')).toHaveValue(fullName);

  await page.getByText('Add experience').click();
  await page.getByLabel('Company').fill('Acme Corp');
  await page.getByLabel('Title', { exact: true }).fill('Software Engineer');
  await page.getByRole('button', { name: 'Add experience' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Software Engineer · Acme Corp')).toBeVisible();

  // ---- Create application ------------------------------------------------------------------
  await page.getByRole('link', { name: 'Applications' }).click();
  await page.waitForURL(/\/applications$/);

  await page.getByText('Add application').click();
  await page.getByLabel('Company').fill('Globex Corporation');
  await page.getByLabel('Title').fill('Backend Engineer');
  await page.getByRole('button', { name: 'Add application' }).click();

  // createApplication redirects straight to the new application's detail page.
  await page.waitForURL(/\/applications\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Backend Engineer' })).toBeVisible();
  await expect(page.getByText('Globex Corporation')).toBeVisible();

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
