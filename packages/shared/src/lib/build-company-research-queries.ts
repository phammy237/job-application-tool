/**
 * Deterministic search-query templates (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §17/§18) — an LLM
 * is never asked to freely generate search queries. Pure string formatting, no AI/network access.
 * Bounded at 6 queries total (§18's "~4–6 search queries"): five fixed templates always run, plus
 * at most one role-topic query when a real topic is available — never one query per topic, which
 * would make the bound scale with how many requirements a job posting happens to list.
 */
export const MAX_COMPANY_RESEARCH_QUERIES = 6;

export function buildCompanyResearchQueries(params: {
  companyName: string;
  /** A short, already-extracted role-relevant topic phrase (e.g. "AI-powered developer tools") —
   * not a whole requirement sentence. Only the first is used (§44: favor role relevance over a
   * generic news dump, without unbounding the query count per topic). */
  topRequirementTopics: string[];
}): string[] {
  const { companyName } = params;
  const queries = [
    `${companyName} official website`,
    `${companyName} newsroom press release`,
    `${companyName} latest product announcement`,
    `${companyName} investor relations`,
    `${companyName} recent news`,
  ];

  const topic = params.topRequirementTopics.find((t) => t.trim().length > 0);
  if (topic) {
    queries.push(`${companyName} ${topic.trim()}`);
  }

  return queries.slice(0, MAX_COMPANY_RESEARCH_QUERIES);
}
