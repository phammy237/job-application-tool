import { describe, expect, it } from 'vitest';
import { createEmptyStructuredResume } from '../schemas/resume-content';
import {
  escapeLatex,
  formatResumeDate,
  formatResumeDateRange,
  getLatexForResumeVersion,
  renderStructuredResumeToLatex,
} from './resume-latex-render';

const HEADER = {
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '555-1234',
  location: 'London, UK',
  links: {
    linkedin: 'https://linkedin.com/in/ada',
    github: null,
    portfolio: null,
    website: null,
  },
};

describe('escapeLatex', () => {
  it.each([
    ['&', '\\&'],
    ['%', '\\%'],
    ['$', '\\$'],
    ['#', '\\#'],
    ['_', '\\_'],
    ['{', '\\{'],
    ['}', '\\}'],
    ['~', '\\textasciitilde{}'],
    ['^', '\\textasciicircum{}'],
  ])('escapes %s', (input, expected) => {
    expect(escapeLatex(input)).toBe(expected);
  });

  it('escapes backslash without double-escaping characters it introduces', () => {
    expect(escapeLatex('\\')).toBe('\\textbackslash{}');
  });

  it('escapes a realistic bullet with several special characters at once', () => {
    expect(escapeLatex('Grew revenue 50% & cut costs $10k (R&D_team) {A/B}')).toBe(
      'Grew revenue 50\\% \\& cut costs \\$10k (R\\&D\\_team) \\{A/B\\}',
    );
  });

  it('leaves ordinary punctuation and unicode untouched', () => {
    expect(escapeLatex("Ådá's café — 100% café")).toBe("Ådá's café — 100\\% café");
  });

  it('is idempotent-safe: escaping does not corrupt already-safe plain text', () => {
    expect(escapeLatex('Plain text, no special chars.')).toBe(
      'Plain text, no special chars.',
    );
  });
});

describe('formatResumeDate', () => {
  it('formats a month + year', () => {
    expect(formatResumeDate({ year: 2025, month: 5 })).toBe('May 2025');
  });

  it('formats a year-only date', () => {
    expect(formatResumeDate({ year: 2025, month: null })).toBe('2025');
  });

  it('returns an empty string for null', () => {
    expect(formatResumeDate(null)).toBe('');
  });
});

describe('formatResumeDateRange', () => {
  it('formats a full range', () => {
    expect(
      formatResumeDateRange({
        start: { year: 2023, month: 8 },
        end: { year: 2025, month: 5 },
        isPresent: false,
      }),
    ).toBe('Aug 2023 -- May 2025');
  });

  it('formats an ongoing range as Present', () => {
    expect(
      formatResumeDateRange({
        start: { year: 2023, month: 8 },
        end: null,
        isPresent: true,
      }),
    ).toBe('Aug 2023 -- Present');
  });

  it('formats a start-only range with no end', () => {
    expect(
      formatResumeDateRange({
        start: { year: 2023, month: 8 },
        end: null,
        isPresent: false,
      }),
    ).toBe('Aug 2023');
  });

  it('formats a fully blank range as empty', () => {
    expect(formatResumeDateRange({ start: null, end: null, isPresent: false })).toBe('');
  });
});

