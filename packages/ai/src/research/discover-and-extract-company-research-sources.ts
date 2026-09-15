import { randomUUID, createHash } from 'node:crypto';
import {
  buildCompanyResearchQueries,
  canonicalizeUrl,
  classifyCompanyResearchSourceType,
  determinePrimaryCompanyDomain,
  extractRegistrableDomain,
  JOB_BOARD_DOMAINS,
  selectCompanyResearchSources,
  type CompanyResearchSourceType,
} from '@career-os/shared';
import {
  COMPANY_RESEARCH_MAX_PER_DOMAIN,
  COMPANY_RESEARCH_MAX_SOURCES,
  COMPANY_RESEARCH_SOURCE_TEXT_CHAR_CAP,
} from '../config';
import {
  isTavilyConfigured,
  tavilyExtract,
  tavilySearch,
  type TavilySearchResultItem,
} from './tavily-client';

export interface DiscoveredCompanyResearchSource {
  id: string;
  url: string;
  canonicalUrl: string | null;
  title: string;
  publisher: string | null;
  sourceType: CompanyResearchSourceType;
  publishedAt: string | null;
  text: string;
  contentHash: string;
}

export type DiscoverAndExtractOutcome =
  | { status: 'ok'; sources: DiscoveredCompanyResearchSource[] }
  | { status: 'research_provider_unavailable' }
  | { status: 'no_useful_sources' }
  | { status: 'insufficient_source_evidence' }
  | { status: 'provider_error'; message: string };

interface CandidateSource extends TavilySearchResultItem {
  sourceType: CompanyResearchSourceType;
}

/**
 * Discovery + extraction, end to end (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §16/§18) — the whole
 * "WEB RETRIEVAL" half of the pipeline, deliberately independent of AI synthesis (the caller,
 * `generate-company-research.ts`, only invokes the model afterward, against this function's
 * already-vetted, already-bounded output). Bounded call budget, exactly as documented in
 * `config.ts`: at most `MAX_COMPANY_RESEARCH_QUERIES` search calls, one batched extract call for
 * at most `COMPANY_RESEARCH_MAX_SOURCES` selected URLs — never one extract call per URL, never an
 * unbounded/recursive crawl.
 */
export async function discoverAndExtractCompanyResearchSources(params: {
  companyName: string;
  roleTitle: string;
  topRequirementTopics: string[];
}): Promise<DiscoverAndExtractOutcome> {
  if (!isTavilyConfigured()) {
    return { status: 'research_provider_unavailable' };
  }

  const queries = buildCompanyResearchQueries({
    companyName: params.companyName,
    topRequirementTopics: params.topRequirementTopics,
  });

  const searchOutcomes = await Promise.all(queries.map((query) => tavilySearch(query)));

  const okOutcomes = searchOutcomes.filter((o) => o.status === 'ok');
  if (okOutcomes.length === 0) {
    const firstError = searchOutcomes.find((o) => o.status === 'provider_error');
    return {
      status: 'provider_error',
      message:
        firstError && firstError.status === 'provider_error'
          ? firstError.message
          : 'search unavailable',
    };
  }

  const allResults = okOutcomes.flatMap((o) => (o.status === 'ok' ? o.results : []));

  // Never treat a job posting's own ATS/job-board page as a research source about the company —
  // it's the posting itself (already captured as the job snapshot), not information *about* the
  // company (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §21).
  const nonJobBoardResults = allResults.filter((r) => {
    const domain = extractRegistrableDomain(r.url);
    return domain !== null && !JOB_BOARD_DOMAINS.has(domain);
  });

  const primaryDomain = determinePrimaryCompanyDomain(
    nonJobBoardResults.map((r) => r.url),
  );
  const candidates: CandidateSource[] = nonJobBoardResults.map((r) => ({
    ...r,
    sourceType: classifyCompanyResearchSourceType(r.url, primaryDomain),
  }));

  const selected = selectCompanyResearchSources(candidates, {
    maxSources: COMPANY_RESEARCH_MAX_SOURCES,
    maxPerDomain: COMPANY_RESEARCH_MAX_PER_DOMAIN,
  });

  if (selected.length === 0) {
    return { status: 'no_useful_sources' };
  }

  const extractOutcome = await tavilyExtract(selected.map((s) => s.url));
  const extractedTextByUrl = new Map<string, string>();
  if (extractOutcome.status === 'ok') {
    for (const result of extractOutcome.results) {
      extractedTextByUrl.set(result.url, result.rawContent);
    }
  }
  // A provider_error from the batched extract call degrades to "use each source's own search
  // snippet instead" rather than failing the whole pipeline (§39: source_extraction_failed is a
  // per-source degradation) — every selected source still has *some* text from the search step.

  const sources: DiscoveredCompanyResearchSource[] = [];
  for (const candidate of selected) {
    const rawText = extractedTextByUrl.get(candidate.url) ?? candidate.content;
    const text = truncate(rawText, COMPANY_RESEARCH_SOURCE_TEXT_CHAR_CAP).trim();
    if (text.length === 0) continue; // nothing usable from either extraction or the snippet.

    const domain = extractRegistrableDomain(candidate.url);
    sources.push({
      id: randomUUID(),
      url: candidate.url,
      canonicalUrl: canonicalizeUrl(candidate.url),
      title: candidate.title,
      publisher: domain,
      sourceType: candidate.sourceType,
      publishedAt: candidate.publishedDate,
      text,
      contentHash: createHash('sha256').update(`${candidate.url}\n${text}`).digest('hex'),
    });
  }

  if (sources.length === 0) {
    return { status: 'insufficient_source_evidence' };
  }

  return { status: 'ok', sources };
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? text.slice(0, cap) : text;
}
