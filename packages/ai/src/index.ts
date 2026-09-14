/**
 * Server-only Claude integration — deterministic retrieval, prompting, and the
 * unsupportedClaims rejection gate described in docs/AI_GROUNDING.md.
 *
 * CLAUDE.md: this package must never be imported from apps/extension or from any
 * "use client" module in apps/web — the Claude API key lives only in code paths this
 * package is reached from.
 */
export { generateSuggestion } from './generate-suggestion';
export type {
  GenerateSuggestionParams,
  GenerateSuggestionResult,
} from './generate-suggestion';
export { generateRequirementMapping } from './generate-requirement-mapping';
export type {
  GenerateRequirementMappingParams,
  GenerateRequirementMappingResult,
} from './generate-requirement-mapping';
export { classifyEmail } from './generate-email-classification';
export type {
  ClassifyEmailParams,
  ClassifyEmailResult,
} from './generate-email-classification';
export { generateUnsupportedClaimsCheck } from './generate-unsupported-claims-check';
export type {
  GenerateUnsupportedClaimsCheckParams,
  GenerateUnsupportedClaimsCheckResult,
} from './generate-unsupported-claims-check';
export { generateFollowUpDraft } from './generate-follow-up-draft';
export type {
  GenerateFollowUpDraftParams,
  GenerateFollowUpDraftResult,
} from './generate-follow-up-draft';
export { generateInterviewPrep } from './generate-interview-prep';
export type {
  GenerateInterviewPrepParams,
  GenerateInterviewPrepResult,
} from './generate-interview-prep';
export { generateResumeTailoringPlan } from './generate-resume-tailoring-plan';
export type {
  GenerateResumeTailoringPlanParams,
  GenerateResumeTailoringPlanResult,
} from './generate-resume-tailoring-plan';
export { deriveEligibleNextAction } from './derive-eligible-next-action';
export { NEVER_SUGGEST_CLASSIFICATIONS } from './config';
