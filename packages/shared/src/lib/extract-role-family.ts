import type { RoleFamily } from '../schemas/job-role-taxonomy';
import { firstMatchingPhrase } from './phrase-matcher';

/**
 * Deterministic, title-only role-family classification (docs/JOB_DISCOVERY.md "Role family
 * extraction"). No AI. Title takes precedence over — in V1, is the *only* input to — description
 * text: job description keywords are noisy (boilerplate, "nice to have" lists, unrelated team
 * descriptions) and a wrong role-family guess is worse than UNKNOWN, so description-based
 * fallback is deliberately deferred rather than risking false positives.
 *
 * Rules are evaluated in the order below, first match wins — ordering matters because some
 * families are lexical subsets of others (e.g. "technical program manager" must be checked
 * before any generic "manager"-shaped rule so it isn't miscategorized). Reusable, phrase-based
 * (word-boundary matched, see `phrase-matcher.ts`) — no company-specific branches. An
 * unrecognized title returns UNKNOWN rather than being forced into the nearest category (e.g.
 * Palantir's "Deployment Strategist" — a real, live-observed title with no generic keyword match
 * — is honestly UNKNOWN, not guessed).
 */
const RULES: ReadonlyArray<{ family: RoleFamily; phrases: readonly string[] }> = [
  {
    family: 'TECHNICAL_PROGRAM_MANAGEMENT',
    phrases: ['technical program manager', 'technical program management', 'tpm'],
  },
  {
    family: 'PRODUCT_MANAGEMENT',
    phrases: ['product manager', 'product management', 'product owner'],
  },
  {
    family: 'PRODUCT_ANALYTICS',
    phrases: ['product analyst', 'product analytics'],
  },
  {
    family: 'DATA_SCIENCE',
    phrases: [
      'data scientist',
      'data science',
      'machine learning scientist',
      'applied scientist',
      'research scientist',
    ],
  },
  {
    family: 'DATA_ANALYTICS',
    phrases: ['data analyst', 'data analytics', 'analytics engineer'],
  },
  {
    family: 'BUSINESS_ANALYTICS',
    phrases: ['business analyst', 'business analytics', 'business intelligence analyst', 'bi analyst'],
  },
  {
    family: 'SOFTWARE_ENGINEERING',
    phrases: [
      'software engineer',
      'software engineering',
      'backend engineer',
      'front end engineer',
      'frontend engineer',
      'full stack engineer',
      'fullstack engineer',
      'site reliability engineer',
      'infrastructure engineer',
      'platform engineer',
      'security engineer',
      'ml engineer',
      'machine learning engineer',
      'devops engineer',
      'qa engineer',
      'mobile engineer',
      'ios engineer',
      'android engineer',
      'forward deployed software engineer',
      'forward deployed engineer',
    ],
  },
  {
    family: 'STRATEGY_OPERATIONS',
    phrases: [
      'strategy and operations',
      'strategy & operations',
      'strategy operations',
      'business operations',
      'biz ops',
      'revenue operations',
      'revops',
      'sales operations',
    ],
  },
  {
    family: 'CONSULTING',
    phrases: ['consultant', 'consulting'],
  },
];

export function extractRoleFamily(title: string): RoleFamily {
  for (const rule of RULES) {
    if (firstMatchingPhrase(title, rule.phrases)) return rule.family;
  }
  return 'UNKNOWN';
}
