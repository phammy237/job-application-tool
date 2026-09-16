import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COVERAGE_BUCKET_THRESHOLDS } from './default-discovery-order';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * `default-discovery-order.ts` is the documented single source of truth for the default
 * `/discover` ordering rule; migration 0031's `coverage_bucket` generated column and
 * `list_own_discovery_feed`'s `ORDER BY` clause are supposed to mirror it exactly, in SQL, for the
 * real reason a generated+indexed column exists at all (Postgres can't index an ORDER BY over an
 * ad-hoc CASE computed at query time). Two independent implementations of the same rule, in two
 * languages, is a real drift risk: nothing stops a future edit to one from silently diverging from
 * the other. This test is the parity contract — it reads the actual migration SQL as text and
 * checks it against this file's own exported constants, so it fails the moment either side
 * changes without the other, without requiring a running Postgres or moving ranking logic
 * client-side (the RPC's indexed SQL ORDER BY stays the only thing that actually sorts a real
 * result set — see default-discovery-order.ts's own docstring).
 */

const MIGRATION_PATH = join(
  __dirname,
  '../../../../supabase/migrations/0031_job_discovery_feed.sql',
);
const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8');

describe('default discovery order: TypeScript <-> SQL parity (migration 0031)', () => {
  it('the coverage_bucket generated column uses the exact same HIGH threshold as getCoverageBucket', () => {
    const match = migrationSql.match(/when coverage >= (\d+) then 0/);
    expect(match, 'expected to find the HIGH-bucket (0) threshold in the generated column CASE').not.toBeNull();
    expect(Number(match?.[1])).toBe(COVERAGE_BUCKET_THRESHOLDS.HIGH_MIN);
  });

  it('the coverage_bucket generated column uses the exact same MODERATE threshold as getCoverageBucket', () => {
    const match = migrationSql.match(/when coverage >= (\d+) then 1/);
    expect(
      match,
      'expected to find the MODERATE-bucket (1) threshold in the generated column CASE',
    ).not.toBeNull();
    expect(Number(match?.[1])).toBe(COVERAGE_BUCKET_THRESHOLDS.MODERATE_MIN);
  });

  it('the generated column falls through to bucket 2 (LOW) below the MODERATE threshold, matching getCoverageBucket', () => {
    // Order matters: `when coverage >= HIGH then 0`, `when coverage >= MODERATE then 1`,
    // `else 2` — a bare `else 2` with no further condition is the SQL equivalent of
    // getCoverageBucket's final `return 'LOW'` fallthrough.
    const caseBlock = migrationSql.match(/coverage_bucket smallint generated always as \(([\s\S]*?)\) stored;/)?.[1];
    expect(caseBlock, 'expected to find the coverage_bucket generated column definition').toBeTruthy();
    expect(caseBlock).toMatch(/else\s+2\s*\n?\s*end/);
  });

  it("list_own_discovery_feed's ORDER BY matches compareForDefaultDiscoveryOrder's exact precedence: bucket asc, then match desc, then id asc", () => {
    // This is the literal SQL precedence compareForDefaultDiscoveryOrder's own JSDoc describes it
    // as mirroring — bucket ascending (best coverage tier first) is checked before match_score
    // descending, which is checked before the job id tiebreaker, exactly the order
    // compareForDefaultDiscoveryOrder's three `if` branches return early in.
    expect(migrationSql).toMatch(
      /order by ujms\.coverage_bucket asc, ujms\.match_score desc, jc\.id asc/,
    );
  });

  it('the ORDER BY clause never references eligibility_status, company_name, or any provider-identity column — coverage/match/id are the only inputs on either side', () => {
    const orderByLine = migrationSql.match(/order by [^\n]+/)?.[0];
    expect(orderByLine, 'expected to find the ORDER BY clause').toBeTruthy();
    expect(orderByLine).not.toMatch(/eligibility_status|company_name|company|provider|source_id/);
  });

  it('match_score and coverage are NOT NULL, CHECK(0-100) at the schema level — there is no NULL/UNKNOWN case for either layer to handle', () => {
    // Confirmed against migration 0030 (the table's own definition, not 0031): both columns are
    // `not null check (... >= 0 and ... <= 100)`. DiscoveryOrderItem's TS type agrees — matchScore
    // and coverage are both plain `number`, never `number | null` — so getCoverageBucket/
    // compareForDefaultDiscoveryOrder never need a NULL branch, and neither does the SQL CASE/
    // ORDER BY. (Eligibility's own UNKNOWN status is a completely different field —
    // eligibility_status — and, per the assertion above, never an input to default ordering at
    // all.) This test's own assertion lives in migration 0030, read here only to keep the "no
    // NULL case exists" claim checked rather than merely stated in a comment.
    const migration0030Path = join(
      __dirname,
      '../../../../supabase/migrations/0030_job_discovery_ranking.sql',
    );
    const migration0030Sql = readFileSync(migration0030Path, 'utf-8');
    expect(migration0030Sql).toMatch(
      /match_score numeric\(5, 2\) not null check \(match_score >= 0 and match_score <= 100\)/,
    );
    expect(migration0030Sql).toMatch(
      /coverage numeric\(5, 2\) not null check \(coverage >= 0 and coverage <= 100\)/,
    );
  });
});
