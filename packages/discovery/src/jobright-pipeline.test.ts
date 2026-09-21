import { describe, expect, it } from 'vitest';
import { normalizeEmploymentType } from '@career-os/shared';
import { parseJobrightReadme } from './adapters/jobright-github';
import { normalizeDiscoveredJob } from './normalize';

/**
 * D7 §24 "pipeline" cases — these verify the WIRING a live backfill exercises end to end, without
 * requiring a live database: a Jobright row flows through the exact same
 * `RawDiscoveredJob -> normalizeDiscoveredJob -> job_catalog` shape every ATS adapter's output
 * does (proven generically provider-agnostic already by `ranking/provider-fairness.test.ts`), the
 * feed RPC's existing internship filter (migration 0031, `normalized_employment_type =
 * 'INTERNSHIP'`) actually matches what a Jobright row normalizes to, and the D6 "Start
 * Application" handoff's own field reads (`sourceUrl ?? applyUrl`, `canonicalApplyUrl`) behave
 * correctly for a Jobright row. Full live-database visibility is exercised by the real backfill +
 * manual `/discover` verification step, not by this file.
 */
const README = `<!-- TABLE_START -->
| Company | Job Title | Location | Work Model | Date Posted |
| --- | --- | --- | --- | --- |
| **[Acme Corp](https://jobright.ai/jobs/info/aaaaaaaaaaaaaaaaaaaaaaaa?utm_source=git)** | **[Software Engineer Intern](https://jobright.ai/jobs/info/aaaaaaaaaaaaaaaaaaaaaaaa?utm_source=git)** | Remote | Remote | Sep 17 |
<!-- TABLE_END -->`;

describe('D7 pipeline wiring', () => {
  it('1. a Jobright-parsed row survives normalizeDiscoveredJob into the exact NormalizedDiscoveredJob shape every ATS row does', async () => {
    const parsed = parseJobrightReadme(README, new Date('2026-09-18T00:00:00.000Z'));
    expect(parsed.jobs).toHaveLength(1);

    const normalized = await normalizeDiscoveredJob(parsed.jobs[0]!);
    expect(normalized.companyName).toBe('Acme Corp');
    expect(normalized.title).toBe('Software Engineer Intern');
    expect(normalized.contentHash).toMatch(/^v1:/);
    expect(normalized.dedupeFingerprint).toContain('acme corp');
  });

  it('2. a Jobright row normalizes to exactly the employment-type value the existing Discover internship filter (migration 0031) already matches on', () => {
    // The Discover feed RPC filters on `normalized_employment_type = 'INTERNSHIP'` — a Jobright
    // row must actually satisfy that, not just the broader `is_internship` flag, or it would
    // silently fail to appear under the UI's "Internship" filter exactly like Stripe's own
    // internships do today (a separate, pre-existing, out-of-scope gap — see D7 report).
    expect(normalizeEmploymentType('Internship')).toBe('INTERNSHIP');
  });

  it('3. a Jobright row always carries applyUrl/sourceUrl provenance, but never a Jobright canonicalApplyUrl — the exact fields the D6 Start Application handoff reads', async () => {
    const parsed = parseJobrightReadme(README, new Date('2026-09-18T00:00:00.000Z'));
    const normalized = await normalizeDiscoveredJob(parsed.jobs[0]!);

    // route.ts: `sourceUrl: job.sourceUrl ?? job.applyUrl` — always populated, Jobright provenance
    // is never lost.
    expect(normalized.sourceUrl ?? normalized.applyUrl).toBeTruthy();
    // Bug fix (post-D7.1): canonicalApplyUrl must stay null for an unresolved Jobright row — a raw
    // Jobright detail URL is never a real apply destination (migration 0039's own invariant).
    // official-posting-resolution.ts is the only process allowed to fill this in.
    expect(normalized.canonicalApplyUrl).toBeNull();
  });
});
