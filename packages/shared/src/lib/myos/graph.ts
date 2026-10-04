import type {
  EdgeRelation,
  MyosEdge,
  NodeType,
  VerificationState,
} from '../../schemas/myos';
import type { EvidenceGraphData } from './graph-types';

/**
 * Evidence-graph indexing and visualization helpers. Pure: no I/O, no clock, no randomness.
 * Edges are treated as UNDIRECTED for traversal (neighbors, BFS, shortest path) but keep their
 * stored direction for sentences ("A demonstrates B").
 *
 * Node ids are `${TYPE}:${uuid}`. Edges whose endpoints are not present in the loaded graph are
 * silently dropped from the index (dangling references never reach the UI).
 *
 * verificationHint per node:
 *  - ACHIEVEMENT / STORY / EVIDENCE: the row's own verificationState.
 *  - PROJECT / EXPERIENCE / EDUCATION / SKILL: VERIFIED when at least one linked EVIDENCE node is
 *    VERIFIED through a user-confirmed (VERIFIED or USER_PROVIDED) SUPPORTS link; otherwise
 *    USER_PROVIDED when the user approved the row, else INFERRED.
 */

export const VERIFICATION_RANK: Record<VerificationState, number> = {
  AI_GENERATED: 0,
  INFERRED: 1,
  USER_PROVIDED: 2,
  VERIFIED: 3,
};

export function nodeKey(type: NodeType, id: string): string {
  return `${type}:${id}`;
}

function evidenceSearchText(ev: {
  title: string;
  excerpt: string | null;
  metadata: Record<string, unknown>;
}): string {
  const parts: string[] = [ev.title, ev.excerpt ?? ''];
  for (const v of Object.values(ev.metadata ?? {})) {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v))
      for (const x of v) if (typeof x === 'string') parts.push(x);
  }
  return parts.join('\n');
}

export type NodeMetaValue = string | number | boolean | null;

export interface IndexedNode {
  key: string;
  type: NodeType;
  id: string;
  label: string;
  sublabel: string | null;
  verificationHint: VerificationState;
  meta: Record<string, NodeMetaValue>;
  /** Evidence only: title + excerpt + string metadata values, for skill-specific text matching. Never sent to clients. */
  searchText?: string;
}

export interface IndexedEdge {
  edge: MyosEdge;
  fromKey: string;
  toKey: string;
}

export interface GraphIndex {
  nodes: Map<string, IndexedNode>;
  /** Only edges whose both endpoints exist. */
  edges: IndexedEdge[];
  /** Every edge appears under both of its endpoints. */
  adjacency: Map<string, IndexedEdge[]>;
}

export type GraphLike = EvidenceGraphData | GraphIndex;

export function isUserConfirmed(state: VerificationState): boolean {
  return state === 'VERIFIED' || state === 'USER_PROVIDED';
}

export function otherEnd(ie: IndexedEdge, key: string): string {
  return ie.fromKey === key ? ie.toKey : ie.fromKey;
}

function joinNonEmpty(
  parts: Array<string | null | undefined>,
  sep: string,
): string | null {
  const out = parts.filter((p): p is string => !!p && p.trim().length > 0);
  return out.length ? out.join(sep) : null;
}

