import type { EligibilityCheck } from '@career-os/shared';
import { EligibilityBadge } from '../eligibility-badge';

const CHECK_TYPE_LABELS: Record<string, string> = {
  SPONSORSHIP: 'Sponsorship',
  WORK_AUTHORIZATION: 'Work authorization',
  CITIZENSHIP: 'Citizenship',
  SECURITY_CLEARANCE: 'Security clearance',
  GRADUATION_WINDOW: 'Graduation window',
};

/**
 * Renders the persisted `eligibility_checks` array exactly as produced by `evaluateEligibility`
 * (packages/shared/src/lib/evaluate-eligibility.ts) — every check's `explanation` is already
 * deterministic, template-based text naming both the posting's requirement and the user's own
 * profile fact, so this component renders it verbatim rather than re-deriving or paraphrasing it.
 * A check that doesn't apply to this user/posting was never included here at all (D4's "omission
 * is not a fourth status" rule) — there is deliberately no "N/A" row to render.
 */
export function EligibilityChecks({ checks }: { checks: EligibilityCheck[] }) {
  if (checks.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        None of the eligibility checks Career OS runs (sponsorship, work authorization,
        citizenship, security clearance, graduation window) applied to this posting and your
        profile — either the posting made no explicit statement, or your profile hasn&apos;t
        answered the relevant question yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {checks.map((check) => (
        <div
          key={check.type}
          className={
            check.status === 'CONFLICT'
              ? 'border-destructive/40 bg-destructive/5 rounded-md border p-3'
              : 'border-border rounded-md border p-3'
          }
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {CHECK_TYPE_LABELS[check.type] ?? check.type}
            </span>
            <EligibilityBadge status={check.status} />
          </div>
          <p className="text-muted-foreground mt-1.5 text-sm">{check.explanation}</p>
          {check.evidenceText ? (
            <p className="text-muted-foreground mt-1.5 border-l-2 pl-2 text-xs italic">
              &ldquo;{check.evidenceText}&rdquo;
            </p>
          ) : null}
        </div>
      ))}
      <p className="text-muted-foreground text-xs">
        Career OS cannot determine the employer&apos;s actual hiring decision — this reflects only
        what the posting and your profile state explicitly.
      </p>
    </div>
  );
}
