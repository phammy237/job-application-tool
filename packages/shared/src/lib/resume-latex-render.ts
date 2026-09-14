import type {
  ResumeBullet,
  ResumeDate,
  ResumeDateRange,
  ResumeEducationEntry,
  ResumeExperienceEntry,
  ResumeHeader,
  ResumeLeadershipEntry,
  ResumeProjectEntry,
  ResumeSkillGroup,
  StructuredResumeV1,
} from '../schemas/resume-content';

/**
 * Deterministic StructuredResumeV1 -> LaTeX rendering (docs/IMPLEMENTATION_PLAN.md "Phase 7C"
 * §12/§13). The same structured input always produces the same LaTeX output — this is a pure
 * function, no I/O, no randomness, no clock reads. LaTeX is a rendering layer over the
 * structured content, never itself the factual source (see resume-content.ts's own doc comment).
 *
 * This module never compiles LaTeX to PDF — see docs/RESUME_STUDIO.md for why real compilation
 * is explicitly deferred (no sandboxed compilation architecture exists yet).
 */

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Escapes LaTeX's special/active characters so arbitrary user-entered text renders as literal
 * text, never as LaTeX markup or commands (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §12 — "Do not
 * allow arbitrary raw LaTeX through normal structured text fields"). Backslash is handled first
 * and via a placeholder, not by naively replacing `\` with `\textbackslash{}` before the other
 * substitutions run — otherwise the backslash *introduced* by escaping e.g. `&` would itself get
 * escaped on a later pass. Order after that doesn't matter since none of the other replacement
 * characters overlap.
 */
export function escapeLatex(text: string): string {
  const BACKSLASH_PLACEHOLDER = '\u0000BACKSLASH\u0000';
  return text
    .replace(/\\/g, BACKSLASH_PLACEHOLDER)
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(new RegExp(BACKSLASH_PLACEHOLDER, 'g'), '\\textbackslash{}');
}

export function formatResumeDate(date: ResumeDate | null): string {
  if (!date) return '';
  return date.month ? `${MONTH_NAMES[date.month - 1]} ${date.year}` : `${date.year}`;
}

export function formatResumeDateRange(range: ResumeDateRange): string {
  const start = formatResumeDate(range.start);
  const end = range.isPresent ? 'Present' : formatResumeDate(range.end);
  if (start && end) return `${start} -- ${end}`;
  return start || end;
}

function renderBullets(bullets: ResumeBullet[]): string {
  if (bullets.length === 0) return '';
  const items = bullets
    .map((b) => `      \\resumeItem{${escapeLatex(b.text)}}`)
    .join('\n');
  return `    \\resumeItemListStart\n${items}\n    \\resumeItemListEnd\n`;
}

function renderEducationEntry(entry: ResumeEducationEntry): string {
  const degreeLine = [entry.degree, entry.fieldOfStudy].filter(Boolean).join(', ');
  const gpaLine = entry.gpa ? ` (GPA: ${escapeLatex(entry.gpa)})` : '';
  const honorsBullet: ResumeBullet[] =
    entry.honors.length > 0
      ? [
          {
            id: `${entry.id}-honors`,
            text: entry.honors.join(', '),
            provenance: { type: 'MANUAL' },
          },
        ]
      : [];
  return (
    `  \\resumeSubheading\n` +
    `    {${escapeLatex(entry.institution)}}{${escapeLatex(entry.location ?? '')}}\n` +
    `    {${escapeLatex(degreeLine)}${gpaLine}}{${escapeLatex(formatResumeDateRange(entry.dateRange))}}\n` +
    renderBullets([...honorsBullet, ...entry.bullets])
  );
}

function renderExperienceEntry(entry: ResumeExperienceEntry): string {
  return (
    `  \\resumeSubheading\n` +
    `    {${escapeLatex(entry.role)}}{${escapeLatex(formatResumeDateRange(entry.dateRange))}}\n` +
    `    {${escapeLatex(entry.organization)}}{${escapeLatex(entry.location ?? '')}}\n` +
    renderBullets(entry.bullets)
  );
}

function renderProjectEntry(entry: ResumeProjectEntry): string {
  const nameAndRole = [entry.name, entry.role]
    .filter((part): part is string => Boolean(part))
    .map(escapeLatex)
    .join(' -- ');
  return (
    `  \\resumeProjectHeading\n` +
    `    {\\textbf{${nameAndRole}}}{${escapeLatex(formatResumeDateRange(entry.dateRange))}}\n` +
    renderBullets(entry.bullets)
  );
}

function renderLeadershipEntry(entry: ResumeLeadershipEntry): string {
  return (
    `  \\resumeSubheading\n` +
    `    {${escapeLatex(entry.organization)}}{${escapeLatex(formatResumeDateRange(entry.dateRange))}}\n` +
    `    {${escapeLatex(entry.role ?? '')}}{${escapeLatex(entry.location ?? '')}}\n` +
    renderBullets(entry.bullets)
  );
}

function renderSkillGroup(group: ResumeSkillGroup): string {
  const items = group.items.map(escapeLatex).join(', ');
  return `      \\item \\textbf{${escapeLatex(group.label)}}{: ${items}}`;
}

function renderHeader(header: ResumeHeader): string {
  const contactParts: string[] = [];
  if (header.phone) contactParts.push(escapeLatex(header.phone));
  if (header.email) {
    contactParts.push(
      `\\href{mailto:${escapeLatex(header.email)}}{${escapeLatex(header.email)}}`,
    );
  }
  if (header.location) contactParts.push(escapeLatex(header.location));
  if (header.links.linkedin) {
    contactParts.push(`\\href{${escapeLatex(header.links.linkedin)}}{LinkedIn}`);
  }
  if (header.links.github) {
    contactParts.push(`\\href{${escapeLatex(header.links.github)}}{GitHub}`);
  }
  if (header.links.portfolio) {
    contactParts.push(`\\href{${escapeLatex(header.links.portfolio)}}{Portfolio}`);
  }
  if (header.links.website) {
    contactParts.push(`\\href{${escapeLatex(header.links.website)}}{Website}`);
  }
  const contactLine = contactParts.join(' $|$ ');

  return (
    `\\begin{center}\n` +
    `  {\\Huge \\scshape ${escapeLatex(header.fullName)}} \\\\ \\vspace{3pt}\n` +
    (contactLine ? `  \\small ${contactLine}\n` : '') +
    `\\end{center}\n`
  );
}

/** Preamble is fixed and self-contained — no external `.cls`/`.sty` files, no `\input` of
 * anything outside this one generated string (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §26: "no
 * arbitrary \input of host files"). Every command used by the section renderers above is defined
 * here. */
const PREAMBLE = `\\documentclass[11pt,letterpaper]{article}

\\usepackage[margin=0.75in]{geometry}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage{hyperref}
\\hypersetup{hidelinks}

\\pagestyle{empty}
\\setlength{\\tabcolsep}{0in}

\\titleformat{\\section}{\\large\\bfseries\\scshape}{}{0em}{}[\\titlerule]
\\titlespacing*{\\section}{0pt}{10pt}{6pt}

\\newcommand{\\resumeItem}[1]{\\item\\small{#1 \\vspace{-1pt}}}
\\newcommand{\\resumeSubheading}[4]{
  \\vspace{2pt}\\item
    \\begin{tabular*}{\\textwidth}{l@{\\extracolsep{\\fill}}r}
      \\textbf{#1} & #2 \\\\
      \\textit{\\small#3} & \\textit{\\small #4} \\\\
    \\end{tabular*}\\vspace{-4pt}
}
\\newcommand{\\resumeProjectHeading}[2]{
  \\vspace{2pt}\\item
    \\begin{tabular*}{\\textwidth}{l@{\\extracolsep{\\fill}}r}
      #1 & #2 \\\\
    \\end{tabular*}\\vspace{-4pt}
}
\\renewcommand{\\labelitemii}{$\\circ$}
\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}]}
\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}[leftmargin=0.2in, label={\\textbullet}]}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-5pt}}
`;

function renderSection(title: string, body: string): string {
  if (!body.trim()) return '';
  return `\\section{${title}}\n\\resumeSubHeadingListStart\n${body}\\resumeSubHeadingListEnd\n\n`;
}

/**
 * Renders a full, self-contained, one-page-style ATS-friendly LaTeX document. Every section is
 * omitted entirely when its array is empty (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §40 "empty
 * sections") rather than rendered as an empty heading. Section order is fixed: Education,
 * Experience, Projects, Leadership, Skills.
 */
export function renderStructuredResumeToLatex(resume: StructuredResumeV1): string {
  const parts: string[] = [PREAMBLE, '\\begin{document}\n', renderHeader(resume.header)];

  parts.push(
    renderSection('Education', resume.education.map(renderEducationEntry).join('')),
  );
  parts.push(
    renderSection('Experience', resume.experience.map(renderExperienceEntry).join('')),
  );
  parts.push(renderSection('Projects', resume.projects.map(renderProjectEntry).join('')));
  parts.push(
    renderSection('Leadership', resume.leadership.map(renderLeadershipEntry).join('')),
  );

  if (resume.skills.length > 0) {
    const items = resume.skills.map(renderSkillGroup).join('\n');
    parts.push(
      `\\section{Skills}\n\\begin{itemize}[leftmargin=0.15in, label={}]\\itemsep -2pt\n${items}\n\\end{itemize}\n\n`,
    );
  }

  parts.push('\\end{document}\n');
  return parts.join('');
}

/**
 * The actual LaTeX for a version — the user's explicit "Advanced" override when present, or the
 * deterministic render of the structured content otherwise (docs/IMPLEMENTATION_PLAN.md "Phase
 * 7C" §14). This is the one function every caller (studio preview, .tex download, a future PDF
 * compilation phase) should use rather than calling `renderStructuredResumeToLatex` directly, so
 * "does this resume have a custom override" is decided in exactly one place.
 */
export function getLatexForResumeVersion(resume: StructuredResumeV1): string {
  return resume.renderOverride?.latex ?? renderStructuredResumeToLatex(resume);
}
