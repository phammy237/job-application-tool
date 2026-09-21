import { describe, expect, it } from 'vitest';
import { validateOfficialPostingCandidate } from './official-posting-validator';

const INPUT = {
  companyName: 'Databricks',
  title: 'Product Management Intern (Summer 2027)',
  locationText: 'San Francisco, CA, United States',
};

function candidate(overrides: Partial<{ url: string; title: string; content: string }> = {}) {
  return {
    url: 'https://boards.greenhouse.io/databricks/jobs/1234',
    title: 'Product Management Intern (Summer 2027) - Databricks',
    content:
      'Databricks is hiring a Product Management Intern for Summer 2027 in San Francisco, CA. Apply now.',
    ...overrides,
  };
}

describe('validateOfficialPostingCandidate', () => {
  it('6. accepts the official employer career domain (with a confirmed employer hint upstream would score EMPLOYER_DOMAIN; unhinted still passes on ACCEPTED_ATS/host-neutral grounds when strong otherwise)', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://careers.databricks.com/jobs/1234' }),
    );
    // No employer-domain hint is threaded through in V1, so this lands as UNKNOWN host -> REVIEW,
    // never HIGH and never rejected outright — still a genuinely useful, non-aggregator candidate.
    expect(result.tier).toBe('REVIEW');
    expect(result.hostClass).toBe('UNKNOWN');
  });

  it('7. a Greenhouse result is accepted at HIGH confidence when company/title/location all line up', () => {
    const result = validateOfficialPostingCandidate(INPUT, candidate());
    expect(result.tier).toBe('HIGH');
    expect(result.hostClass).toBe('ACCEPTED_ATS');
  });

  it('8. a Lever result is accepted at HIGH confidence', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://jobs.lever.co/databricks/abcd-1234-efgh' }),
    );
    expect(result.tier).toBe('HIGH');
    expect(result.hostClass).toBe('ACCEPTED_ATS');
  });

  it('9. an Ashby result is accepted at HIGH confidence', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://jobs.ashbyhq.com/databricks/abcd-1234-efgh' }),
    );
    expect(result.tier).toBe('HIGH');
    expect(result.hostClass).toBe('ACCEPTED_ATS');
  });

  it('10. a Workday employer posting is accepted at HIGH confidence', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://databricks.wd1.myworkdayjobs.com/en-US/careers/job/1234-abcd' }),
    );
    expect(result.tier).toBe('HIGH');
    expect(result.hostClass).toBe('ACCEPTED_ATS');
  });

  it('D7.1 hardening: a real individual iCIMS job posting is accepted at HIGH confidence', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({
        url: 'https://careers-databricks.icims.com/jobs/1234/product-management-intern/job',
        title: 'Product Management Intern (Summer 2027) - Databricks - iCIMS',
      }),
    );
    expect(result.tier).toBe('HIGH');
    expect(result.hostClass).toBe('ACCEPTED_ATS');
  });

  it('D7.1 hardening: a real individual Taleo job posting is accepted at HIGH confidence', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({
        url: 'https://databricks.taleo.net/careersection/db_ur/jobdetail.ftl?job=342309',
        title: 'Product Management Intern (Summer 2027) - Databricks - Taleo',
      }),
    );
    expect(result.tier).toBe('HIGH');
    expect(result.hostClass).toBe('ACCEPTED_ATS');
  });

  it('D7.1 hardening: a generic iCIMS home/search/login page fails page-type validation, never HIGH — isolated from title/company matching by using an otherwise-matching title', () => {
    // Title/company/location all match INPUT exactly, isolating page-type as the only failing
    // signal — otherwise a mismatched title would fail for the wrong reason.
    const home = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://careers-databricks.icims.com/' }),
    );
    expect(home.tier).not.toBe('HIGH');

    const search = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://careers-databricks.icims.com/jobs/search' }),
    );
    expect(search.tier).not.toBe('HIGH');

    const login = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://careers-databricks.icims.com/jobs/login' }),
    );
    expect(login.tier).not.toBe('HIGH');
  });

  it('D7.1 hardening: a generic Taleo home/search/login page fails page-type validation, never HIGH — isolated from title/company matching by using an otherwise-matching title', () => {
    const home = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://databricks.taleo.net/careersection/db_ur/' }),
    );
    expect(home.tier).not.toBe('HIGH');

    const search = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://databricks.taleo.net/careersection/db_ur/moresearch.ftl' }),
    );
    expect(search.tier).not.toBe('HIGH');

    const list = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://databricks.taleo.net/careersection/db_ur/joblist.ftl' }),
    );
    expect(list.tier).not.toBe('HIGH');
  });

  it('D7.1 hardening: an iCIMS lookalike domain never reaches HIGH even with an otherwise-valid-looking posting path', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({
        url: 'https://icims.com.evil.example/jobs/1234/product-management-intern/job',
        title: 'Product Management Intern (Summer 2027) - Databricks',
      }),
    );
    expect(result.tier).not.toBe('HIGH');
    expect(result.hostClass).toBe('UNKNOWN');
  });

  it('D7.1 hardening: a Taleo lookalike domain never reaches HIGH even with an otherwise-valid-looking posting path', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({
        url: 'https://taleo.net.evil.example/careersection/db_ur/jobdetail.ftl?job=342309',
        title: 'Product Management Intern (Summer 2027) - Databricks',
      }),
    );
    expect(result.tier).not.toBe('HIGH');
    expect(result.hostClass).toBe('UNKNOWN');
  });

  it('11. LinkedIn is rejected as a canonical destination outright', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://www.linkedin.com/jobs/view/1234' }),
    );
    expect(result.tier).toBe('UNRESOLVED');
    expect(result.hostClass).toBe('REJECTED_AGGREGATOR');
    expect(result.confidence).toBe(0);
  });

  it('12. Indeed is rejected as a canonical destination outright', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://www.indeed.com/viewjob?jk=1234' }),
    );
    expect(result.tier).toBe('UNRESOLVED');
    expect(result.hostClass).toBe('REJECTED_AGGREGATOR');
  });

  it('13. Glassdoor is rejected as a canonical destination outright', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://www.glassdoor.com/job-listing/product-management-intern-1234' }),
    );
    expect(result.tier).toBe('UNRESOLVED');
    expect(result.hostClass).toBe('REJECTED_AGGREGATOR');
  });

  it('14. Jobright itself is rejected as a canonical destination outright', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://jobright.ai/jobs/info/abc123' }),
    );
    expect(result.tier).toBe('UNRESOLVED');
    expect(result.hostClass).toBe('REJECTED_AGGREGATOR');
  });

  it('15. a generic company careers homepage is rejected when an individual job-detail page is required', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://careers.databricks.com/careers' }),
    );
    expect(result.tier).not.toBe('HIGH');
  });

  it('16. a low-confidence result (weak title overlap) remains unresolved, never rounded up', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({
        title: 'Senior Backend Engineer',
        content: 'Databricks is hiring a Senior Backend Engineer in San Francisco.',
      }),
    );
    expect(result.tier).toBe('UNRESOLVED');
  });

  it('never accepts a result merely because its title contains one shared word', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({
        title: 'Intern, Facilities Operations',
        content: 'Databricks is hiring an Intern, Facilities Operations role.',
      }),
    );
    expect(result.tier).toBe('UNRESOLVED');
  });

  it('rejects when the company name is not present anywhere in the candidate', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({
        url: 'https://boards.greenhouse.io/otherco/jobs/1234',
        title: 'Product Management Intern (Summer 2027) - OtherCo',
        content: 'OtherCo is hiring a Product Management Intern for Summer 2027.',
      }),
    );
    expect(result.tier).toBe('UNRESOLVED');
  });

  it('treats an explicit different city with no remote/multi-location language as a mismatch', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({
        title: 'Product Management Intern (Summer 2027) - Databricks - New York, NY',
        content: 'Databricks is hiring a Product Management Intern for Summer 2027 in New York, NY.',
      }),
    );
    expect(result.tier).toBe('UNRESOLVED');
  });

  it('treats an unspecified location as neutral, not a penalty, when the candidate says nothing about location', () => {
    const result = validateOfficialPostingCandidate(
      { ...INPUT, locationText: null },
      candidate({ content: 'Databricks is hiring a Product Management Intern for Summer 2027.' }),
    );
    expect(result.tier).toBe('HIGH');
  });

  it('accepts a remote posting regardless of the expected city', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({ content: 'Databricks is hiring a remote Product Management Intern for Summer 2027.' }),
    );
    expect(result.tier).toBe('HIGH');
  });
});
