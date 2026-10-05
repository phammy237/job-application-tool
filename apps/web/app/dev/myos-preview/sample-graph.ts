import type {
  EdgeRelation,
  EvidenceGraphData,
  GithubConnection,
  GithubRepository,
  GithubSyncRun,
  MyosAchievement,
  MyosCandidate,
  MyosEdge,
  MyosEvidence,
  MyosStory,
  NodeType,
  VerificationState,
} from '@career-os/shared';

/**
 * FICTIONAL sample data for the dev-only myOS preview (/dev/myos-preview). Not a real person, not
 * loaded from or written to any database. Exists so the myOS views can be inspected locally when
 * Supabase is unavailable.
 */

const USER = '00000000-0000-4000-8000-00000000a000';
const TS = '2026-09-01T00:00:00.000Z';

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

// ---- skills --------------------------------------------------------------------------------
const skillNames = [
  ['Python', 'LANGUAGE'],
  ['FastAPI', 'FRAMEWORK'],
  ['PostgreSQL', 'DATABASE'],
  ['React', 'FRAMEWORK'],
  ['TypeScript', 'LANGUAGE'],
  ['Next.js', 'FRAMEWORK'],
  ['SQL', 'LANGUAGE'],
  ['User Research', 'PRACTICE'],
  ['Product Management', 'PRACTICE'],
  ['Data Analysis', 'PRACTICE'],
  ['Machine Learning', 'AI_ML'],
  ['Kubernetes', 'CLOUD'],
] as const;
const skills = skillNames.map(([name, category]) => ({
  id: id(),
  name,
  category,
  visibility: 'CAREER_OS_ONLY' as const,
  userApproved: true,
  approvedForApplications: true,
}));
const S = Object.fromEntries(skills.map((s) => [s.name, s.id])) as Record<
  (typeof skillNames)[number][0],
  string
>;

// ---- projects ------------------------------------------------------------------------------
const base = {
  collaborators: [] as string[],
  talkingPoints: [] as string[],
  visibility: 'PRIVATE' as const,
  userApproved: true,
  approvedForApplications: true,
  role: null as string | null,
  summary: null as string | null,
  url: null as string | null,
  tags: [] as string[],
};
const routing = {
  ...base,
  id: id(),
  name: 'Transit Routing Service',
  description: 'Event-aware routing API for a campus shuttle network (sample project).',
  summary: 'FastAPI service that computes shuttle routes and adapts to live events.',
  role: 'Backend lead',
  startDate: '2025-09-01',
  endDate: null,
  status: 'ACTIVE' as const,
  origin: 'GITHUB' as const,
  url: 'https://github.com/sample-user/transit-routing',
  collaborators: ['Two classmates'],
  talkingPoints: [
    'Chose PostgreSQL for geospatial queries',
    'Added caching for route lookups',
  ],
  visibility: 'PUBLIC' as const,
};
const marketplace = {
  ...base,
  id: id(),
  name: 'Campus Marketplace App',
  description:
    'Student-to-student marketplace; led user interviews and roadmap (sample).',
  role: 'Product + frontend',
  startDate: '2024-09-01',
  endDate: '2025-05-01',
  status: 'COMPLETED' as const,
  origin: 'MANUAL' as const,
};
const hackathon = {
  ...base,
  id: id(),
  name: 'Health Tracker (Hackathon)',
  description: 'Weekend hackathon prototype using a small ML model (sample).',
  startDate: '2025-02-14',
  endDate: '2025-02-16',
  status: 'COMPLETED' as const,
  origin: 'MANUAL' as const,
};
const portfolio = {
  ...base,
  id: id(),
  name: 'portfolio-site',
  description: 'Imported from GitHub, not reviewed yet.',
  startDate: '2026-06-01',
  endDate: null,
  status: 'ACTIVE' as const,
  origin: 'GITHUB' as const,
  userApproved: false,
  approvedForApplications: false,
};
const projects = [routing, marketplace, hackathon, portfolio];

