import { describe, expect, it } from 'vitest';
import { titlesMateriallyConflict, validateOfficialPostingCandidate } from './official-posting-validator';

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
  it('6. accepts the official employer career domain at HIGH confidence once its hostname deterministically matches the company name — no classifyJobPostingHost hint needed', () => {
    const result = validateOfficialPostingCandidate(
      INPUT,
      candidate({ url: 'https://careers.databricks.com/jobs/1234' }),
    );
    // Post-hardening: matchesEmployerDomain("Databricks", "careers.databricks.com") is an exact
    // root-label match, and every other HIGH-tier signal (company, strong title overlap,
    // page-type) is already satisfied by this fixture — hostClass itself still reports UNKNOWN
    // (classifyJobPostingHost is never given a hint), but employerDomainMatch now carries the
    // evidence that gets this candidate to HIGH.
    expect(result.tier).toBe('HIGH');
    expect(result.hostClass).toBe('UNKNOWN');
    expect(result.employerDomainMatch).toBe(true);
  });

  it('production case: careers.cisco.com reaches HIGH for a Cisco posting with strong title overlap', () => {
    const result = validateOfficialPostingCandidate(
      { companyName: 'Cisco', title: 'Business Analyst I Intern', locationText: null },
      {
        url: 'https://careers.cisco.com/jobs/ProjectDetail/Business-Analyst-I-Intern/1234567',
        title: 'Business Analyst I Intern - Cisco Careers',
        content: 'Cisco is hiring a Business Analyst I Intern.',
      },
    );
    expect(result.tier).toBe('HIGH');
    expect(result.employerDomainMatch).toBe(true);
  });

  it('production case: careers.rtx.com reaches HIGH for an RTX posting with strong title overlap', () => {
    const result = validateOfficialPostingCandidate(
      { companyName: 'RTX', title: 'Software Engineer I', locationText: null },
      {
        url: 'https://careers.rtx.com/global/en/job/1234567/Software-Engineer-I',
        title: 'Software Engineer I - RTX Careers',
        content: 'RTX is hiring a Software Engineer I.',
      },
    );
    expect(result.tier).toBe('HIGH');
    expect(result.employerDomainMatch).toBe(true);
  });

  it('production case: careers.manulife.com reaches HIGH for a Manulife posting with strong title overlap', () => {
    const result = validateOfficialPostingCandidate(
      { companyName: 'Manulife', title: 'Data Analyst', locationText: null },
      {
        url: 'https://careers.manulife.com/us/en/job/1234567/Data-Analyst',
        title: 'Data Analyst - Manulife Careers',
        content: 'Manulife is hiring a Data Analyst.',
      },
    );
    expect(result.tier).toBe('HIGH');
    expect(result.employerDomainMatch).toBe(true);
  });

  it('an employer-looking domain with only weak title evidence stays REVIEW, never promoted just for matching the domain', () => {
    const result = validateOfficialPostingCandidate(
      { companyName: 'Cisco', title: 'Business Analyst I Intern', locationText: null },
      {
        url: 'https://careers.cisco.com/jobs/ProjectDetail/Business-Analyst-I-Intern/1234567',
        // Weaker title overlap than the HIGH case above (missing "Intern") — clears the REVIEW
        // bar (company confirmed, most tokens overlap) but not the stricter HIGH bar.
        title: 'Business Analyst I - Cisco Careers',
        content: 'Cisco is hiring for a Business Analyst I role.',
      },
    );
    expect(result.tier).toBe('REVIEW');
    expect(result.employerDomainMatch).toBe(true);
  });

  it('employer-domain-match evidence never promotes a third-party mirror, even with a matching title, because the domain itself never matches the company', () => {
    const bebee = validateOfficialPostingCandidate(
      { companyName: 'Cisco', title: 'Business Analyst I Intern', locationText: null },
      {
        url: 'https://www.bebee.com/job/cisco-business-analyst-i-intern',
        title: 'Business Analyst I Intern - Cisco',
        content: 'Cisco is hiring a Business Analyst I Intern.',
      },
    );
    expect(bebee.tier).toBe('UNRESOLVED');
    expect(bebee.hostClass).toBe('REJECTED_AGGREGATOR');

    const university = validateOfficialPostingCandidate(
      { companyName: 'Cisco', title: 'Business Analyst I Intern', locationText: null },
      {
        url: 'https://careerservices.stjohns.edu/jobs/cisco-business-analyst-i-intern',
        title: 'Business Analyst I Intern - Cisco',
        content: 'Cisco is hiring a Business Analyst I Intern.',
      },
    );
    expect(university.tier).toBe('UNRESOLVED');
    expect(university.hostClass).toBe('REJECTED_AGGREGATOR');

    const prosple = validateOfficialPostingCandidate(
      { companyName: 'Cisco', title: 'Business Analyst I Intern', locationText: null },
      {
        url: 'https://www.prosple.com/graduate-employers/cisco/jobs/business-analyst-i-intern',
        title: 'Business Analyst I Intern - Cisco',
        content: 'Cisco is hiring a Business Analyst I Intern.',
      },
    );
    expect(prosple.tier).toBe('UNRESOLVED');
    expect(prosple.employerDomainMatch).toBe(false);
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

describe('titlesMateriallyConflict', () => {
  it('flags the real QTS shape: same employer, different requisition title', () => {
    expect(
      titlesMateriallyConflict(
        'Summer 2027 Internship: Process Analytics - Technology Delivery Team',
        'Summer 2026 Internship: IT Asset Management',
      ),
    ).toBe(true);
  });

  it('flags a sibling role (Product Design vs Product Manager)', () => {
    expect(titlesMateriallyConflict('Summer 2027: Product Manager Intern', 'Summer 2027: Product Design Intern')).toBe(true);
  });

  it('does not flag identical or reordered titles', () => {
    expect(titlesMateriallyConflict('Product Manager Intern - Summer 2027', 'Summer 2027 Product Manager Intern')).toBe(false);
  });

  it('does not flag a page title that merely lacks the catalog title\'s boilerplate suffix', () => {
    expect(
      titlesMateriallyConflict('IT Analyst Intern- Minnesota Job Details / Boston Scientific', 'IT Analyst Intern- Minnesota'),
    ).toBe(false);
  });

  it('does not flag a page title that adds boilerplate around the expected title', () => {
    expect(titlesMateriallyConflict('Data Science Intern', 'Data Science Intern | Careers at Acme')).toBe(false);
  });
});

describe('titlesMateriallyConflict — punctuation', () => {
  it('ignores parentheses, colons and pipes that the shared tokenizer does not split on', () => {
    expect(titlesMateriallyConflict('Product Management Intern (Summer 2027)', 'Product Management Intern - Summer 2027')).toBe(false);
    expect(
      titlesMateriallyConflict(
        'Summer 2027 Internship: Process Analytics - Technology Delivery Team',
        'Summer 2027 Internship - Process Analytics - Technology Delivery Team',
      ),
    ).toBe(false);
  });
});
