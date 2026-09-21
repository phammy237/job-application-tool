import { describe, expect, it } from 'vitest';
import { normalizeWorkdayApplyUrl, readWorkdayPostingAvailability } from './workday-posting-signals';

describe('readWorkdayPostingAvailability', () => {
  it('reads false/true from the window.workday bootstrap object', () => {
    expect(readWorkdayPostingAvailability('window.workday = { postingAvailable: false };')).toBe(false);
    expect(readWorkdayPostingAvailability('window.workday = { postingAvailable:true };')).toBe(true);
  });

  it('is null without the Workday bootstrap, even if the literal appears elsewhere', () => {
    expect(readWorkdayPostingAvailability('<p>postingAvailable: false</p>')).toBeNull();
    expect(readWorkdayPostingAvailability('window.workday = {};')).toBeNull();
  });
});

describe('normalizeWorkdayApplyUrl', () => {
  const DETAIL = 'https://tencent.wd1.myworkdayjobs.com/Tencent_Careers/job/Tencent-Cloud-CPaaS-Intern_R108020';

  it('drops a trailing /apply segment on a Workday host', () => {
    expect(normalizeWorkdayApplyUrl(`${DETAIL}/apply`)).toBe(DETAIL);
    expect(normalizeWorkdayApplyUrl(`${DETAIL}/apply/`)).toBe(DETAIL);
    expect(normalizeWorkdayApplyUrl(`${DETAIL}/apply/autofillWithResume`)).toBe(DETAIL);
  });

  it('keeps a locale prefix and drops query/hash', () => {
    expect(
      normalizeWorkdayApplyUrl('https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/Austin/APM-Intern_REF1/apply?source=x#y'),
    ).toBe('https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/Austin/APM-Intern_REF1');
  });

  it('leaves detail URLs and non-Workday URLs untouched', () => {
    expect(normalizeWorkdayApplyUrl(DETAIL)).toBe(DETAIL);
    expect(normalizeWorkdayApplyUrl('https://careers.example.com/job/123/apply')).toBe('https://careers.example.com/job/123/apply');
    expect(normalizeWorkdayApplyUrl('https://evil-myworkdayjobs.com/x/job/y/apply')).toBe('https://evil-myworkdayjobs.com/x/job/y/apply');
    expect(normalizeWorkdayApplyUrl('not a url')).toBe('not a url');
  });
});
