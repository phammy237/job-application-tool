import { describe, expect, it } from 'vitest';
import { API_BASE_URL } from './api-client';

/**
 * Regression coverage for the real production incident: a stray `apps/extension/.env.local`
 * (Vite loads `.env.local` in every mode, including `vite build`'s default `production` mode)
 * baked `http://localhost:3003` into a "production" build, so the popup's `Analyze Job` request
 * never reached apply.mypham.space at all — a raw `TypeError: Failed to fetch`, not an HTTP
 * error (docs/DEPLOYMENT.md §5). Fixed by renaming that file to `.env.development.local` (Vite
 * only loads it in `development` mode); this test proves the *default* resolution — no
 * dev-only override present, exactly the state any build (`vitest run`, `vite build`, CI) sees
 * unless a developer deliberately opts into `.env.development.local` — is the real production
 * origin, never a loopback address.
 */
describe('API_BASE_URL', () => {
  it('resolves to the production Career OS origin by default', () => {
    expect(API_BASE_URL).toBe('https://apply.mypham.space');
  });

  it('is never a localhost/loopback address by default', () => {
    expect(API_BASE_URL).not.toMatch(/localhost|127\.0\.0\.1/);
  });
});
