/**
 * Fixed outcome codes for the `?notice=` / `?error=` query params. Free text is never accepted
 * from the URL (it would let anyone craft a link that shows arbitrary copy inside the app);
 * an unknown code renders a generic message.
 */
export const NOTICE_MESSAGES = {
  project_created: 'Project created.',
  project_saved: 'Project details saved.',
  project_deleted: 'Project deleted.',
  approval_saved: 'Approval saved.',
  visibility_saved: 'Visibility saved.',
  talking_points_saved: 'Talking points saved.',
  skill_added: 'Skill added to this project.',
  skill_removed: 'Skill removed from this project.',
  achievement_added: 'Achievement added.',
  achievement_deleted: 'Achievement deleted.',
  achievement_evidence_added: 'Supporting evidence linked to the achievement.',
  achievement_verified: 'Achievement marked verified.',
  evidence_added: 'Evidence added.',
  evidence_unlinked: 'Evidence unlinked (the evidence record itself is kept).',
  evidence_deleted: 'Evidence deleted.',
  candidate_accepted: 'Suggestion accepted and added to your profile.',
  candidate_rejected: 'Suggestion rejected.',
  deleted: 'Deleted.',
} as const;

export const ERROR_MESSAGES = {
  not_found: 'That item was not found.',
  invalid: 'Please check the form values and try again.',
  edge_mismatch: 'That link does not belong to this project.',
  candidate_mismatch: 'That suggestion does not belong to this project.',
  candidate_decided: 'That suggestion was already decided.',
  candidate_conflict:
    'Accepting would overwrite existing content. Reject the suggestion or clear the summary first.',
  achievement_mismatch: 'That achievement does not belong to this project.',
  evidence_mismatch: 'That evidence is not linked to this project.',
  not_supported:
    'Link at least one piece of supporting evidence before marking an achievement verified.',
  create_failed: 'Could not create the project. Please try again.',
  delete_failed: 'Could not delete. Please try again.',
  failed: 'Something went wrong. Please try again.',
} as const;

export type NoticeCode = keyof typeof NOTICE_MESSAGES;
export type ErrorCode = keyof typeof ERROR_MESSAGES;

const has = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

export function noticeMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return has(NOTICE_MESSAGES, code) ? NOTICE_MESSAGES[code as NoticeCode] : 'Done.';
}

export function errorMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return has(ERROR_MESSAGES, code)
    ? ERROR_MESSAGES[code as ErrorCode]
    : ERROR_MESSAGES.failed;
}
