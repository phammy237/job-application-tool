import { describe, expect, it } from 'vitest';
import { classifyJobPostingHost } from './classify-job-posting-host';

describe('classifyJobPostingHost', () => {
  it('accepts Greenhouse as an ATS destination', () => {
    expect(classifyJobPostingHost('https://boards.greenhouse.io/acme/jobs/1234')).toBe('ACCEPTED_ATS');
  });
  it('accepts Lever as an ATS destination', () => {
    expect(classifyJobPostingHost('https://jobs.lever.co/acme/abcd-1234')).toBe('ACCEPTED_ATS');
  });
  it('accepts Ashby as an ATS destination', () => {
    expect(classifyJobPostingHost('https://jobs.ashbyhq.com/acme/abcd-1234')).toBe('ACCEPTED_ATS');
  });
  it('accepts Workday as an ATS destination even without a dedicated ingestion adapter', () => {
    expect(classifyJobPostingHost('https://acme.wd1.myworkdayjobs.com/en-US/careers/job/1234')).toBe(
      'ACCEPTED_ATS',
    );
  });
  it('accepts SmartRecruiters as an ATS destination', () => {
    expect(classifyJobPostingHost('https://jobs.smartrecruiters.com/Acme/1234')).toBe('ACCEPTED_ATS');
  });
  it('accepts Jobvite as an ATS destination', () => {
    expect(classifyJobPostingHost('https://jobs.jobvite.com/acme/job/1234')).toBe('ACCEPTED_ATS');
  });
  it('accepts iCIMS as an ATS destination', () => {
    expect(
      classifyJobPostingHost('https://careers-perrysicecream.icims.com/jobs/2806/intern/job'),
    ).toBe('ACCEPTED_ATS');
  });
  it('accepts Taleo as an ATS destination', () => {
    expect(
      classifyJobPostingHost('https://textron.taleo.net/careersection/textron_ur/jobdetail.ftl?job=342309'),
    ).toBe('ACCEPTED_ATS');
  });
  it('rejects the icims.com.evil.example lookalike domain', () => {
    expect(classifyJobPostingHost('https://icims.com.evil.example/jobs/1/x/job')).toBe('UNKNOWN');
  });
  it('rejects the taleo.net.evil.example lookalike domain', () => {
    expect(classifyJobPostingHost('https://taleo.net.evil.example/jobdetail.ftl?job=1')).toBe('UNKNOWN');
  });
  it('rejects a domain that merely ends with the ATS name as a substring, with no dot boundary', () => {
    expect(classifyJobPostingHost('https://careers.evil-icims.com/jobs/1/x/job')).toBe('UNKNOWN');
  });
  it('rejects Jobright as a canonical destination', () => {
    expect(classifyJobPostingHost('https://jobright.ai/jobs/info/abc123')).toBe('REJECTED_AGGREGATOR');
  });
  it('rejects LinkedIn as a canonical destination', () => {
    expect(classifyJobPostingHost('https://www.linkedin.com/jobs/view/1234')).toBe('REJECTED_AGGREGATOR');
  });
  it('rejects Indeed as a canonical destination', () => {
    expect(classifyJobPostingHost('https://www.indeed.com/viewjob?jk=1234')).toBe('REJECTED_AGGREGATOR');
  });
  it('rejects Glassdoor as a canonical destination', () => {
    expect(classifyJobPostingHost('https://www.glassdoor.com/job-listing/1234')).toBe('REJECTED_AGGREGATOR');
  });
  it('classifies an employer\'s own domain as EMPLOYER_DOMAIN only when a matching hint is given', () => {
    expect(classifyJobPostingHost('https://careers.acme.com/jobs/1234', 'acme.com')).toBe(
      'EMPLOYER_DOMAIN',
    );
  });
  it('never guesses an employer domain without a hint — falls back to UNKNOWN, not a wrong accept', () => {
    expect(classifyJobPostingHost('https://careers.acme.com/jobs/1234')).toBe('UNKNOWN');
  });
  it('returns UNKNOWN for a malformed URL rather than throwing', () => {
    expect(classifyJobPostingHost('not a url')).toBe('UNKNOWN');
  });
});
