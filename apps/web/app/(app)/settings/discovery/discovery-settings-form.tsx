'use client';

import {
  ALL_SCORING_CRITERIA,
  computeDiscoverySettingsChanges,
  employmentTypeForPreferencesSchema,
  roleFamilySchema,
  senioritySchemaForPreferences,
  workModeSchema,
  type CriteriaWeights,
  type DiscoveryEligibilityProfile,
  type DiscoveryScoringProfile,
  type DiscoverySettingsEligibilityRequest,
  type DiscoverySettingsScoringRequest,
  type ScoringCriterion,
} from '@career-os/shared';
import { Button } from '@career-os/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { DiscoverySettingsSaveResult } from '../../../api/discovery/settings/route';
import {
  ROLE_FAMILY_LABELS,
  SENIORITY_LABELS,
  WORKPLACE_LABELS,
  EMPLOYMENT_LABELS,
  CRITERION_LABELS,
} from '../../discover/discovery-display-labels';
import { CriterionRow } from './criterion-row';
import { EligibilityBooleanField, GraduationYearField } from './eligibility-fields';
import { LocationPreferenceEditor } from './location-preference-editor';
import { PreferenceWeightEditor } from './preference-weight-editor';

const CRITERION_DESCRIPTIONS: Record<ScoringCriterion, string> = {
  ROLE_FIT: "How well a job's role family matches the role families you rate below.",
  COMPETENCY_FIT:
    "How many of a job's requested skills match your approved skills, experience, and projects.",
  SENIORITY_FIT: "How well a job's seniority level matches the levels you rate below.",
  LOCATION_FIT: "How well a job's location matches the locations you rate below.",
  WORK_MODE_FIT:
    "How well a job's workplace type (remote, hybrid, on-site) matches your preferences below.",
  EMPLOYMENT_TYPE_FIT:
    "How well a job's employment type (full-time, internship, etc.) matches your preferences below.",
  OBSERVED_FRESHNESS:
    'How recently the job was first seen — measured automatically, not something you configure.',
};

const ROLE_FAMILY_OPTIONS = roleFamilySchema.options.filter((v) => v !== 'UNKNOWN');
const SENIORITY_OPTIONS = senioritySchemaForPreferences.options;
const WORK_MODE_OPTIONS = workModeSchema.options;
const EMPLOYMENT_TYPE_OPTIONS = employmentTypeForPreferencesSchema.options;

/** `preset` is carried through unedited — D5B's UI is the granular criteria/preference editors
 * below, not a preset picker (docs/JOB_DISCOVERY.md "Discovery Scoring Profile": a preset only
 * pre-populates these same editable fields, it never forks the algorithm, so there is nothing a
 * preset selector here would do that editing the fields directly doesn't already do). */
function scoringRequestFromProfile(profile: DiscoveryScoringProfile): DiscoverySettingsScoringRequest {
  return {
    preset: profile.preset,
    criteriaWeights: profile.criteriaWeights,
    rolePreferences: profile.rolePreferences,
    seniorityPreferences: profile.seniorityPreferences,
    locationPreferences: profile.locationPreferences,
    workModePreferences: profile.workModePreferences,
    employmentTypePreferences: profile.employmentTypePreferences,
  };
}

function eligibilityRequestFromProfile(
  profile: DiscoveryEligibilityProfile,
): DiscoverySettingsEligibilityRequest {
  return {
    currentlyAuthorizedToWork: profile.currentlyAuthorizedToWork,
    requiresSponsorshipNow: profile.requiresSponsorshipNow,
    requiresSponsorshipFuture: profile.requiresSponsorshipFuture,
    isUsCitizen: profile.isUsCitizen,
    hasActiveSecurityClearance: profile.hasActiveSecurityClearance,
    eligibleToObtainSecurityClearance: profile.eligibleToObtainSecurityClearance,
    graduationYear: profile.graduationYear,
  };
}

/** `result.error` is only ever set by the server for a real failure (a partial persistence
 * failure, or a persisted-but-recompute-failed outcome) — never alongside a genuine success, so
 * checking it first here means a failure can never be read back as "Your job matches have been
 * updated." just because `scoringChanged` also happened to be true. */
function saveResultMessage(result: DiscoverySettingsSaveResult): string {
  if (result.error) return result.error;
  if (!result.scoringChanged && !result.eligibilityChanged) return 'No changes to save.';
  if (result.scoringChanged && result.eligibilityChanged) {
    return 'Your discovery results have been updated.';
  }
  if (result.scoringChanged) return 'Your job matches have been updated.';
  return 'Your eligibility results have been updated.';
}

