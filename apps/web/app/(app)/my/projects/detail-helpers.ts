import type {
  EvidenceGraphData,
  GraphProject,
  GraphSkill,
  MyosAchievement,
  MyosEdge,
  MyosEvidence,
} from '@career-os/shared';

export interface ProjectDetailView {
  project: GraphProject;
  skills: { edge: MyosEdge; skill: GraphSkill }[];
  achievements: MyosAchievement[];
  evidence: { edge: MyosEdge; item: MyosEvidence }[];
}

/**
 * Slices the user's evidence graph down to one project. Returns null when the project is not in
 * the graph (so a foreign or unknown id renders as 404 rather than an empty page).
 */
export function projectDetailView(graph: EvidenceGraphData, projectId: string): ProjectDetailView | null {
  const project = graph.projects.find((p) => p.id === projectId);
  if (!project) return null;
  const skillById = new Map(graph.skills.map((s) => [s.id, s]));
  const evidenceById = new Map(graph.evidence.map((e) => [e.id, e]));

  const skills: ProjectDetailView['skills'] = [];
  const evidence: ProjectDetailView['evidence'] = [];
  const achievementIds = new Set<string>();
  const seenSkills = new Set<string>();
  const seenEvidence = new Set<string>();

  for (const edge of graph.edges) {
    const touchesProject =
      (edge.fromType === 'PROJECT' && edge.fromId === projectId) ||
      (edge.toType === 'PROJECT' && edge.toId === projectId);
    if (!touchesProject) continue;

    if (edge.relation === 'DEMONSTRATES' || edge.relation === 'USES') {
      const skillId = edge.fromType === 'SKILL' ? edge.fromId : edge.toType === 'SKILL' ? edge.toId : null;
      const skill = skillId ? skillById.get(skillId) : undefined;
      if (skill && !seenSkills.has(skill.id)) {
        seenSkills.add(skill.id);
        skills.push({ edge, skill });
      }
    } else if (
      (edge.relation === 'SUPPORTS' || edge.relation === 'REPRESENTS') &&
      edge.fromType === 'EVIDENCE' &&
      edge.toType === 'PROJECT'
    ) {
      const item = evidenceById.get(edge.fromId);
      if (item && !seenEvidence.has(item.id)) {
        seenEvidence.add(item.id);
        evidence.push({ edge, item });
      }
    } else if (edge.relation === 'BELONGS_TO' && edge.fromType === 'ACHIEVEMENT' && edge.toType === 'PROJECT') {
      achievementIds.add(edge.fromId);
    }
  }

  const achievements = graph.achievements.filter(
    (a) => a.projectId === projectId || achievementIds.has(a.id),
  );
  skills.sort((a, b) => a.skill.name.localeCompare(b.skill.name));
  return { project, skills, achievements, evidence };
}
