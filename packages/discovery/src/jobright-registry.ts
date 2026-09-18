/**
 * D7 — the small, explicit set of Jobright public GitHub internship repositories this catalog
 * ingests. Deliberately not "every Jobright repo" (docs/JOB_DISCOVERY.md "Jobright GitHub source")
 * — internships only, exactly the five role families requested. Adding a sixth repo later is one
 * array entry here plus one `import-sources` JSON entry; no adapter code changes.
 *
 * `roleFamilyHint` is non-authoritative metadata: it is never read by feature extraction or
 * ranking, and exists only for this registry's own human-readability plus a future "did the hint
 * match what we actually extracted" health signal. The deterministic title-based
 * `extractRoleFamily` extractor remains the sole source of truth for a job's actual role family.
 */
export interface JobrightGithubRepoConfig {
  /** `owner/repo`, exactly as it appears in the GitHub URL. */
  repo: string;
  /** Human-readable label used as this source's `job_sources.company_name` — there is no single
   * "employer" for an aggregator source; each `job_catalog` row's own `company_name` is the real
   * employer, extracted per-row from the README table. */
  label: string;
  roleFamilyHint:
    | 'PRODUCT_MANAGEMENT'
    | 'SOFTWARE_ENGINEERING'
    | 'DATA_ANALYTICS'
    | 'BUSINESS_ANALYTICS'
    | 'CONSULTING';
}

export const JOBRIGHT_GITHUB_REPOS: readonly JobrightGithubRepoConfig[] = [
  {
    repo: 'jobright-ai/2026-Product-Management-Internship',
    label: 'Jobright — Product Management Internships',
    roleFamilyHint: 'PRODUCT_MANAGEMENT',
  },
  {
    repo: 'jobright-ai/2026-Software-Engineer-Internship',
    label: 'Jobright — Software Engineer Internships',
    roleFamilyHint: 'SOFTWARE_ENGINEERING',
  },
  {
    repo: 'jobright-ai/2026-Data-Analysis-Internship',
    label: 'Jobright — Data Analysis Internships',
    roleFamilyHint: 'DATA_ANALYTICS',
  },
  {
    repo: 'jobright-ai/2026-Business-Analyst-Internship',
    label: 'Jobright — Business Analyst Internships',
    roleFamilyHint: 'BUSINESS_ANALYTICS',
  },
  {
    repo: 'jobright-ai/2026-Consultant-Internship',
    label: 'Jobright — Consultant Internships',
    roleFamilyHint: 'CONSULTING',
  },
] as const;
