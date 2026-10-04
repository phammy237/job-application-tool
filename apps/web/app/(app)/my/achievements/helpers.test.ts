import { describe, expect, it } from 'vitest';
import { parseAchievementForm } from './helpers';

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

describe('parseAchievementForm', () => {
  it('requires a title', () => {
    expect(parseAchievementForm(form({ title: '  ' })).ok).toBe(false);
  });

  it('defaults to PRIVATE, USER_PROVIDED, unapproved', () => {
    const res = parseAchievementForm(form({ title: 'Won hackathon' }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.input).toMatchObject({
        title: 'Won hackathon',
        kind: 'ACHIEVEMENT',
        visibility: 'PRIVATE',
        verificationState: 'USER_PROVIDED',
        userApproved: false,
      });
    }
  });

  it('rejects bad dates, kinds and ids', () => {
    expect(parseAchievementForm(form({ title: 'x', occurredOn: 'yesterday' })).ok).toBe(
      false,
    );
    expect(parseAchievementForm(form({ title: 'x', kind: 'HERO' })).ok).toBe(false);
    expect(parseAchievementForm(form({ title: 'x', projectId: 'nope' })).ok).toBe(false);
  });

  it('never lets the form set VERIFIED', () => {
    const res = parseAchievementForm(form({ title: 'x', verificationState: 'VERIFIED' }));
    expect(res.ok && res.input.verificationState).toBe('USER_PROVIDED');
  });
});
