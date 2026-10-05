import type { EvidenceSourceType, VerificationState } from '@career-os/shared';
import { PILL_BASE, TONE_PILL, type Tone } from '../../app/(app)/my/_components/tones';

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

const STATE_TONE: Record<VerificationState, Tone> = {
  VERIFIED: 'success',
  USER_PROVIDED: 'primary',
  INFERRED: 'warning',
  AI_GENERATED: 'muted',
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
      className={`${PILL_BASE} font-normal ${TONE_PILL[STATE_TONE[verificationState]]}`}
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
