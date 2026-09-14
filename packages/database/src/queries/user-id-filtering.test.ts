import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * CLAUDE.md: "RLS is the backstop, not the only check" — every query function scoped to the
 * caller's own rows must independently filter by user_id, not rely on RLS alone. This is a
 * structural regression guard: it fails if a future edit to a queries/*.ts file removes the
 * `.eq('user_id', ...)` filter, even though RLS would still (in a real database) prevent
 * cross-user access. It complements, and does not replace, the pgTAP RLS isolation tests in
 * supabase/tests/database/ which verify the actual database-enforced boundary.
 *
 * feature_flags is exempt — it is not a user-owned table (docs/DATA_MODEL.md). Co-located
 * *.test.ts files are exempt too — they exercise a query module's own user_id filtering with a
 * fake client rather than containing a `.eq('user_id', ...)` call themselves.
 *
 * consistency.ts (Phase 5B.2) is exempt for a different, still-narrow reason: it issues no
 * direct table query of its own at all — it is a pure orchestrator that composes
 * already-independently-scoped functions from other files in this directory
 * (listOwnGeneratedAnswersForApplication, listOwnEducation, listOwnExperiences, getOwnProfile),
 * each of which is itself covered by this same test. There is nothing for a literal
 * `.eq('user_id', ...)` pattern to match here without adding a redundant, unused filter just to
 * satisfy this scan.
 *
 * resume-tailoring-save.ts (Phase 7F) is exempt for the same "no direct table query" reason: its
 * one function only calls the service-role-only `save_reviewed_tailored_resume` RPC, passing
 * `p_user_id` as an RPC argument rather than a `.eq('user_id', ...)` filter — ownership is
 * verified inside that row-locked database function itself (migration 0024), proven by the
 * pgTAP cross-user rejection assertions in supabase/tests/database/0029_resume_tailoring_save.
 * test.sql, not by a PostgREST-level filter this file could add.
 */
const EXEMPT_FILES = new Set(['feature-flags.ts', 'consistency.ts', 'resume-tailoring-save.ts']);

describe('every user-scoped query filters by user_id explicitly', () => {
  const queriesDir = __dirname;
  const files = readdirSync(queriesDir).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !EXEMPT_FILES.has(f),
  );

  it('found the expected set of query modules', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of files) {
    it(`${file} contains at least one .eq('user_id', ...) filter`, () => {
      const source = readFileSync(join(queriesDir, file), 'utf-8');
      expect(source).toMatch(/\.eq\('user_id',/);
    });
  }
});
