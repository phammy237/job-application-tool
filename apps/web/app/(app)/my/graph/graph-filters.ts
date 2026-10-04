import {
  VERIFICATION_RANK,
  type EdgeRelation,
  type NodeType,
  type VerificationState,
  type VizGraph,
  type VizLink,
  type VizNode,
} from '@career-os/shared';

/** Client-side, pure filtering over the serialized VizGraph. */

export interface GraphFilterOptions {
  types: ReadonlySet<NodeType>;
  relations: ReadonlySet<EdgeRelation>;
  /** null = no minimum. */
  minVerification: VerificationState | null;
  /** Neighbourhood restriction around a node (depth 0 = the node alone). */
  focus: { id: string; depth: number } | null;
  search: string;
}

export interface GraphFilterResult {
  nodeIds: Set<string>;
  linkIds: Set<string>;
  /** Visible nodes whose label/sublabel match the search (sorted by label). */
  matches: string[];
}

export function matchesSearch(node: VizNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    node.label.toLowerCase().includes(q) ||
    (node.sublabel ?? '').toLowerCase().includes(q)
  );
}

export function filterGraph(viz: VizGraph, opts: GraphFilterOptions): GraphFilterResult {
  const minRank = opts.minVerification ? VERIFICATION_RANK[opts.minVerification] : -1;
  const passing = new Map<string, VizNode>();
  for (const n of viz.nodes) {
    if (opts.types.has(n.type) && VERIFICATION_RANK[n.verificationHint] >= minRank) {
      passing.set(n.id, n);
    }
  }
  const links: VizLink[] = viz.links.filter(
    (l) =>
      opts.relations.has(l.relation) &&
      VERIFICATION_RANK[l.verificationState] >= minRank &&
      passing.has(l.source) &&
      passing.has(l.target),
  );

  let nodeIds = new Set(passing.keys());
  if (opts.focus) {
    nodeIds = neighborhood(
      links,
      opts.focus.id,
      opts.focus.depth,
      passing.has(opts.focus.id),
    );
  }
  const linkIds = new Set(
    links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target)).map((l) => l.id),
  );
  const matches = viz.nodes
    .filter((n) => nodeIds.has(n.id) && matchesSearch(n, opts.search))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .map((n) => n.id);
  return { nodeIds, linkIds, matches };
}

/** BFS over undirected links; returns an empty set when the origin is not allowed. */
export function neighborhood(
  links: readonly VizLink[],
  originId: string,
  depth: number,
  originAllowed = true,
): Set<string> {
  if (!originAllowed) return new Set();
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string): void => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  for (const l of links) {
    add(l.source, l.target);
    add(l.target, l.source);
  }
  const reach = new Set<string>([originId]);
  let frontier = [originId];
  for (let d = 0; d < Math.max(0, depth) && frontier.length; d++) {
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
  return reach;
}

export interface NodeRelation {
  link: VizLink;
  other: VizNode;
  /** OUT: the node is the link's source. */
  direction: 'OUT' | 'IN';
}

/** Every relation touching a node, with the node on the other end, in stable order. */
export function relationsOf(viz: VizGraph, nodeId: string): NodeRelation[] {
  const byId = new Map(viz.nodes.map((n) => [n.id, n]));
  const out: NodeRelation[] = [];
  for (const link of viz.links) {
    if (link.source !== nodeId && link.target !== nodeId) continue;
    const direction = link.source === nodeId ? 'OUT' : 'IN';
    const other = byId.get(direction === 'OUT' ? link.target : link.source);
    if (other) out.push({ link, other, direction });
  }
  return out.sort(
    (a, b) =>
      a.link.label.localeCompare(b.link.label) ||
      a.other.label.localeCompare(b.other.label) ||
      a.link.id.localeCompare(b.link.id),
  );
}

/** Sentence fragment for the selected node's side of a relation, e.g. "uses Python". */
export function relationPhrase(rel: NodeRelation): string {
  return rel.direction === 'OUT'
    ? `${rel.link.label} ${rel.other.label}`
    : `${rel.other.label} ${rel.link.label} this`;
}

export interface NodeGroup {
  type: NodeType;
  nodes: VizNode[];
}

/** Nodes grouped by type (in the given type order), filtered by an optional text query. */
export function groupNodes(
  nodes: readonly VizNode[],
  typeOrder: readonly NodeType[],
  query: string,
): NodeGroup[] {
  const q = query.trim().toLowerCase();
  return typeOrder
    .map((type) => ({
      type,
      nodes: nodes
        .filter(
          (n) =>
            n.type === type &&
            (!q ||
              n.label.toLowerCase().includes(q) ||
              (n.sublabel ?? '').toLowerCase().includes(q)),
        )
        .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
    }))
    .filter((g) => g.nodes.length > 0);
}

/** One-pass index of relations per node id (for lists that need every node's relations). */
export function relationIndex(viz: VizGraph): Map<string, NodeRelation[]> {
  const byId = new Map(viz.nodes.map((n) => [n.id, n]));
  const index = new Map<string, NodeRelation[]>();
  const add = (id: string, rel: NodeRelation): void => {
    const list = index.get(id);
    if (list) list.push(rel);
    else index.set(id, [rel]);
  };
  for (const link of viz.links) {
    const s = byId.get(link.source);
    const t = byId.get(link.target);
    if (!s || !t) continue;
    add(s.id, { link, other: t, direction: 'OUT' });
    if (t.id !== s.id) add(t.id, { link, other: s, direction: 'IN' });
  }
  for (const list of index.values()) {
    list.sort(
      (a, b) =>
        a.link.label.localeCompare(b.link.label) ||
        a.other.label.localeCompare(b.other.label) ||
        a.link.id.localeCompare(b.link.id),
    );
  }
  return index;
}