export function buildGraphIndex(graph: EvidenceGraphData): GraphIndex {
  const nodes = new Map<string, IndexedNode>();
  const approvedHint = (approved: boolean): VerificationState =>
    approved ? 'USER_PROVIDED' : 'INFERRED';

  for (const p of graph.projects) {
    const key = nodeKey('PROJECT', p.id);
    nodes.set(key, {
      key,
      type: 'PROJECT',
      id: p.id,
      label: p.name,
      sublabel: joinNonEmpty([p.role, p.status], ' · '),
      verificationHint: approvedHint(p.userApproved),
      meta: {
        status: p.status,
        origin: p.origin,
        userApproved: p.userApproved,
        visibility: p.visibility,
        startDate: p.startDate,
        endDate: p.endDate,
      },
    });
  }
  for (const s of graph.skills) {
    const key = nodeKey('SKILL', s.id);
    nodes.set(key, {
      key,
      type: 'SKILL',
      id: s.id,
      label: s.name,
      sublabel: s.category,
      verificationHint: approvedHint(s.userApproved),
      meta: { category: s.category, visibility: s.visibility },
    });
  }
  for (const e of graph.experiences) {
    const key = nodeKey('EXPERIENCE', e.id);
    nodes.set(key, {
      key,
      type: 'EXPERIENCE',
      id: e.id,
      label: e.title,
      sublabel: e.company,
      verificationHint: approvedHint(e.userApproved),
      meta: {
        company: e.company,
        userApproved: e.userApproved,
        visibility: e.visibility,
        startDate: e.startDate,
        endDate: e.endDate,
      },
    });
  }
  for (const e of graph.education) {
    const key = nodeKey('EDUCATION', e.id);
    nodes.set(key, {
      key,
      type: 'EDUCATION',
      id: e.id,
      label: e.school,
      sublabel: joinNonEmpty([e.degree, e.fieldOfStudy], ', '),
      verificationHint: approvedHint(e.userApproved),
      meta: { startDate: e.startDate, graduationDate: e.graduationDate },
    });
  }
  for (const a of graph.achievements) {
    const key = nodeKey('ACHIEVEMENT', a.id);
    nodes.set(key, {
      key,
      type: 'ACHIEVEMENT',
      id: a.id,
      label: a.title,
      sublabel: a.kind,
      verificationHint: a.verificationState,
      meta: {
        kind: a.kind,
        visibility: a.visibility,
        occurredOn: a.occurredOn,
        userApproved: a.userApproved,
      },
    });
  }
  for (const s of graph.stories) {
    const key = nodeKey('STORY', s.id);
    nodes.set(key, {
      key,
      type: 'STORY',
      id: s.id,
      label: s.title,
      sublabel: s.competencies.length ? s.competencies.join(', ') : null,
      verificationHint: s.verificationState,
      meta: { visibility: s.visibility, userApproved: s.userApproved },
    });
  }
  const evidenceStates = new Map<string, VerificationState>();
  for (const ev of graph.evidence) {
    const key = nodeKey('EVIDENCE', ev.id);
    evidenceStates.set(key, ev.verificationState);
    nodes.set(key, {
      key,
      type: 'EVIDENCE',
      id: ev.id,
      label: ev.title,
      sublabel: ev.sourceType,
      verificationHint: ev.verificationState,
      searchText: evidenceSearchText(ev),
      meta: {
        sourceType: ev.sourceType,
        visibility: ev.visibility,
        occurredAt: ev.occurredAt,
      },
    });
  }

  const edges: IndexedEdge[] = [];
  const adjacency = new Map<string, IndexedEdge[]>();
  for (const key of nodes.keys()) adjacency.set(key, []);
  for (const edge of graph.edges) {
    const fromKey = nodeKey(edge.fromType, edge.fromId);
    const toKey = nodeKey(edge.toType, edge.toId);
    if (!nodes.has(fromKey) || !nodes.has(toKey)) continue;
    const ie: IndexedEdge = { edge, fromKey, toKey };
    edges.push(ie);
    adjacency.get(fromKey)!.push(ie);
    if (toKey !== fromKey) adjacency.get(toKey)!.push(ie);
  }

  // Upgrade entity hints to VERIFIED when user-confirmed links reach VERIFIED evidence.
  for (const node of nodes.values()) {
    if (node.type === 'ACHIEVEMENT' || node.type === 'STORY' || node.type === 'EVIDENCE')
      continue;
    for (const ie of adjacency.get(node.key) ?? []) {
      if (ie.edge.relation !== 'SUPPORTS' || !isUserConfirmed(ie.edge.verificationState))
        continue;
      if (evidenceStates.get(otherEnd(ie, node.key)) === 'VERIFIED') {
        node.verificationHint = 'VERIFIED';
        break;
      }
    }
  }

  return { nodes, edges, adjacency };
}

export function asIndex(graph: GraphLike): GraphIndex {
  return 'adjacency' in graph ? graph : buildGraphIndex(graph);
}

// --------------------------------------------------------------------------------------------
// Neighbors / paths / sentences
// --------------------------------------------------------------------------------------------

export interface Neighbor {
  node: IndexedNode;
  edge: MyosEdge;
  /** OUT: the focus node is the edge's source. */
  direction: 'OUT' | 'IN';
}

export function neighborsOf(graph: GraphLike, key: string): Neighbor[] {
  const index = asIndex(graph);
  const out: Neighbor[] = [];
  for (const ie of index.adjacency.get(key) ?? []) {
    const node = index.nodes.get(otherEnd(ie, key));
    if (!node) continue;
    out.push({ node, edge: ie.edge, direction: ie.fromKey === key ? 'OUT' : 'IN' });
  }
  return out.sort(
    (a, b) => a.node.key.localeCompare(b.node.key) || a.edge.id.localeCompare(b.edge.id),
  );
}

