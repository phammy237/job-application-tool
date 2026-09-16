import { aggregateEligibility } from './eligibility-aggregation';
import type { DiscoveryEligibilityProfile } from '../schemas/discovery-eligibility-profile';
import type { EligibilityCheck, EligibilityResult } from '../schemas/eligibility-check';
import type { JobCatalogFeatures } from '../schemas/job-catalog-features';

export type EligibilityEvaluationFeatures = Pick<
  JobCatalogFeatures,
  | 'sponsorshipSignal'
  | 'citizenshipRequirement'
  | 'clearanceRequirement'
  | 'workAuthorizationRequirement'
  | 'graduationYearMin'
  | 'graduationYearMax'
  | 'evidence'
>;

export type EligibilityEvaluationProfile = Pick<
  DiscoveryEligibilityProfile,
  | 'currentlyAuthorizedToWork'
  | 'requiresSponsorshipNow'
  | 'requiresSponsorshipFuture'
  | 'isUsCitizen'
  | 'hasActiveSecurityClearance'
  | 'eligibleToObtainSecurityClearance'
  | 'graduationYear'
>;

/**
 * The five deterministic eligibility check evaluators (docs/JOB_DISCOVERY.md "Eligibility check
 * types" / "Sponsorship / work-authorization logic" / "Graduation / citizenship / clearance
 * logic"). Each returns `null` when the check isn't *applicable* — the user never answered the
 * relevant question, or the posting never made the relevant statement — rather than a status;
 * "not applicable" is represented by omission from the checks array, not a status value (there
 * are only three: ELIGIBLE, UNKNOWN, CONFLICT — docs/JOB_DISCOVERY.md "Eligibility is separate").
 * All explanation text is template-based, never generated — CLAUDE.md's "never invent a fact"
 * bars a generative explanation here just as much as anywhere else, and D4 makes zero AI calls.
 */

function evaluateSponsorship(
  features: EligibilityEvaluationFeatures,
  profile: EligibilityEvaluationProfile,
): EligibilityCheck | null {
  const userNeedsSponsorship =
    profile.requiresSponsorshipNow === true || profile.requiresSponsorshipFuture === true;
  if (!userNeedsSponsorship) return null;

  if (features.sponsorshipSignal === 'NOT_AVAILABLE') {
    return {
      type: 'SPONSORSHIP',
      status: 'CONFLICT',
      reasonCode: 'SPONSORSHIP_NOT_AVAILABLE_BUT_REQUIRED',
      explanation:
        'The posting states it does not provide sponsorship, but your profile indicates you require sponsorship now or in the future.',
      evidenceText: features.evidence.sponsorship ?? null,
      sourceField: 'description',
    };
  }
  if (features.sponsorshipSignal === 'AVAILABLE') {
    return {
      type: 'SPONSORSHIP',
      status: 'ELIGIBLE',
      reasonCode: 'SPONSORSHIP_AVAILABLE',
      explanation: "The posting states sponsorship is available, matching your profile's stated need.",
      evidenceText: features.evidence.sponsorship ?? null,
      sourceField: 'description',
    };
  }
  return {
    type: 'SPONSORSHIP',
    status: 'UNKNOWN',
    reasonCode: 'SPONSORSHIP_NOT_STATED',
    explanation:
      'No explicit sponsorship policy was detected in the posting, so this cannot be determined.',
    evidenceText: null,
    sourceField: 'description',
  };
}

function evaluateWorkAuthorization(
  features: EligibilityEvaluationFeatures,
  profile: EligibilityEvaluationProfile,
): EligibilityCheck | null {
  if (features.workAuthorizationRequirement !== 'AUTHORIZATION_REQUIRED') return null;
  if (profile.currentlyAuthorizedToWork === null) return null;

  if (profile.currentlyAuthorizedToWork) {
    return {
      type: 'WORK_AUTHORIZATION',
      status: 'ELIGIBLE',
      reasonCode: 'WORK_AUTHORIZATION_CONFIRMED',
      explanation:
        'The posting requires current work authorization, and your profile confirms you have it.',
      evidenceText: features.evidence.workAuthorization ?? null,
      sourceField: 'description',
    };
  }
  return {
    type: 'WORK_AUTHORIZATION',
    status: 'CONFLICT',
    reasonCode: 'WORK_AUTHORIZATION_REQUIRED_BUT_USER_NOT_AUTHORIZED',
    explanation:
      'The posting requires current work authorization, but your profile indicates you are not currently authorized to work.',
    evidenceText: features.evidence.workAuthorization ?? null,
    sourceField: 'description',
  };
}

function evaluateCitizenship(
  features: EligibilityEvaluationFeatures,
  profile: EligibilityEvaluationProfile,
): EligibilityCheck | null {
  if (features.citizenshipRequirement !== 'US_CITIZEN_ONLY') return null;
  if (profile.isUsCitizen === null) return null;

  if (profile.isUsCitizen) {
    return {
      type: 'CITIZENSHIP',
      status: 'ELIGIBLE',
      reasonCode: 'CITIZENSHIP_US_CITIZEN_CONFIRMED',
      explanation: 'The posting requires US citizenship, and your profile confirms you are a US citizen.',
      evidenceText: features.evidence.citizenship ?? null,
      sourceField: 'description',
    };
  }
  return {
    type: 'CITIZENSHIP',
    status: 'CONFLICT',
    reasonCode: 'CITIZENSHIP_US_ONLY_BUT_USER_NOT_CITIZEN',
    explanation:
      'The posting requires US citizenship, but your profile indicates you are not a US citizen.',
    evidenceText: features.evidence.citizenship ?? null,
    sourceField: 'description',
  };
}