export function DiscoverySettingsForm({
  initialScoringProfile,
  initialEligibilityProfile,
  locationTokens,
}: {
  initialScoringProfile: DiscoveryScoringProfile;
  initialEligibilityProfile: DiscoveryEligibilityProfile;
  locationTokens: string[];
}) {
  const router = useRouter();
  const [baselineScoring, setBaselineScoring] = useState(initialScoringProfile);
  const [baselineEligibility, setBaselineEligibility] = useState(initialEligibilityProfile);
  const [scoring, setScoring] = useState<DiscoverySettingsScoringRequest>(() =>
    scoringRequestFromProfile(initialScoringProfile),
  );
  const [eligibility, setEligibility] = useState<DiscoverySettingsEligibilityRequest>(() =>
    eligibilityRequestFromProfile(initialEligibilityProfile),
  );
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DiscoverySettingsSaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { scoringChanged, eligibilityChanged } = computeDiscoverySettingsChanges(
    { scoring: baselineScoring, eligibility: baselineEligibility },
    { scoring, eligibility },
  );
  const isDirty = scoringChanged || eligibilityChanged;

  function updateCriterionWeight(criterion: ScoringCriterion, weight: number) {
    setScoring((prev) => ({
      ...prev,
      criteriaWeights: { ...prev.criteriaWeights, [criterion]: weight } as CriteriaWeights,
    }));
  }

  function save() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/discovery/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scoring, eligibility }),
        });
        const body = (await response.json().catch(() => null)) as
          | (DiscoverySettingsSaveResult & { error?: string })
          | null;

        // A structured response — even a failing one (a persistence failure, or a persisted-but-
        // recompute-failed outcome) — carries its own authoritative message via `result`/
        // `saveResultMessage`. The generic `error` banner is reserved for a response with no
        // usable shape at all (malformed JSON, an unexpected body).
        if (!body || typeof body.scoringChanged !== 'boolean') {
          setError('Could not save your preferences. Please try again.');
          return;
        }
        setResult(body);
        if (!response.ok) return;

        // Reset the dirty-state baseline to what was just saved so Save disables again until the
        // next real edit — the server is the authority on what actually got written.
        if (body.scoringChanged) {
          setBaselineScoring((prev) => ({ ...prev, ...scoring }));
        }
        if (body.eligibilityChanged) {
          setBaselineEligibility((prev) => ({ ...prev, ...eligibility }));
        }
        router.refresh();
      } catch {
        setError('Could not save your preferences. Please check your connection and try again.');
      }
    });
  }

  return (
    <div className="space-y-8">
      <section className="space-y-1">
        <h2 className="text-lg font-semibold">What matters to you</h2>
        <p className="text-muted-foreground text-sm">
          These preferences control how jobs are ranked. They do not affect eligibility.
        </p>
        <p className="text-muted-foreground text-xs">
          Turning a criterion off means Career OS ignores it completely when ranking jobs for
          you — different from a job simply not having enough information for that criterion,
          which /discover shows as &ldquo;Not evaluated&rdquo; rather than a low score.
        </p>
      </section>

      <section aria-label="Criteria weights" className="divide-border rounded-lg border">
        <div className="divide-border divide-y px-4">
          {ALL_SCORING_CRITERIA.map((criterion) => (
            <CriterionRow
              key={criterion}
              label={CRITERION_LABELS[criterion] ?? criterion}
              description={CRITERION_DESCRIPTIONS[criterion]}
              weight={scoring.criteriaWeights[criterion] ?? 0}
              onChange={(weight) => updateCriterionWeight(criterion, weight)}
              extra={
                criterion === 'COMPETENCY_FIT' ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Skill matches come only from your approved skills, experience, and projects —
                    never entered here.{' '}
                    <Link href="/profile" className="underline underline-offset-2">
                      Update your approved profile →
                    </Link>
                  </p>
                ) : undefined
              }
            />
          ))}
        </div>
      </section>

      <PreferenceWeightEditor
        legend="Role families you prefer"
        allOptions={ROLE_FAMILY_OPTIONS}
        labels={ROLE_FAMILY_LABELS}
        values={scoring.rolePreferences}
        onChange={(rolePreferences) => setScoring((prev) => ({ ...prev, rolePreferences }))}
      />

      <PreferenceWeightEditor
        legend="Seniority levels you prefer"
        allOptions={SENIORITY_OPTIONS}
        labels={SENIORITY_LABELS}
        values={scoring.seniorityPreferences}
        onChange={(seniorityPreferences) =>
          setScoring((prev) => ({ ...prev, seniorityPreferences }))
        }
      />

      <LocationPreferenceEditor
        locationTokens={locationTokens}
        values={scoring.locationPreferences}
        onChange={(locationPreferences) =>
          setScoring((prev) => ({ ...prev, locationPreferences }))
        }
      />

      <PreferenceWeightEditor
        legend="Work mode you prefer"
        allOptions={WORK_MODE_OPTIONS}
        labels={WORKPLACE_LABELS}
        values={scoring.workModePreferences}
        onChange={(workModePreferences) =>
          setScoring((prev) => ({ ...prev, workModePreferences }))
        }
      />

      <PreferenceWeightEditor
        legend="Employment types you prefer"
        allOptions={EMPLOYMENT_TYPE_OPTIONS}
        labels={EMPLOYMENT_LABELS}
        values={scoring.employmentTypePreferences}
        onChange={(employmentTypePreferences) =>
          setScoring((prev) => ({ ...prev, employmentTypePreferences }))
        }
      />

      <section className="space-y-1 border-t pt-6">
        <h2 className="text-lg font-semibold">Eligibility</h2>
        <p className="text-muted-foreground text-sm">
          Eligibility settings are used to identify stated conflicts in job postings. They do not
          affect your Match score.
        </p>
        <p className="text-muted-foreground text-xs">
          Career OS detects conflicts with requirements explicitly stated in a posting. It cannot
          determine whether an employer will make an exception or ultimately consider a candidate.
          Leaving a field as &ldquo;Unknown&rdquo; is fine — you are never required to answer.
        </p>
      </section>

      <section aria-label="Eligibility fields" className="divide-border divide-y rounded-lg border px-4">
        <EligibilityBooleanField
          label="Currently authorized to work"
          description="Are you currently authorized to work (e.g. citizen, green card holder, or valid work authorization like OPT/H-1B)?"
          value={eligibility.currentlyAuthorizedToWork}
          onChange={(v) => setEligibility((prev) => ({ ...prev, currentlyAuthorizedToWork: v }))}
        />
        <EligibilityBooleanField
          label="Requires sponsorship now"
          description="Do you need an employer to sponsor your work authorization right now?"
          value={eligibility.requiresSponsorshipNow}
          onChange={(v) => setEligibility((prev) => ({ ...prev, requiresSponsorshipNow: v }))}
        />
        <EligibilityBooleanField
          label="Will require sponsorship in the future"
          description="Will you need employer sponsorship at some point later (e.g. OPT transitioning to H-1B)?"
          value={eligibility.requiresSponsorshipFuture}
          onChange={(v) => setEligibility((prev) => ({ ...prev, requiresSponsorshipFuture: v }))}
        />
        <EligibilityBooleanField
          label="US citizen"
          description="Are you a US citizen?"
          value={eligibility.isUsCitizen}
          onChange={(v) => setEligibility((prev) => ({ ...prev, isUsCitizen: v }))}
        />
        <EligibilityBooleanField
          label="Active security clearance"
          description="Do you currently hold an active security clearance?"
          value={eligibility.hasActiveSecurityClearance}
          onChange={(v) => setEligibility((prev) => ({ ...prev, hasActiveSecurityClearance: v }))}
        />
        <EligibilityBooleanField
          label="Eligible to obtain a clearance"
          description="If you don't currently hold a clearance, are you eligible to obtain one?"
          value={eligibility.eligibleToObtainSecurityClearance}
          onChange={(v) =>
            setEligibility((prev) => ({ ...prev, eligibleToObtainSecurityClearance: v }))
          }
        />
        <GraduationYearField
          value={eligibility.graduationYear}
          onChange={(v) => setEligibility((prev) => ({ ...prev, graduationYear: v }))}
        />
      </section>

      <div className="border-border sticky bottom-0 -mx-6 border-t bg-inherit px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={save} disabled={!isDirty || pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
          {isDirty && !pending ? (
            <span className="text-muted-foreground text-xs">You have unsaved changes.</span>
          ) : null}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        {result ? (
          <div className="mt-2 space-y-1">
            <p className="text-sm font-medium">{saveResultMessage(result)}</p>
            {result.recompute.attempted && result.recompute.succeeded ? (
              <p className="text-muted-foreground text-sm">
                {result.recompute.jobsScored} job{result.recompute.jobsScored === 1 ? '' : 's'}{' '}
                re-ranked using your new preferences.{' '}
                <Link href="/discover" className="underline underline-offset-2">
                  View updated jobs
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