// ---- experiences / education ---------------------------------------------------------------
const pmIntern = {
  id: id(),
  company: 'Sample Co',
  title: 'Product Management Intern',
  startDate: '2025-06-01',
  endDate: '2025-08-31',
  description:
    'Ran customer interviews and wrote specs with engineering and design (sample).',
  tags: [],
  visibility: 'CAREER_OS_ONLY' as const,
  userApproved: true,
  approvedForApplications: true,
};
const labAssistant = {
  id: id(),
  company: 'University Data Lab',
  title: 'Data Analyst Assistant',
  startDate: '2024-01-15',
  endDate: '2024-12-15',
  description:
    'Cleaned survey data with Python and SQL; built weekly dashboards (sample).',
  tags: [],
  visibility: 'PRIVATE' as const,
  userApproved: true,
  approvedForApplications: true,
};
const education = [
  {
    id: id(),
    school: 'Sample State University',
    degree: 'B.S.',
    fieldOfStudy: 'Computer Science',
    startDate: '2023-08-20',
    graduationDate: '2027-05-15',
    honors: [],
    userApproved: true,
  },
];

// ---- evidence ------------------------------------------------------------------------------
function ev(
  over: Partial<MyosEvidence> &
    Pick<MyosEvidence, 'sourceType' | 'title' | 'verificationState'>,
): MyosEvidence {
  return {
    id: id(),
    userId: USER,
    sourceRef: null,
    sourceUrl: null,
    excerpt: null,
    occurredAt: null,
    confidence: null,
    visibility: 'PRIVATE',
    metadata: {},
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}
const repoEv = ev({
  sourceType: 'GITHUB_REPO',
  title: 'sample-user/transit-routing',
  sourceRef: 'sample-user/transit-routing',
  sourceUrl: 'https://github.com/sample-user/transit-routing',
  excerpt: 'Python FastAPI service backed by PostgreSQL.',
  occurredAt: '2026-08-20T00:00:00.000Z',
  verificationState: 'VERIFIED',
  metadata: {
    languages: { Python: 81000, SQL: 9000 },
    topics: ['fastapi', 'postgresql'],
  },
});
const prEv = ev({
  sourceType: 'GITHUB_PR',
  title: 'Add event-aware route cache (#42)',
  sourceRef: 'sample-user/transit-routing#42',
  sourceUrl: 'https://github.com/sample-user/transit-routing/pull/42',
  excerpt: 'Caches route lookups in PostgreSQL; benchmark shows 40% faster p95 lookups.',
  occurredAt: '2026-04-02T00:00:00.000Z',
  verificationState: 'VERIFIED',
});
const interviewsEv = ev({
  sourceType: 'USER_NOTE',
  title: 'User interview synthesis (12 interviews)',
  excerpt: 'User research synthesis that reprioritized the marketplace roadmap.',
  occurredAt: '2024-11-10T00:00:00.000Z',
  verificationState: 'USER_PROVIDED',
});
const hackEv = ev({
  sourceType: 'LINK',
  title: 'Hackathon submission page',
  sourceUrl: 'https://example.com/sample-hackathon/health-tracker',
  excerpt:
    'Python prototype with a small machine learning model for step-count anomalies.',
  occurredAt: '2025-02-16T00:00:00.000Z',
  verificationState: 'USER_PROVIDED',
});
const awardEv = ev({
  sourceType: 'AWARD',
  title: '2nd place announcement',
  sourceUrl: 'https://example.com/sample-hackathon/winners',
  occurredAt: '2025-02-16T00:00:00.000Z',
  verificationState: 'USER_PROVIDED',
});
const evidence = [repoEv, prEv, interviewsEv, hackEv, awardEv];

// ---- achievements / stories ----------------------------------------------------------------
function ach(
  over: Partial<MyosAchievement> & Pick<MyosAchievement, 'title'>,
): MyosAchievement {
  return {
    id: id(),
    userId: USER,
    description: null,
    kind: 'ACHIEVEMENT',
    occurredOn: null,
    metricText: null,
    projectId: null,
    experienceId: null,
    verificationState: 'USER_PROVIDED',
    userApproved: true,
    visibility: 'PRIVATE',
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}
const award = ach({
  title: '2nd place, Sample Hackathon',
  kind: 'AWARD',
  occurredOn: '2025-02-16',
  projectId: hackathon.id,
});
const latency = ach({
  title: 'Faster route lookups',
  kind: 'METRIC',
  metricText: '40% faster p95 lookups',
  occurredOn: '2026-04-02',
  projectId: routing.id,
  verificationState: 'VERIFIED',
});
const achievements = [award, latency];

function story(over: Partial<MyosStory> & Pick<MyosStory, 'title'>): MyosStory {
  return {
    id: id(),
    userId: USER,
    situation: null,
    task: null,
    action: null,
    result: null,
    competencies: [],
    themes: [],
    verificationState: 'USER_PROVIDED',
    userApproved: true,
    visibility: 'PRIVATE',
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}
const roadmapStory = story({
  title: 'Reprioritizing the marketplace roadmap after user interviews',
  situation: 'Our marketplace roadmap was driven by guesses about what students wanted.',
  task: 'Find out what actually blocked trades and re-plan the next sprint.',
  action:
    'Ran 12 interviews, synthesized themes, and walked the team through the trade-offs.',
  result: 'We cut two planned features and shipped in-app pickup scheduling first.',
  competencies: ['USER_RESEARCH', 'PRIORITIZATION', 'CROSS_FUNCTIONAL_COLLABORATION'],
});
const outageStory = story({
  title: 'Debugging a routing outage before demo day',
  situation: 'Route lookups timed out the night before a demo.',
  task: 'Restore the service and prevent a repeat.',
  action: 'Profiled queries, added an index and a lookup cache, wrote a load test.',
  result: 'Demo ran cleanly; the cache became PR #42.',
  competencies: ['OWNERSHIP', 'TECHNICAL_DECISION_MAKING'],
});
const draftStory = story({
  title: 'Leading the hackathon team (draft)',
  competencies: ['LEADERSHIP'],
  userApproved: false,
});
const stories = [roadmapStory, outageStory, draftStory];

// ---- edges ---------------------------------------------------------------------------------
const edges: MyosEdge[] = [];
function link(
  fromType: NodeType,
  fromId: string,
  toType: NodeType,
  toId: string,
  relation: EdgeRelation,
  verificationState: VerificationState = 'USER_PROVIDED',
) {
  edges.push({
    id: id(),
    userId: USER,
    fromType,
    fromId,
    toType,
    toId,
    relation,
    verificationState,
    confidence: null,
    note: null,
    createdAt: TS,
  });
}
// Project -> skill
for (const s of ['Python', 'FastAPI', 'PostgreSQL'] as const)
  link('PROJECT', routing.id, 'SKILL', S[s], 'DEMONSTRATES');
for (const s of ['React', 'TypeScript', 'User Research', 'Product Management'] as const)
  link('PROJECT', marketplace.id, 'SKILL', S[s], 'DEMONSTRATES');
for (const s of ['Python', 'Machine Learning'] as const)
  link('PROJECT', hackathon.id, 'SKILL', S[s], 'DEMONSTRATES');
link('PROJECT', portfolio.id, 'SKILL', S['Next.js'], 'USES', 'INFERRED');
// Experience -> skill
for (const s of ['Product Management', 'User Research'] as const)
  link('EXPERIENCE', pmIntern.id, 'SKILL', S[s], 'DEMONSTRATES');
for (const s of ['Python', 'SQL', 'Data Analysis'] as const)
  link('EXPERIENCE', labAssistant.id, 'SKILL', S[s], 'DEMONSTRATES');
// Evidence -> things
link('EVIDENCE', repoEv.id, 'PROJECT', routing.id, 'REPRESENTS', 'VERIFIED');
link('EVIDENCE', prEv.id, 'PROJECT', routing.id, 'SUPPORTS', 'VERIFIED');
link('EVIDENCE', prEv.id, 'ACHIEVEMENT', latency.id, 'SUPPORTS', 'USER_PROVIDED');
link('EVIDENCE', interviewsEv.id, 'PROJECT', marketplace.id, 'SUPPORTS');
link('EVIDENCE', interviewsEv.id, 'SKILL', S['User Research'], 'SUPPORTS');
link('EVIDENCE', hackEv.id, 'PROJECT', hackathon.id, 'SUPPORTS');
link('EVIDENCE', awardEv.id, 'ACHIEVEMENT', award.id, 'SUPPORTS');
// Achievements -> projects
link('ACHIEVEMENT', award.id, 'PROJECT', hackathon.id, 'BELONGS_TO');
link('ACHIEVEMENT', latency.id, 'PROJECT', routing.id, 'BELONGS_TO');
// Stories -> things
link('STORY', roadmapStory.id, 'PROJECT', marketplace.id, 'REFERENCES');
link('STORY', roadmapStory.id, 'EVIDENCE', interviewsEv.id, 'REFERENCES');
link('STORY', outageStory.id, 'PROJECT', routing.id, 'REFERENCES');
link('STORY', outageStory.id, 'EVIDENCE', prEv.id, 'REFERENCES');
link('STORY', draftStory.id, 'PROJECT', hackathon.id, 'REFERENCES');

export const SAMPLE_GRAPH: EvidenceGraphData = {
  projects,
  skills,
  experiences: [pmIntern, labAssistant],
  education,
  achievements,
  stories,
  evidence,
  edges,
};

// ---- non-graph fixtures (pending suggestions, GitHub) --------------------------------------
function candidate(
  projectId: string,
  payload: MyosCandidate['payload'],
  rationale: string,
): MyosCandidate {
  return {
    id: id(),
    userId: USER,
    kind: payload.kind,
    projectId,
    payload,
    evidenceIds: [repoEv.id],
    rationale,
    dedupeKey: `${projectId}:${JSON.stringify(payload)}`,
    status: 'PENDING',
    createdAt: TS,
    decidedAt: null,
  };
}

export const SAMPLE_PENDING: MyosCandidate[] = [
  candidate(
    portfolio.id,
    { kind: 'SKILL', skill: 'Tailwind CSS', category: 'FRAMEWORK' },
    'the repository package.json dependencies',
  ),
  candidate(
    portfolio.id,
    { kind: 'PROJECT_SUMMARY', text: 'Personal portfolio site built with Next.js.' },
    'the repository README',
  ),
  candidate(
    routing.id,
    { kind: 'TALKING_POINT', text: 'Designed an event-aware cache for route lookups.' },
    'pull request #42',
  ),
];

export const SAMPLE_CONNECTION: GithubConnection = {
  userId: USER,
  githubLogin: 'sample-user',
  githubUserId: null,
  hasToken: false,
  status: 'CONNECTED',
  lastError: null,
  lastSyncedAt: '2026-09-28T00:00:00.000Z',
  createdAt: TS,
  updatedAt: TS,
};

export const SAMPLE_REPOS: Pick<
  GithubRepository,
  'fullName' | 'htmlUrl' | 'projectId' | 'selected'
>[] = [
  {
    fullName: 'sample-user/transit-routing',
    htmlUrl: 'https://github.com/sample-user/transit-routing',
    projectId: routing.id,
    selected: true,
  },
  {
    fullName: 'sample-user/portfolio-site',
    htmlUrl: 'https://github.com/sample-user/portfolio-site',
    projectId: portfolio.id,
    selected: true,
  },
  {
    fullName: 'sample-user/dotfiles',
    htmlUrl: 'https://github.com/sample-user/dotfiles',
    projectId: null,
    selected: false,
  },
];

export const SAMPLE_LAST_RUN: GithubSyncRun = {
  id: id(),
  userId: USER,
  status: 'SUCCEEDED',
  stats: {},
  error: null,
  startedAt: '2026-09-28T00:00:00.000Z',
  finishedAt: '2026-09-28T00:01:00.000Z',
};

export const SAMPLE_PROJECT_ID = routing.id;
export const SAMPLE_STORY_ID = roadmapStory.id;

export const SAMPLE_JOB = {
  title: 'Associate Product Manager',
  company: 'Example Corp',
  description:
    'Work with engineering and design to ship features. Run user research and use data to prioritize.',
  requirements: [
    {
      id: 'r1',
      text: 'Experience conducting user research',
      category: 'REQUIRED' as const,
    },
    {
      id: 'r2',
      text: 'Cross-functional collaboration with engineering',
      category: 'REQUIRED' as const,
    },
    { id: 'r3', text: 'Data analysis with SQL', category: 'REQUIRED' as const },
    { id: 'r4', text: 'Python scripting', category: 'PREFERRED' as const },
    { id: 'r5', text: 'B2B SaaS experience', category: 'PREFERRED' as const },
    { id: 'r6', text: 'Kubernetes', category: 'PREFERRED' as const },
  ],
};
