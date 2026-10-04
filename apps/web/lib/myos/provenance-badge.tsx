import type { EvidenceSourceType, VerificationState } from '@career-os/shared';

const SOURCE_LABEL: Record<EvidenceSourceType, string> = {
  GITHUB_REPO: 'GitHub repo',
  GITHUB_README: 'GitHub README',
  GITHUB_PR: 'GitHub PR',
  GITHUB_COMMIT: 'GitHub commit',
  RESUME: 'Resume',
  USER_NOTE: 'Your note',
  LINK: 'Link',
  DOCUMENT: 'Document',
  AWARD: 'Award',
  OTHER: 'Other',
};

const STATE_LABEL: Record<VerificationState, string> = {
  VERIFIED: 'verified',
  USER_PROVIDED: 'you provided',
  INFERRED: 'inferred',
  AI_GENERATED: 'AI-generated',
};

const STATE_CLASS: Record<VerificationState, string> = {
  VERIFIED: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
  USER_PROVIDED: 'border-sky-500/40 text-sky-700 dark:text-sky-400',
  INFERRED: 'border-amber-500/50 text-amber-700 dark:text-amber-400',
  AI_GENERATED: 'border-amber-500/50 text-amber-700 dark:text-amber-400',
};

/** Source type + verification state of one evidence row. Inferred / AI states are visibly weaker. */
export function ProvenanceBadge({
  sourceType,
  verificationState,
}: {
  sourceType: EvidenceSourceType;
  verificationState: VerificationState;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${STATE_CLASS[verificationState]}`}
      title={`Source: ${SOURCE_LABEL[sourceType]}; state: ${STATE_LABEL[verificationState]}`}
    >
      {SOURCE_LABEL[sourceType]} · {STATE_LABEL[verificationState]}
    </span>
  );
}

export function entityHref(entityType: string, entityId: string): string {
  switch (entityType) {
    case 'PROJECT':
      return `/my/projects/${entityId}`;
    case 'STORY':
      return `/my/stories/${entityId}`;
    case 'EXPERIENCE':
      return '/profile';
    default:
      return '/my';
  }
}
