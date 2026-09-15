import { canonicalizeUrl } from './canonicalize-url';
import { extractRegistrableDomain } from './classify-company-research-source';
import type { CompanyResearchSourceType } from '../schemas/company-research';

/** Priority tiers for source ranking (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §19): official
 * primary sources first, then investor/regulatory material, then other official material, then
 * reputable independent reporting, then everything else. Search ranking itself is never treated
 * as source quality (§19) — this fixed tier order is the only ranking signal used. */
const SOURCE_TYPE_PRIORITY: Record<CompanyResearchSourceType, number> = {
  OFFICIAL_WEBSITE: 0,
  INVESTOR_RELATIONS: 1,
  OFFICIAL_NEWSROOM: 2,
  ENGINEERING_BLOG: 2,
  PRODUCT_BLOG: 2,
  CAREERS: 2,
  REPUTABLE_NEWS: 3,
  OTHER: 4,
};

export interface RankableCompanyResearchSource {
  url: string;
  sourceType: CompanyResearchSourceType;
}

const DEFAULT_MAX_SOURCES = 12;
const DEFAULT_MAX_PER_DOMAIN = 3;

/**
 * Deduplicates, ranks, and bounds discovered sources before extraction (docs/
 * IMPLEMENTATION_PLAN.md "Phase 7G" §54–§56) — pure, deterministic, no network access. Three
 * passes:
 *   1. Dedupe by `canonicalizeUrl` (strips tracking params/fragments, lowercases host, trims a
 *      trailing slash) — the exact same normalization Phase 4C already uses for job-posting URL
 *      matching, not a second implementation. The *first* occurrence of a duplicate wins, so
 *      callers should already have their most-preferred copy of a URL earliest in `candidates`.
 *   2. Stable-sort by `SOURCE_TYPE_PRIORITY` — never by whatever order the search provider
 *      returned results in (§19: "do not treat search ranking itself as source quality").
 *   3. Greedy bounded selection: at most `maxSources` total, at most `maxPerDomain` from any one
 *      registrable domain (§56 — prefers "official primary source + independent confirmation"
 *      over ten copies of the same syndicated press release).
 */
export function selectCompanyResearchSources<T extends RankableCompanyResearchSource>(
  candidates: T[],
  options: { maxSources?: number; maxPerDomain?: number } = {},
): T[] {
  const maxSources = options.maxSources ?? DEFAULT_MAX_SOURCES;
  const maxPerDomain = options.maxPerDomain ?? DEFAULT_MAX_PER_DOMAIN;

  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const candidate of candidates) {
    const key = canonicalizeUrl(candidate.url) ?? candidate.url;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  const ranked = deduped
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const priorityDiff =
        SOURCE_TYPE_PRIORITY[a.candidate.sourceType] -
        SOURCE_TYPE_PRIORITY[b.candidate.sourceType];
      return priorityDiff !== 0 ? priorityDiff : a.index - b.index;
    })
    .map((entry) => entry.candidate);

  const selected: T[] = [];
  const perDomainCount = new Map<string, number>();
  for (const candidate of ranked) {
    if (selected.length >= maxSources) break;
    const domain = extractRegistrableDomain(candidate.url) ?? candidate.url;
    const count = perDomainCount.get(domain) ?? 0;
    if (count >= maxPerDomain) continue;
    perDomainCount.set(domain, count + 1);
    selected.push(candidate);
  }

  return selected;
}