function evaluateClearance(
  features: EligibilityEvaluationFeatures,
  profile: EligibilityEvaluationProfile,
): EligibilityCheck | null {
  const evidenceText = features.evidence.clearance ?? null;

  if (features.clearanceRequirement === 'ACTIVE_CLEARANCE_REQUIRED') {
    if (profile.hasActiveSecurityClearance === null) return null;
    if (profile.hasActiveSecurityClearance) {
      return {
        type: 'SECURITY_CLEARANCE',
        status: 'ELIGIBLE',
        reasonCode: 'CLEARANCE_ACTIVE_CONFIRMED',
        explanation: 'The posting requires an active clearance, and your profile confirms you hold one.',
        evidenceText,
        sourceField: 'description',
      };
    }
    return {
      type: 'SECURITY_CLEARANCE',
      status: 'CONFLICT',
      reasonCode: 'CLEARANCE_ACTIVE_REQUIRED_BUT_USER_LACKS_ACTIVE',
      explanation:
        'The posting requires an active clearance, but your profile indicates you do not currently hold one. Eligibility to obtain one is not treated as equivalent to already holding it.',
      evidenceText,
      sourceField: 'description',
    };
  }

  if (features.clearanceRequirement === 'CLEARANCE_ELIGIBILITY_REQUIRED') {
    const hasAnswer =
      profile.hasActiveSecurityClearance !== null || profile.eligibleToObtainSecurityClearance !== null;
    if (!hasAnswer) return null;

    if (profile.hasActiveSecurityClearance === true || profile.eligibleToObtainSecurityClearance === true) {
      return {
        type: 'SECURITY_CLEARANCE',
        status: 'ELIGIBLE',
        reasonCode: 'CLEARANCE_ELIGIBILITY_CONFIRMED',
        explanation:
          'The posting accepts candidates eligible to obtain a clearance, and your profile confirms that.',
        evidenceText,
        sourceField: 'description',
      };
    }
    // Reached only when neither answer was `true` above, so this is really just checking
    // `eligibleToObtainSecurityClearance === false` — spelled out for readability.
    if (profile.eligibleToObtainSecurityClearance === false) {
      return {
        type: 'SECURITY_CLEARANCE',
        status: 'CONFLICT',
        reasonCode: 'CLEARANCE_ELIGIBILITY_REQUIRED_BUT_USER_NOT_ELIGIBLE',
        explanation:
          'The posting requires clearance eligibility, but your profile indicates you are not eligible to obtain one.',
        evidenceText,
        sourceField: 'description',
      };
    }
    return {
      type: 'SECURITY_CLEARANCE',
      status: 'UNKNOWN',
      reasonCode: 'CLEARANCE_ELIGIBILITY_INDETERMINATE',
      explanation:
        'The posting requires clearance eligibility, but your profile does not have enough information to determine this.',
      evidenceText,
      sourceField: 'description',
    };
  }

  return null;
}

function evaluateGraduationWindow(
  features: EligibilityEvaluationFeatures,
  profile: EligibilityEvaluationProfile,
): EligibilityCheck | null {
  if (features.graduationYearMin === null || features.graduationYearMax === null) return null;
  if (profile.graduationYear === null) return null;

  const withinWindow =
    profile.graduationYear >= features.graduationYearMin &&
    profile.graduationYear <= features.graduationYearMax;

  if (withinWindow) {
    return {
      type: 'GRADUATION_WINDOW',
      status: 'ELIGIBLE',
      reasonCode: 'GRADUATION_WINDOW_MATCH',
      explanation: `The posting accepts graduates from ${features.graduationYearMin}-${features.graduationYearMax}, which includes your graduation year (${profile.graduationYear}).`,
      evidenceText: null,
      sourceField: 'description',
    };
  }
  return {
    type: 'GRADUATION_WINDOW',
    status: 'CONFLICT',
    reasonCode: 'GRADUATION_WINDOW_MISMATCH',
    explanation: `The posting accepts graduates from ${features.graduationYearMin}-${features.graduationYearMax}, which does not include your graduation year (${profile.graduationYear}).`,
    evidenceText: null,
    sourceField: 'description',
  };
}

export function evaluateEligibility(
  features: EligibilityEvaluationFeatures,
  profile: EligibilityEvaluationProfile,
): EligibilityResult {
  const checks = [
    evaluateSponsorship(features, profile),
    evaluateWorkAuthorization(features, profile),
    evaluateCitizenship(features, profile),
    evaluateClearance(features, profile),
    evaluateGraduationWindow(features, profile),
  ].filter((check): check is EligibilityCheck => check !== null);

  return aggregateEligibility(checks);
}