export interface PathFilter {
  relations?: readonly EdgeRelation[];
  minVerification?: VerificationState;
}

function edgePasses(edge: MyosEdge, f: PathFilter | undefined): boolean {
  if (!f) return true;
  if (f.relations && !f.relations.includes(edge.relation)) return false;
  if (
    f.minVerification &&
    VERIFICATION_RANK[edge.verificationState] < VERIFICATION_RANK[f.minVerification]
  ) {
    return false;
  }
  return true;
}

export interface GraphPath {
  nodeKeys: string[];
  edgeIds: string[];
}

/** Shortest (fewest hops) undirected path; null when either node is missing or unreachable. */
export function shortestPath(
  graph: GraphLike,
  fromKey: string,
  toKey: string,
  filter?: PathFilter,
): GraphPath | null {
  const index = asIndex(graph);
  if (!index.nodes.has(fromKey) || !index.nodes.has(toKey)) return null;
  if (fromKey === toKey) return { nodeKeys: [fromKey], edgeIds: [] };
  const prev = new Map<string, { key: string; edgeId: string }>();
  const seen = new Set<string>([fromKey]);
  let frontier = [fromKey];
  while (frontier.length) {
    const next: string[] = [];
    for (const cur of frontier) {
      const adj = [...(index.adjacency.get(cur) ?? [])].sort(
        (a, b) =>
          otherEnd(a, cur).localeCompare(otherEnd(b, cur)) ||
          a.edge.id.localeCompare(b.edge.id),
      );
      for (const ie of adj) {
        if (!edgePasses(ie.edge, filter)) continue;
        const o = otherEnd(ie, cur);
        if (seen.has(o)) continue;
        seen.add(o);
        prev.set(o, { key: cur, edgeId: ie.edge.id });
        if (o === toKey) {
          const nodeKeys = [toKey];
          const edgeIds: string[] = [];
          let c = toKey;
          while (c !== fromKey) {
            const p = prev.get(c)!;
            edgeIds.unshift(p.edgeId);
            nodeKeys.unshift(p.key);
            c = p.key;
          }
          return { nodeKeys, edgeIds };
        }
        next.push(o);
      }
    }
    frontier = next;
  }
  return null;
}

const RELATION_VERB: Record<EdgeRelation, string> = {
  DEMONSTRATES: 'demonstrates',
  USES: 'uses',
  BELONGS_TO: 'belongs to',
  SUPPORTS: 'supports',
  REPRESENTS: 'represents',
  REFERENCES: 'references',
};

const VERIFICATION_PHRASE: Record<VerificationState, string> = {
  VERIFIED: 'verified',
  USER_PROVIDED: 'confirmed by you',
  INFERRED: 'inferred, not yet confirmed',
  AI_GENERATED: 'AI-suggested, not yet confirmed',
};

export interface ExplainableLink {
  relation: EdgeRelation;
  verificationState: VerificationState;
  sourceLabel: string;
  targetLabel: string;
}

/** Human sentence for one link, e.g. `"Career OS" demonstrates "Backend Development" (verified).` */
export function explainRelation(link: ExplainableLink): string {
  return `"${link.sourceLabel}" ${RELATION_VERB[link.relation]} "${link.targetLabel}" (${VERIFICATION_PHRASE[link.verificationState]}).`;
}

// --------------------------------------------------------------------------------------------
// Visualization graph
// --------------------------------------------------------------------------------------------

export interface VizNode {
  id: string;
  type: NodeType;
  label: string;
  sublabel?: string;
  verificationHint: VerificationState;
  meta: Record<string, NodeMetaValue>;
}

export interface VizLink extends ExplainableLink {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface BuildEvidenceGraphOptions {
  nodeTypes?: readonly NodeType[];
  relations?: readonly EdgeRelation[];
  /** Links below this verification rank are hidden. */
  minVerification?: VerificationState;
  /**
   * Case-insensitive substring over label/sublabel. Keeps matching nodes plus their direct
   * neighbors (for context).
   */
  search?: string;
  /** Restrict to the BFS neighborhood of `focus.nodeKey` (depth 0 = the node alone). */
  focus?: { nodeKey: string; depth: number };
  /** Default 200. Excess nodes are dropped lowest-degree first (ties by key); focus always kept. */
  maxNodes?: number;
}

export interface VizGraph {
  nodes: VizNode[];
  links: VizLink[];
  truncated: boolean;
  totalNodes: number;
  totalLinks: number;
}

export const DEFAULT_MAX_NODES = 200;

// Date helpers shared by skill-strength and timeline.

/** Parses "YYYY", "YYYY-MM", "YYYY-MM-DD" or a full ISO datetime (UTC). Null when unparseable. */
export function parseLooseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 1;
  const d = m[3] ? Number(m[3]) : 1;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole calendar months from `from` to `to`, never negative. */
export function monthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  const adjusted = to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
  return Math.max(0, adjusted);
}

