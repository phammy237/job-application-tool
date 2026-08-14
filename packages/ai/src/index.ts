/**
 * Server-only Claude integration — deterministic retrieval, prompting, and the
 * unsupportedClaims rejection gate described in docs/AI_GROUNDING.md.
 *
 * CLAUDE.md: this package must never be imported from apps/extension or from any
 * "use client" module in apps/web — the Claude API key lives only in code paths this
 * package is reached from.
 */
export { generateSuggestion } from './generate-suggestion';
export type { GenerateSuggestionParams, GenerateSuggestionResult } from './generate-suggestion';
export { generateRequirementMapping } from './generate-requirement-mapping';
export type {
  GenerateRequirementMappingParams,
  GenerateRequirementMappingResult,
} from './generate-requirement-mapping';
export { NEVER_SUGGEST_CLASSIFICATIONS } from './config';
