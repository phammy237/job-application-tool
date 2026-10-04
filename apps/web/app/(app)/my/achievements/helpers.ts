import { myosAchievementInputSchema, type MyosAchievementInput } from '@career-os/shared';

function text(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

export type ParsedAchievement =
  | { ok: true; input: MyosAchievementInput }
  | { ok: false; message: string };

/**
 * FormData -> validated achievement input. A user-typed achievement is always USER_PROVIDED
 * (never VERIFIED: that needs a supporting evidence edge) and PRIVATE unless chosen otherwise.
 */
export function parseAchievementForm(fd: FormData): ParsedAchievement {
  const parsed = myosAchievementInputSchema.safeParse({
    title: text(fd, 'title') ?? '',
    description: text(fd, 'description'),
    kind: text(fd, 'kind') ?? 'ACHIEVEMENT',
    occurredOn: text(fd, 'occurredOn'),
    metricText: text(fd, 'metricText'),
    projectId: text(fd, 'projectId'),
    experienceId: text(fd, 'experienceId'),
    verificationState: 'USER_PROVIDED',
    userApproved: fd.get('userApproved') === 'on',
    visibility: text(fd, 'visibility') ?? 'PRIVATE',
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid achievement.' };
  }
  return { ok: true, input: parsed.data };
}
