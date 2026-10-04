import type { EvidenceGraphData, GraphProject } from '@career-os/shared';

export interface ProjectRow {
  id: string;
  name: string;
  role: string | null;
  status: GraphProject['status'];
  origin: GraphProject['origin'];
  visibility: GraphProject['visibility'];
  userApproved: boolean;
  skillCount: number;
  evidenceCount: number;
}

/** Per-project counts derived from the edge list (skills: DEMONSTRATES/USES; evidence: any EVIDENCE→PROJECT). */
export function summarizeProjects(graph: EvidenceGraphData): ProjectRow[] {
  const skillIds = new Set(graph.skills.map((s) => s.id));
  const evidenceIds = new Set(graph.evidence.map((e) => e.id));
  const skills = new Map<string, Set<string>>();
  const evidence = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, key: string, value: string) => {
    const set = m.get(key) ?? new Set<string>();
    set.add(value);
    m.set(key, set);
  };
  for (const e of graph.edges) {
    if (e.fromType === 'PROJECT' && e.toType === 'SKILL' && skillIds.has(e.toId)) {
      if (e.relation === 'DEMONSTRATES' || e.relation === 'USES') add(skills, e.fromId, e.toId);
    } else if (e.fromType === 'SKILL' && e.toType === 'PROJECT' && skillIds.has(e.fromId)) {
      if (e.relation === 'DEMONSTRATES' || e.relation === 'USES') add(skills, e.toId, e.fromId);
    } else if (e.fromType === 'EVIDENCE' && e.toType === 'PROJECT' && evidenceIds.has(e.fromId)) {
      add(evidence, e.toId, e.fromId);
    }
  }
  return graph.projects.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    status: p.status,
    origin: p.origin,
    visibility: p.visibility,
    userApproved: p.userApproved,
    skillCount: skills.get(p.id)?.size ?? 0,
    evidenceCount: evidence.get(p.id)?.size ?? 0,
  }));
}

export function filterProjects(
  rows: ProjectRow[],
  { q, status }: { q?: string; status?: string },
): ProjectRow[] {
  const needle = (q ?? '').trim().toLowerCase();
  return rows.filter((r) => {
    if (status && r.status !== status) return false;
    if (needle && !`${r.name} ${r.role ?? ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}
