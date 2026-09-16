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
 *
 * job-sources.ts and job-catalog.ts (Job Discovery Track D1) are exempt for the same reason as
 * feature_flags: `job_sources`/`job_catalog` are deliberately global, platform-owned tables with
 * no `user_id` column at all (docs/JOB_DISCOVERY.md) — there is no per-user row to scope by, by
 * design, not by omission. Every write goes through the service-role admin client exclusively
 * (no authenticated write RLS policy on either table), which is the actual enforcement boundary
 * here, verified by supabase/tests/database/'s job-discovery pgTAP suite.
 *
 * job-catalog-features.ts (Job Discovery Track D4) is exempt for the same "deliberately global,
 * no user_id column" reason as job-catalog.ts — `job_catalog_features` is derived, user-
 * independent job data.
 *
 * candidate-competency-codes.ts (Job Discovery Track D4) is exempt for the same "no direct table
 * query" reason as consistency.ts: it issues no query of its own — it composes
 * listOwnSkills/listOwnExperiences/listOwnEducation/listOwnProjects/listOwnCandidateFacts, each
 * already covered by this same test.
 *
 * discovery-feed.ts (Job Discovery Track D5A) is exempt for a combination of the above reasons:
 * `listOwnDiscoveryFeed`/`listDiscoveryLocationTokens` call `SECURITY INVOKER` RPCs
 * (`list_own_discovery_feed`, `list_discovery_location_tokens` — migration 0031) that scope
 * themselves via `auth.uid()` inside the function body, the same "ownership enforced inside the
 * database function, not by a PostgREST filter this file could add" shape as
 * resume-tailoring-save.ts (proven by this migration's pgTAP cross-user tests, not by a literal
 * pattern here); `getOwnDiscoveryFeedJobDetail` issues no direct table query of its own — it
 * composes `getJobCatalogEntryById`/`getJobCatalogFeatures` (exempt, global job data) and
 * `getOwnMatchScore` (already covered by this same test), the same "pure composer" shape as
 * consistency.ts.
 *
 * A whole-file exemption is a wider trust boundary than any other entry above (resume-tailoring-
 * save.ts and consistency.ts each have exactly one function to reason about; this file has three,
 * and two different bypass shapes — an unsafe `.rpc()` call, or a reintroduced direct `.from()`
 * query). The "discovery-feed.ts RPC/composition allow-list" suite directly below closes that gap
 * with a narrower, positively-enumerated check specific to this file: every `.rpc()` call site
 * must name one of the two RPCs actually verified for auth.uid() scoping (pgTAP,
 * supabase/tests/database/0034_job_discovery_feed.test.sql), and the file must contain zero
 * `.from()` calls at all. A future edit that adds a new RPC call, or any direct table query, to
 * this file fails one of those two assertions immediately — the file being in EXEMPT_FILES above
 * no longer means "trust it silently," it means "trust it only within what the allow-list below
 * still enforces."
 */
const EXEMPT_FILES = new Set([
  'feature-flags.ts',
  'consistency.ts',
  'resume-tailoring-save.ts',
  'job-sources.ts',
  'job-catalog.ts',
  'job-catalog-features.ts',
  'candidate-competency-codes.ts',
  'discovery-feed.ts',
]);

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

/**
 * Narrows the discovery-feed.ts whole-file exemption above: this file's own ownership boundary
 * is enforced by RLS + the two RPCs' own `auth.uid()` scoping (pgTAP-verified), not by a
 * `.eq('user_id', ...)` filter the generic scan above can look for — but that's exactly the kind
 * of claim that must stay checked, not just asserted in a comment. These two assertions are the
 * concrete bypass vectors: a new `.rpc()` call naming something other than the two RPCs already
 * verified for auth.uid() scoping, or a reintroduced direct `.from()` table query that would skip
 * both RLS's usual per-row filter *and* this file's own user_id-filter convention. Either one
 * failing here means discovery-feed.ts changed in a way its EXEMPT_FILES entry no longer covers.
 */
describe('discovery-feed.ts RPC/composition allow-list', () => {
  const source = readFileSync(join(__dirname, 'discovery-feed.ts'), 'utf-8');

  // The only two RPCs this file is allowed to call — both SECURITY INVOKER, both scoped via
  // auth.uid() inside the function body (migration 0031), both proven cross-user-isolated by
  // supabase/tests/database/0034_job_discovery_feed.test.sql. Adding a new RPC call here requires
  // adding it to this list *and* to that pgTAP suite's own cross-user assertions first.
  const RPC_ALLOW_LIST = new Set(['list_own_discovery_feed', 'list_discovery_location_tokens']);

  it('calls no .from() table query directly — every read goes through an RLS-scoped RPC or an already-scoped composed function', () => {
    expect(source).not.toMatch(/\.from\(/);
  });

  it('every .rpc() call site names an RPC already verified for auth.uid() scoping', () => {
    const rpcCalls = [...source.matchAll(/\.rpc\(\s*['"]([a-zA-Z0-9_]+)['"]/g)].map((m) => m[1]);
    expect(rpcCalls.length).toBeGreaterThan(0); // the test itself must exercise a real call site
    for (const name of rpcCalls) {
      expect(RPC_ALLOW_LIST.has(name as string)).toBe(true);
    }
  });
});
