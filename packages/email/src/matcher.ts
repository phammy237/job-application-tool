import type { Application, EmailSignal } from '@career-os/shared';

export interface MatchableMessage {
  sender: string | null;
  senderDomain: string | null;
  subject: string | null;
}

export interface MatchApplicationResult {
  applicationId: string | null;
  score: number;
  ambiguous: boolean;
}

const DOMAIN_WEIGHT = 0.5;
const COMPANY_TOKEN_WEIGHT = 0.3;
const TITLE_TOKEN_WEIGHT = 0.2;

/** Ambiguous when the top two candidates are this close and the top score doesn't clear the
 * auto-apply threshold on its own — see docs/IMPLEMENTATION_PLAN.md's matching-algorithm design
 * decision. */
const AMBIGUITY_MARGIN = 0.05;
const AUTO_APPLY_THRESHOLD = 0.85;

const STOPWORDS = new Set(['inc', 'llc', 'corp', 'co', 'company', 'the', 'and', 'of', 'ltd']);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0 && !STOPWORDS.has(token)),
  );
}

function overlapRatio(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0) return 0;
  let matched = 0;
  for (const token of needle) {
    if (haystack.has(token)) matched += 1;
  }
  return matched / needle.size;
}

/**
 * A domain guess derived from the company name — ATS sending domains rarely equal the company
 * name exactly (e.g. Greenhouse/Workday/Lever subdomains), so this is a coarse heuristic; the
 * prior-confirmed-signal domain (below) is the practical mechanism that actually earns most
 * matches over time.
 */
function companyDomainGuess(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Weighted score against every non-`WITHDRAWN` application: sender-domain match (0.5, checking
 * both a company-name-derived guess and any domain already seen on a prior CONFIRMED/AUTO_APPLIED
 * signal for that application — the practical mechanism, since ATS domains rarely equal company
 * names), company-name token overlap in sender/subject (0.3), job-title token overlap in subject
 * (0.2). Zero matches or an empty candidate set return applicationId: null. Ambiguous (top two
 * within AMBIGUITY_MARGIN and the top score doesn't independently clear AUTO_APPLY_THRESHOLD) is
 * flagged so the caller never auto-applies a genuinely uncertain pick.
 */
export function matchApplication(
  message: MatchableMessage,
  applications: Application[],
  priorSignals: EmailSignal[],
): MatchApplicationResult {
  const candidates = applications.filter((app) => app.status !== 'WITHDRAWN');
  if (candidates.length === 0) {
    return { applicationId: null, score: 0, ambiguous: false };
  }

  const learnedDomainsByApplication = new Map<string, Set<string>>();
  for (const signal of priorSignals) {
    if (!signal.matchedApplicationId || !signal.senderDomain) continue;
    if (signal.confirmationStatus !== 'CONFIRMED' && signal.confirmationStatus !== 'AUTO_APPLIED') {
      continue;
    }
    const set = learnedDomainsByApplication.get(signal.matchedApplicationId) ?? new Set<string>();
    set.add(signal.senderDomain.toLowerCase());
    learnedDomainsByApplication.set(signal.matchedApplicationId, set);
  }

  const senderText = `${message.sender ?? ''} ${message.subject ?? ''}`;
  const senderTokens = tokenize(senderText);
  const subjectTokens = tokenize(message.subject ?? '');
  const messageDomain = message.senderDomain?.toLowerCase() ?? null;

  const scored = candidates.map((app) => {
    const companyTokens = tokenize(app.company);
    const titleTokens = tokenize(app.title);

    const domainGuess = companyDomainGuess(app.company);
    const learnedDomains = learnedDomainsByApplication.get(app.id);
    const domainMatches =
      messageDomain !== null &&
      ((domainGuess.length > 0 && messageDomain.includes(domainGuess)) ||
        (learnedDomains?.has(messageDomain) ?? false));

    const companyScore = overlapRatio(companyTokens, senderTokens) * COMPANY_TOKEN_WEIGHT;
    const titleScore = overlapRatio(titleTokens, subjectTokens) * TITLE_TOKEN_WEIGHT;
    const domainScore = domainMatches ? DOMAIN_WEIGHT : 0;

    return { applicationId: app.id, score: Math.min(1, domainScore + companyScore + titleScore) };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  const second = scored[1];

  if (top.score === 0) {
    return { applicationId: null, score: 0, ambiguous: false };
  }

  const ambiguous =
    second !== undefined &&
    top.score - second.score <= AMBIGUITY_MARGIN &&
    top.score < AUTO_APPLY_THRESHOLD;

  return { applicationId: top.applicationId, score: top.score, ambiguous };
}