describe('renderStructuredResumeToLatex', () => {
  it('renders a minimal resume (header only) with no empty section headings', () => {
    const resume = createEmptyStructuredResume(HEADER);
    const latex = renderStructuredResumeToLatex(resume);
    expect(latex).toContain('Ada Lovelace');
    expect(latex).not.toContain('\\section{Education}');
    expect(latex).not.toContain('\\section{Experience}');
    expect(latex).not.toContain('\\section{Skills}');
    expect(latex).toContain('\\begin{document}');
    expect(latex).toContain('\\end{document}');
  });

  it('renders a full resume with every section populated, preserving array order', () => {
    const resume = {
      ...createEmptyStructuredResume(HEADER),
      education: [
        {
          id: 'e1',
          institution: 'MIT',
          degree: 'B.S.',
          fieldOfStudy: 'Computer Science',
          location: 'Cambridge, MA',
          dateRange: {
            start: { year: 2020, month: 9 },
            end: { year: 2024, month: 5 },
            isPresent: false,
          },
          gpa: '3.9',
          honors: ["Dean's List"],
          bullets: [],
        },
      ],
      experience: [
        {
          id: 'x1',
          organization: 'Acme Corp',
          role: 'Software Engineer',
          location: 'Remote',
          dateRange: { start: { year: 2024, month: 6 }, end: null, isPresent: true },
          bullets: [
            {
              id: 'b1',
              text: 'Built the widget pipeline.',
              provenance: { type: 'MANUAL' as const },
            },
            {
              id: 'b2',
              text: 'Reduced latency by 30%.',
              provenance: { type: 'MANUAL' as const },
            },
          ],
        },
      ],
      projects: [
        {
          id: 'p1',
          name: 'Career OS',
          role: 'Creator',
          url: 'https://example.com',
          dateRange: { start: null, end: null, isPresent: false },
          bullets: [
            {
              id: 'b3',
              text: 'Shipped résumé versioning.',
              provenance: { type: 'MANUAL' as const },
            },
          ],
        },
      ],
      leadership: [
        {
          id: 'l1',
          organization: 'CS Club',
          role: 'President',
          location: null,
          dateRange: {
            start: { year: 2022, month: 1 },
            end: { year: 2023, month: 1 },
            isPresent: false,
          },
          bullets: [],
        },
      ],
      skills: [
        { id: 's1', label: 'Languages', items: ['Python', 'TypeScript'] },
        { id: 's2', label: 'Frameworks', items: ['React', 'Next.js'] },
      ],
    };

    const latex = renderStructuredResumeToLatex(resume);

    expect(latex).toContain('\\section{Education}');
    expect(latex).toContain('MIT');
    expect(latex).toContain('\\section{Experience}');
    expect(latex).toContain('Acme Corp');
    expect(latex).toContain('\\section{Projects}');
    expect(latex).toContain('Career OS');
    expect(latex).toContain('\\section{Leadership}');
    expect(latex).toContain('CS Club');
    expect(latex).toContain('\\section{Skills}');
    expect(latex).toContain('Languages');

    // Order preserved: Education section appears before Experience, which appears before
    // Projects, which appears before Leadership, which appears before Skills.
    const eduIdx = latex.indexOf('\\section{Education}');
    const expIdx = latex.indexOf('\\section{Experience}');
    const projIdx = latex.indexOf('\\section{Projects}');
    const leadIdx = latex.indexOf('\\section{Leadership}');
    const skillsIdx = latex.indexOf('\\section{Skills}');
    expect(eduIdx).toBeLessThan(expIdx);
    expect(expIdx).toBeLessThan(projIdx);
    expect(projIdx).toBeLessThan(leadIdx);
    expect(leadIdx).toBeLessThan(skillsIdx);

    // Bullet order within an entry is preserved.
    const bulletsIdx1 = latex.indexOf('Built the widget pipeline.');
    const bulletsIdx2 = latex.indexOf('Reduced latency by 30');
    expect(bulletsIdx1).toBeLessThan(bulletsIdx2);
  });

  it('is deterministic — identical input produces byte-identical output', () => {
    const resume = createEmptyStructuredResume(HEADER);
    expect(renderStructuredResumeToLatex(resume)).toBe(
      renderStructuredResumeToLatex(resume),
    );
  });

  it('escapes special characters appearing in entry fields, not just bullets', () => {
    const resume = {
      ...createEmptyStructuredResume(HEADER),
      experience: [
        {
          id: 'x1',
          organization: 'Acme & Co',
          role: 'Engineer #1',
          location: null,
          dateRange: { start: null, end: null, isPresent: false },
          bullets: [],
        },
      ],
    };
    const latex = renderStructuredResumeToLatex(resume);
    expect(latex).toContain('Acme \\& Co');
    expect(latex).toContain('Engineer \\#1');
  });

  it('omits an empty skills section entirely', () => {
    const resume = createEmptyStructuredResume(HEADER);
    expect(renderStructuredResumeToLatex(resume)).not.toContain('\\section{Skills}');
  });
});

describe('getLatexForResumeVersion', () => {
  it('uses the deterministic render when there is no override', () => {
    const resume = createEmptyStructuredResume(HEADER);
    expect(getLatexForResumeVersion(resume)).toBe(renderStructuredResumeToLatex(resume));
  });

  it('uses the custom override verbatim when present, never the generated render', () => {
    const resume = {
      ...createEmptyStructuredResume(HEADER),
      renderOverride: {
        latex: '\\documentclass{article}\\begin{document}Custom\\end{document}',
      },
    };
    expect(getLatexForResumeVersion(resume)).toBe(
      '\\documentclass{article}\\begin{document}Custom\\end{document}',
    );
  });
});