export function buildEvidenceGraph(
  graph: GraphLike,
  opts: BuildEvidenceGraphOptions = {},
): VizGraph {
  const index = asIndex(graph);
  const edges = index.edges.filter((ie) => edgePasses(ie.edge, opts));
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    let list = adj.get(a);
    if (!list) adj.set(a, (list = []));
    list.push(b);
  };
  for (const ie of edges) {
    link(ie.fromKey, ie.toKey);
    link(ie.toKey, ie.fromKey);
  }

  let candidates = new Set(index.nodes.keys());

  if (opts.focus) {
    if (!index.nodes.has(opts.focus.nodeKey)) {
      return { nodes: [], links: [], truncated: false, totalNodes: 0, totalLinks: 0 };
    }
    const reach = new Set<string>([opts.focus.nodeKey]);
    let frontier = [opts.focus.nodeKey];
    for (let d = 0; d < Math.max(0, opts.focus.depth) && frontier.length; d++) {
      const next: string[] = [];
      for (const k of frontier) {
        for (const o of adj.get(k) ?? []) {
          if (!reach.has(o)) {
            reach.add(o);
            next.push(o);
          }
        }
      }
      frontier = next;
    }
    candidates = reach;
  }

  const q = opts.search?.trim().toLowerCase();
  if (q) {
    const matched = new Set<string>();
    for (const k of candidates) {
      const n = index.nodes.get(k)!;
      if (
        n.label.toLowerCase().includes(q) ||
        (n.sublabel ?? '').toLowerCase().includes(q)
      ) {
        matched.add(k);
      }
    }
    const keep = new Set(matched);
    for (const k of matched)
      for (const o of adj.get(k) ?? []) if (candidates.has(o)) keep.add(o);
    candidates = keep;
  }

  if (opts.nodeTypes) {
    const allowed = new Set<NodeType>(opts.nodeTypes);
    candidates = new Set(
      [...candidates].filter((k) => allowed.has(index.nodes.get(k)!.type)),
    );
  }

  const inScope = edges.filter(
    (ie) => candidates.has(ie.fromKey) && candidates.has(ie.toKey),
  );
  const totalNodes = candidates.size;
  const totalLinks = inScope.length;

  let kept = candidates;
  let truncated = false;
  const max = opts.maxNodes ?? DEFAULT_MAX_NODES;
  if (candidates.size > max) {
    const degree = new Map<string, number>();
    for (const ie of inScope) {
      degree.set(ie.fromKey, (degree.get(ie.fromKey) ?? 0) + 1);
      degree.set(ie.toKey, (degree.get(ie.toKey) ?? 0) + 1);
    }
    const focusKey = opts.focus?.nodeKey;
    const ranked = [...candidates].sort((a, b) => {
      if (a === focusKey) return -1;
      if (b === focusKey) return 1;
      return (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b);
    });
    kept = new Set(ranked.slice(0, Math.max(0, max)));
    truncated = true;
  }

  const nodes: VizNode[] = [...kept]
    .sort((a, b) => a.localeCompare(b))
    .map((k) => {
      const n = index.nodes.get(k)!;
      const v: VizNode = {
        id: n.key,
        type: n.type,
        label: n.label,
        verificationHint: n.verificationHint,
        meta: n.meta,
      };
      if (n.sublabel) v.sublabel = n.sublabel;
      return v;
    });

  const links: VizLink[] = inScope
    .filter((ie) => kept.has(ie.fromKey) && kept.has(ie.toKey))
    .map((ie) => ({
      id: ie.edge.id,
      source: ie.fromKey,
      target: ie.toKey,
      relation: ie.edge.relation,
      verificationState: ie.edge.verificationState,
      label: RELATION_VERB[ie.edge.relation],
      sourceLabel: index.nodes.get(ie.fromKey)!.label,
      targetLabel: index.nodes.get(ie.toKey)!.label,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return { nodes, links, truncated, totalNodes, totalLinks };
}
