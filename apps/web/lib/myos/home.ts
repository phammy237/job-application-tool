import type { EvidenceGraphData, GithubConnection, MyosCandidate } from '@career-os/shared';

/** Pure helpers for the /my overview. No I/O; everything is derived from already-loaded data. */

export interface SnapshotCounts {
  projects: number;
  skills: number;
  experiences: number;
  achievements: number;
  stories: number;
  evidence: number;
}

export interface Snapshot {
  counts: SnapshotCounts;
  total: number;
  confirmed: number;
  unconfirmed: number;
  sentence: string;
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function buildSnapshot(graph: EvidenceGraphData): Snapshot {
  const counts: SnapshotCounts = {
    projects: graph.projects.length,
    skills: graph.skills.length,
    experiences: graph.experiences.length,
    achievements: graph.achievements.length,
    stories: graph.stories.length,
    evidence: graph.evidence.length,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const confirmed =
    graph.projects.filter((p) => p.userApproved).length +
    graph.skills.filter((s) => s.userApproved).length +
    graph.experiences.filter((e) => e.userApproved).length +
    graph.achievements.filter((a) => a.userApproved).length +
    graph.stories.filter((s) => s.userApproved).length +
    graph.evidence.filter(
      (e) => e.verificationState === 'VERIFIED' || e.verificationState === 'USER_PROVIDED',
    ).length;
  const unconfirmed = total - confirmed;

  if (total === 0) {
    return {
      counts,
      total,
      confirmed,
      unconfirmed,
      sentence: 'Career OS does not know anything about your work yet.',
    };
  }
  const parts = [
    plural(counts.projects, 'project'),
    plural(counts.skills, 'skill'),
    plural(counts.experiences, 'experience'),
    plural(counts.achievements, 'achievement'),
    plural(counts.stories, 'story', 'stories'),
    `${counts.evidence} evidence ${counts.evidence === 1 ? 'item' : 'items'}`,
  ];
  const tail =
    unconfirmed === 0
      ? 'All of it is confirmed by you.'
      : `${confirmed} of ${total} ${confirmed === 1 ? 'is' : 'are'} confirmed by you; the other ${unconfirmed} ${unconfirmed === 1 ? 'is' : 'are'} unapproved or only inferred.`;
  return {
    counts,
    total,
    confirmed,
    unconfirmed,
    sentence: `Career OS currently holds ${parts.join(', ')}. ${tail}`,
  };
}

export interface ChecklistItem {
  step: number;
  label: string;
  href: string;
  done: boolean;
  hint: string;
}

export function buildChecklist(
  graph: EvidenceGraphData,
  connection: GithubConnection | null,
  pendingCandidates: MyosCandidate[],
): ChecklistItem[] {
  const pendingSkills = pendingCandidates.filter((c) => c.payload.kind === 'SKILL').length;
  const hasConfirmedSkill = graph.skills.some((s) => s.userApproved);
  return [
    {
      step: 1,
      label: 'Import GitHub',
      href: '/my/github',
      done: connection !== null,
      hint: 'Connect a username and select the repositories that represent your work.',
    },
    {
      step: 2,
      label: 'Add experiences',
      href: '/profile',
      done: graph.experiences.length > 0,
      hint: 'Roles and employers live on your profile.',
    },
    {
      step: 3,
      label: 'Add projects',
      href: '/my/projects',
      done: graph.projects.length > 0,
      hint: 'Create projects manually or import them from GitHub.',
    },
    {
      step: 4,
      label: 'Confirm detected skills',
      href: '/my/projects',
      done: hasConfirmedSkill && pendingSkills === 0,
      hint:
        pendingSkills > 0
          ? `${plural(pendingSkills, 'suggested skill')} waiting for your decision.`
          : 'Skills detected from your repositories appear as suggestions on each project.',
    },
    {
      step: 5,
      label: 'Add achievements',
      href: '/my/projects',
      done: graph.achievements.length > 0,
      hint: 'Record outcomes and metrics you can back with evidence.',
    },
    {
      step: 6,
      label: 'Review your first profile',
      href: '/profile',
      done: graph.projects.some((p) => p.userApproved && p.approvedForApplications),
      hint: 'Approve at least one project for applications.',
    },
  ];
}

/** True when there is too little data for the dashboard sections to be meaningful. */
export function isNearlyEmpty(snapshot: Snapshot): boolean {
  return snapshot.counts.projects < 2 && snapshot.total < 5;
}

/** Plain-language list of what the system cannot currently speak to. */
export function buildUnknowns(
  graph: EvidenceGraphData,
  connection: GithubConnection | null,
): string[] {
  const out: string[] = [];
  if (graph.experiences.length === 0) out.push('your work history (no experiences added)');
  if (graph.projects.length === 0) out.push('what you have built (no projects)');
  if (graph.skills.length === 0) out.push('which skills you hold (none confirmed)');
  if (graph.achievements.length === 0) out.push('your outcomes and metrics (no achievements)');
  if (graph.evidence.length === 0) out.push('anything it can cite as proof (no evidence)');
  if (graph.stories.length === 0) out.push('your interview stories');
  if (!connection) out.push('your GitHub activity (not connected)');
  return out;
}

/** ISO date (YYYY-MM-DD) for display, or an em dash. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}
