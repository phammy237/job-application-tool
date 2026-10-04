'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Link from 'next/link';
import { Button, Input } from '@career-os/ui';
import {
  visibilitySchema,
  type EdgeRelation,
  type NodeType,
  type VerificationState,
  type VizGraph,
  type VizNode,
} from '@career-os/shared';
import { VerificationBadge, VisibilityBadge } from '../_components/badges';
import {
  filterGraph,
  groupNodes,
  relationIndex,
  relationPhrase,
  type NodeRelation,
} from './graph-filters';
import { layoutGraph, type Point } from './graph-layout';
import { NODE_TYPES, TYPE_STYLE, shapePath } from './graph-style';
import { nodeHref } from './node-links';

const VB_W = 1000;
const VB_H = 700;
const MIN_K = 0.15;
const MAX_K = 4;
const LABEL_MIN_K = 0.6;

const ALL_RELATIONS: readonly EdgeRelation[] = [
  'DEMONSTRATES',
  'USES',
  'BELONGS_TO',
  'SUPPORTS',
  'REPRESENTS',
  'REFERENCES',
];
const RELATION_LABEL: Record<EdgeRelation, string> = {
  DEMONSTRATES: 'demonstrates',
  USES: 'uses',
  BELONGS_TO: 'belongs to',
  SUPPORTS: 'supports',
  REPRESENTS: 'represents',
  REFERENCES: 'references',
};
const MIN_VERIFICATION_OPTIONS: { value: VerificationState | ''; label: string }[] = [
  { value: '', label: 'Any provenance' },
  { value: 'INFERRED', label: 'Inferred or better' },
  { value: 'USER_PROVIDED', label: 'Confirmed by you or better' },
  { value: 'VERIFIED', label: 'Verified only' },
];

interface Transform {
  x: number;
  y: number;
  k: number;
}

const clampK = (k: number): number => Math.min(MAX_K, Math.max(MIN_K, k));

function zoomAt(t: Transform, factor: number, cx: number, cy: number): Transform {
  const k = clampK(t.k * factor);
  const ratio = k / t.k;
  return { k, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function visibilityOf(node: VizNode) {
  const parsed = visibilitySchema.safeParse(node.meta.visibility);
  return parsed.success ? parsed.data : null;
}

function ShapeIcon({ type, size = 14 }: { type: NodeType; size?: number }) {
  const style = TYPE_STYLE[type];
  return (
    <svg
      width={size}
      height={size}
      viewBox="-8 -8 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={shapePath(style.shape, 5.5)}
        fill={style.shape === 'ring' ? 'none' : style.color}
        stroke={style.shape === 'ring' ? style.color : 'currentColor'}
        strokeWidth={style.shape === 'ring' ? 2 : 1}
      />
    </svg>
  );
}

// -------------------------------------------------------------------------------------------
// Canvas layer — memoized so panning/zooming (transform changes) never re-renders nodes.
// -------------------------------------------------------------------------------------------

interface LayerProps {
  viz: VizGraph;
  positions: Record<string, Point>;
  nodeIds: Set<string>;
  linkIds: Set<string>;
  selectedId: string | null;
  neighborIds: Set<string>;
  matchSet: Set<string>;
  showLabels: boolean;
  onSelect: (id: string) => void;
}

const GraphLayer = memo(function GraphLayer(p: LayerProps) {
  const {
    viz,
    positions,
    nodeIds,
    linkIds,
    selectedId,
    neighborIds,
    matchSet,
    showLabels,
  } = p;
  const hasSelection = selectedId !== null;
  return (
    <>
      <g strokeLinecap="round">
        {viz.links.map((l) => {
          if (!linkIds.has(l.id)) return null;
          const a = positions[l.source];
          const b = positions[l.target];
          if (!a || !b) return null;
          const touching = l.source === selectedId || l.target === selectedId;
          const unconfirmed =
            l.verificationState === 'INFERRED' || l.verificationState === 'AI_GENERATED';
          return (
            <line
              key={l.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              style={{ stroke: 'hsl(var(--muted-foreground))' }}
              strokeWidth={touching ? 2.5 : 1}
              strokeOpacity={touching ? 0.95 : hasSelection ? 0.15 : 0.45}
              strokeDasharray={unconfirmed ? '5 4' : undefined}
            />
          );
        })}
      </g>
      <g>
        {viz.links.map((l) => {
          if (!linkIds.has(l.id) || (l.source !== selectedId && l.target !== selectedId))
            return null;
          const a = positions[l.source];
          const b = positions[l.target];
          if (!a || !b) return null;
          return (
            <text
              key={`t-${l.id}`}
              x={(a.x + b.x) / 2}
              y={(a.y + b.y) / 2 - 4}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              paintOrder="stroke"
              strokeWidth={4}
              strokeLinejoin="round"
              style={{ fill: 'hsl(var(--foreground))', stroke: 'hsl(var(--background))' }}
            >
              {l.label}
            </text>
          );
        })}
      </g>
      <g>
        {viz.nodes.map((n) => {
          if (!nodeIds.has(n.id)) return null;
          const pos = positions[n.id];
          if (!pos) return null;
          const style = TYPE_STYLE[n.type];
          const selected = n.id === selectedId;
          const near = selected || neighborIds.has(n.id);
          const matched = matchSet.has(n.id);
          const dim = hasSelection && !near;
          const unconfirmed =
            n.verificationHint === 'INFERRED' || n.verificationHint === 'AI_GENERATED';
          const r = selected ? 14 : 11;
          return (
            <g
              key={n.id}
              transform={`translate(${pos.x} ${pos.y})`}
              opacity={dim ? 0.35 : 1}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                p.onSelect(n.id);
              }}
            >
              <title>{`${style.label}: ${n.label}`}</title>
              {(selected || matched) && (
                <circle
                  r={r + 6}
                  fill="none"
                  strokeWidth={matched && !selected ? 3 : 2}
                  strokeDasharray={matched && !selected ? '2 3' : undefined}
                  style={{ stroke: 'hsl(var(--ring))' }}
                />
              )}
              <path
                d={shapePath(style.shape, r)}
                fill={style.shape === 'ring' ? 'hsl(var(--background))' : style.color}
                stroke={style.shape === 'ring' ? style.color : 'hsl(var(--foreground))'}
                strokeWidth={
                  style.shape === 'ring' ? 3 : n.verificationHint === 'VERIFIED' ? 3 : 1.5
                }
                strokeDasharray={unconfirmed ? '3 2' : undefined}
              />
              {(showLabels || near || matched) && (
                <text
                  y={r + 13}
                  textAnchor="middle"
                  fontSize={11}
                  paintOrder="stroke"
                  strokeWidth={4}
                  strokeLinejoin="round"
                  style={{
                    fill: 'hsl(var(--foreground))',
                    stroke: 'hsl(var(--background))',
                  }}
                >
                  {truncate(n.label, selected ? 40 : 22)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </>
  );
});

// -------------------------------------------------------------------------------------------
// Text list (mobile primary view + accessible alternative)
// -------------------------------------------------------------------------------------------

// Memoized: pan/zoom only changes the transform, so the (potentially long) lists must not re-render.
const NodeList = memo(function NodeList({
  nodes,
  relations,
  linkIds,
  nodeIds,
  query,
  onSelect,
  selectedId,
  openAll,
}: {
  nodes: VizNode[];
  relations: Map<string, NodeRelation[]>;
  linkIds: Set<string>;
  nodeIds: Set<string>;
  query: string;
  onSelect?: (id: string) => void;
  selectedId: string | null;
  openAll: boolean;
}) {
  const groups = useMemo(() => groupNodes(nodes, NODE_TYPES, query), [nodes, query]);
  if (groups.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No nodes match the current filters.</p>
    );
  }
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <details key={g.type} open={openAll || undefined} className="rounded-md border">
          <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
            <ShapeIcon type={g.type} />
            {TYPE_STYLE[g.type].plural} ({g.nodes.length})
          </summary>
          <ul className="divide-y border-t">
            {g.nodes.map((n) => {
              const rels = (relations.get(n.id) ?? []).filter(
                (r) => linkIds.has(r.link.id) && nodeIds.has(r.other.id),
              );
              const href = nodeHref(n.type, n.id.slice(n.type.length + 1));
              const vis = visibilityOf(n);
              return (
                <li key={n.id} className="space-y-1 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    {onSelect ? (
                      <button
                        type="button"
                        onClick={() => onSelect(n.id)}
                        aria-pressed={selectedId === n.id}
                        className="focus-visible:ring-ring rounded text-left font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2"
                      >
                        {n.label}
                      </button>
                    ) : (
                      <span className="font-medium">{n.label}</span>
                    )}
                    <VerificationBadge state={n.verificationHint} />
                    {vis && <VisibilityBadge visibility={vis} />}
                    {href && (
                      <Link href={href} className="text-primary text-xs underline">
                        Open
                      </Link>
                    )}
                  </div>
                  {n.sublabel && (
                    <p className="text-muted-foreground text-xs">{n.sublabel}</p>
                  )}
                  {rels.length > 0 && (
                    <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs">
                      {rels.map((r) => (
                        <li key={r.link.id}>
                          {relationPhrase(r)}{' '}
                          <span className="sr-only">
                            ({r.link.verificationState.toLowerCase().replace('_', ' ')})
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </div>
  );
});

// -------------------------------------------------------------------------------------------
// Details panel
// -------------------------------------------------------------------------------------------

const NO_RELATIONS: NodeRelation[] = [];

const DetailsPanel = memo(function DetailsPanel({
  node,
  relations,
  hidden,
  onSelect,
  onClose,
}: {
  node: VizNode | null;
  relations: NodeRelation[];
  hidden: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  if (!node) {
    return (
      <p className="text-muted-foreground text-sm">
        Select a node to see what it is, how it is connected and where its provenance
        comes from.
      </p>
    );
  }
  const style = TYPE_STYLE[node.type];
  const href = nodeHref(node.type, node.id.slice(node.type.length + 1));
  const vis = visibilityOf(node);
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs uppercase tracking-wide">
            <ShapeIcon type={node.type} /> {style.label}
          </p>
          <h3 className="break-words text-base font-semibold">{node.label}</h3>
          {node.sublabel && (
            <p className="text-muted-foreground text-sm">{node.sublabel}</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close details"
        >
          Close
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <VerificationBadge state={node.verificationHint} />
        {vis && <VisibilityBadge visibility={vis} />}
      </div>
      {hidden && (
        <p className="text-muted-foreground text-xs">
          This node is hidden by the current filters; clear a filter to see it on the
          canvas.
        </p>
      )}
      {href && (
        <Link href={href} className="text-primary inline-block text-sm underline">
          Open {style.label.toLowerCase()} page
        </Link>
      )}
      <div>
        <h4 className="text-sm font-medium">Relations ({relations.length})</h4>
        {relations.length === 0 ? (
          <p className="text-muted-foreground text-sm">No connections yet.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {relations.map((r) => {
              const otherHref = nodeHref(
                r.other.type,
                r.other.id.slice(r.other.type.length + 1),
              );
              return (
                <li
                  key={r.link.id}
                  className="flex flex-wrap items-center gap-x-2 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(r.other.id)}
                    className="focus-visible:ring-ring rounded text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2"
                  >
                    <span className="text-muted-foreground">
                      {r.direction === 'OUT'
                        ? `${r.link.label} →`
                        : `← ${r.link.label} this`}
                    </span>{' '}
                    {r.other.label}
                  </button>
                  <span className="text-muted-foreground text-xs">
                    ({TYPE_STYLE[r.other.type].label}
                    {r.link.verificationState === 'INFERRED' ||
                    r.link.verificationState === 'AI_GENERATED'
                      ? ', unconfirmed'
                      : ''}
                    )
                  </span>
                  {otherHref && (
                    <Link href={otherHref} className="text-primary text-xs underline">
                      Open
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
});

// -------------------------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------------------------

export function GraphView({ viz }: { viz: VizGraph }) {
  const layout = useMemo(() => layoutGraph(viz.nodes, viz.links), [viz]);
  const nodeById = useMemo(() => new Map(viz.nodes.map((n) => [n.id, n])), [viz]);
  const relIndex = useMemo(() => relationIndex(viz), [viz]);
  const typeCounts = useMemo(() => {
    const c = new Map<NodeType, number>();
    for (const n of viz.nodes) c.set(n.type, (c.get(n.type) ?? 0) + 1);
    return c;
  }, [viz]);
  const presentTypes = NODE_TYPES.filter((t) => typeCounts.has(t));

  const fit = useMemo<Transform>(() => {
    const k = Math.min(1.4, Math.max(MIN_K, (VB_H / 2 - 30) / (layout.maxRadius + 40)));
    return { x: VB_W / 2, y: VB_H / 2, k };
  }, [layout.maxRadius]);

  const [t, setT] = useState<Transform>(fit);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [types, setTypes] = useState<Set<NodeType>>(() => new Set(NODE_TYPES));
  const [relations, setRelations] = useState<Set<EdgeRelation>>(
    () => new Set(ALL_RELATIONS),
  );
  const [minVerification, setMinVerification] = useState<VerificationState | null>(null);
  const [focusDepth, setFocusDepth] = useState<0 | 1 | 2>(0);
  const [search, setSearch] = useState('');

  const focus =
    focusDepth > 0 && selectedId ? { id: selectedId, depth: focusDepth } : null;
  const visible = useMemo(
    () => filterGraph(viz, { types, relations, minVerification, focus, search }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `focus` is derived from the two deps below
    [viz, types, relations, minVerification, focusDepth, selectedId, search],
  );
  const matchSet = useMemo(() => new Set(visible.matches), [visible.matches]);

  const neighborIds = useMemo(() => {
    const s = new Set<string>();
    if (!selectedId) return s;
    for (const r of relIndex.get(selectedId) ?? []) s.add(r.other.id);
    return s;
  }, [relIndex, selectedId]);

  const visibleNodes = useMemo(
    () => viz.nodes.filter((n) => visible.nodeIds.has(n.id)),
    [viz, visible],
  );
  const selectedNode = selectedId ? (nodeById.get(selectedId) ?? null) : null;
  const orderedIds = useMemo(
    () =>
      [...visibleNodes]
        .sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label))
        .map((n) => n.id),
    [visibleNodes],
  );

  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: 0, pinchDist: 0, dragged: false });

  const toViewBox = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: VB_W / 2, y: VB_H / 2, f: 1 };
    const f = VB_W / rect.width;
    return { x: (clientX - rect.left) * f, y: (clientY - rect.top) * f, f };
  }, []);

  // Wheel needs a non-passive native listener so the page does not scroll while zooming.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const { x, y } = toViewBox(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0015);
      setT((prev) => zoomAt(prev, factor, x, y));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [toViewBox]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current.moved = 0;
    gesture.current.dragged = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    }
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (gesture.current.pinchDist > 0 && dist > 0) {
        const mid = toViewBox((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
        const factor = dist / gesture.current.pinchDist;
        setT((p) => zoomAt(p, factor, mid.x, mid.y));
      }
      gesture.current.pinchDist = dist;
      gesture.current.dragged = true;
      return;
    }
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    gesture.current.moved += Math.abs(dx) + Math.abs(dy);
    if (gesture.current.moved < 5 && !gesture.current.dragged) return;
    if (!gesture.current.dragged) {
      gesture.current.dragged = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    }
    const { f } = toViewBox(0, 0);
    setT((p) => ({ ...p, x: p.x + dx * f, y: p.y + dy * f }));
  };
  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>): void => {
    pointers.current.delete(e.pointerId);
    gesture.current.pinchDist = 0;
  };

  const zoomBy = useCallback(
    (factor: number) => setT((p) => zoomAt(p, factor, VB_W / 2, VB_H / 2)),
    [],
  );

  const centerOn = useCallback(
    (id: string) => {
      const pos = layout.positions[id];
      if (!pos) return;
      setT((p) => {
        const k = Math.max(p.k, 1);
        return { k, x: VB_W / 2 - pos.x * k, y: VB_H / 2 - pos.y * k };
      });
    },
    [layout.positions],
  );

  const select = useCallback((id: string) => setSelectedId(id), []);
  const deselect = useCallback(() => setSelectedId(null), []);
  const selectAndCenter = useCallback(
    (id: string) => {
      setSelectedId(id);
      centerOn(id);
    },
    [centerOn],
  );

  const stepSelection = (dir: 1 | -1): void => {
    if (orderedIds.length === 0) return;
    const i = selectedId ? orderedIds.indexOf(selectedId) : -1;
    const next = orderedIds[(i + dir + orderedIds.length) % orderedIds.length]!;
    selectAndCenter(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = 40;
    switch (e.key) {
      case '+':
      case '=':
        zoomBy(1.25);
        break;
      case '-':
      case '_':
        zoomBy(0.8);
        break;
      case '0':
        setT(fit);
        break;
      case 'ArrowLeft':
        setT((p) => ({ ...p, x: p.x + step }));
        break;
      case 'ArrowRight':
        setT((p) => ({ ...p, x: p.x - step }));
        break;
      case 'ArrowUp':
        setT((p) => ({ ...p, y: p.y + step }));
        break;
      case 'ArrowDown':
        setT((p) => ({ ...p, y: p.y - step }));
        break;
      case ']':
        stepSelection(1);
        break;
      case '[':
        stepSelection(-1);
        break;
      case 'Escape':
        setSelectedId(null);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const toggle = <T,>(set: Set<T>, value: T, setter: (s: Set<T>) => void): void => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = visible.matches[0];
      if (first) selectAndCenter(first);
    }
  };

  const filtersActive =
    types.size !== NODE_TYPES.length ||
    relations.size !== ALL_RELATIONS.length ||
    minVerification !== null ||
    focusDepth !== 0;
  const resetFilters = (): void => {
    setTypes(new Set(NODE_TYPES));
    setRelations(new Set(ALL_RELATIONS));
    setMinVerification(null);
    setFocusDepth(0);
  };

  const selectedRelations = selectedId
    ? (relIndex.get(selectedId) ?? NO_RELATIONS)
    : NO_RELATIONS;
  const statusText = `${visible.nodeIds.size} of ${viz.nodes.length} nodes and ${visible.linkIds.size} of ${viz.links.length} relations shown${
    search.trim() ? `; ${visible.matches.length} match “${search.trim()}”` : ''
  }.`;

  return (
    <div className="space-y-4">
      {viz.truncated && (
        <p
          role="note"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
        >
          Showing the {viz.nodes.length} most-connected of {viz.totalNodes} nodes to keep
          the graph readable. Use search or filters on a smaller part of your evidence to
          see the rest.
        </p>
      )}

      <section aria-label="Graph filters" className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="graph-search" className="text-sm font-medium">
              Search nodes
            </label>
            <Input
              id="graph-search"
              type="search"
              value={search}
              placeholder="e.g. Python, Career OS"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
            />
          </div>
          <div>
            <label htmlFor="graph-min-verification" className="text-sm font-medium">
              Minimum provenance
            </label>
            <select
              id="graph-min-verification"
              value={minVerification ?? ''}
              onChange={(e) =>
                setMinVerification((e.target.value || null) as VerificationState | null)
              }
              className="border-input bg-background focus-visible:ring-ring block h-10 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
            >
              {MIN_VERIFICATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="graph-focus" className="text-sm font-medium">
              Focus mode
            </label>
            <select
              id="graph-focus"
              value={focusDepth}
              disabled={!selectedId}
              onChange={(e) => setFocusDepth(Number(e.target.value) as 0 | 1 | 2)}
              className="border-input bg-background focus-visible:ring-ring block h-10 w-full rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
            >
              <option value={0}>Whole graph</option>
              <option value={1}>Neighborhood, depth 1</option>
              <option value={2}>Neighborhood, depth 2</option>
            </select>
            {!selectedId && (
              <p className="text-muted-foreground mt-1 text-xs">Select a node first.</p>
            )}
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Node types</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {presentTypes.map((type) => {
              const on = types.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(types, type, setTypes)}
                  className={`focus-visible:ring-ring inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 ${
                    on
                      ? 'bg-accent text-accent-foreground border-primary font-medium'
                      : 'text-muted-foreground'
                  }`}
                >
                  <ShapeIcon type={type} />
                  {TYPE_STYLE[type].plural} ({typeCounts.get(type)})
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">Relations</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {ALL_RELATIONS.map((rel) => {
              const on = relations.has(rel);
              return (
                <button
                  key={rel}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(relations, rel, setRelations)}
                  className={`focus-visible:ring-ring min-h-[36px] rounded-full border px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 ${
                    on
                      ? 'bg-accent text-accent-foreground border-primary font-medium'
                      : 'text-muted-foreground'
                  }`}
                >
                  {RELATION_LABEL[rel]}
                </button>
              );
            })}
            {filtersActive && (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                Reset filters
              </Button>
            )}
          </div>
        </fieldset>
        <p className="text-muted-foreground text-xs" role="status" aria-live="polite">
          {statusText}
        </p>
      </section>

      {/* Desktop canvas */}
      <div className="hidden gap-4 md:grid md:grid-cols-[minmax(0,1fr)_18rem] lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Evidence graph canvas" className="min-w-0">
          <div
            tabIndex={0}
            role="group"
            aria-label="Evidence graph canvas. Press plus or minus to zoom, arrow keys to pan, zero to reset, left and right square brackets to step through nodes, Escape to deselect. A text list of every node follows the canvas."
            onKeyDown={onKeyDown}
            className="bg-card focus-visible:ring-ring relative overflow-hidden rounded-lg border focus-visible:outline-none focus-visible:ring-2"
            style={{ aspectRatio: `${VB_W} / ${VB_H}` }}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              className="h-full w-full select-none"
              style={{ touchAction: 'none', cursor: 'grab' }}
              aria-hidden="true"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onClick={() => {
                if (!gesture.current.dragged) setSelectedId(null);
              }}
            >
              {/* No animated transitions are used anywhere, so reduced-motion preferences are respected. */}
              <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
                <GraphLayer
                  viz={viz}
                  positions={layout.positions}
                  nodeIds={visible.nodeIds}
                  linkIds={visible.linkIds}
                  selectedId={selectedId}
                  neighborIds={neighborIds}
                  matchSet={matchSet}
                  showLabels={t.k >= LABEL_MIN_K}
                  onSelect={select}
                />
              </g>
            </svg>
            <div className="absolute right-2 top-2 flex flex-col gap-1">
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => zoomBy(1.25)}
                aria-label="Zoom in"
              >
                +
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => zoomBy(0.8)}
                aria-label="Zoom out"
              >
                −
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={() => setT(fit)}
                aria-label="Reset view"
              >
                ⤢
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={!selectedId}
                onClick={() => selectedId && centerOn(selectedId)}
                aria-label="Center on selected node"
              >
                ◎
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            Drag to pan, scroll or pinch to zoom. Shapes show type; a dashed outline means
            not yet confirmed by you; a thick outline means verified. Relation labels
            appear for the selected node.
          </p>
        </section>

        <aside
          aria-label="Node details"
          aria-live="polite"
          className="bg-card rounded-lg border p-4"
        >
          <DetailsPanel
            node={selectedNode}
            relations={selectedRelations}
            hidden={!!selectedNode && !visible.nodeIds.has(selectedNode.id)}
            onSelect={selectAndCenter}
            onClose={deselect}
          />
        </aside>
      </div>

      {/* Mobile fallback: grouped, searchable list */}
      <section aria-label="Nodes and relations" className="space-y-2 md:hidden">
        <p className="text-muted-foreground rounded-md border p-3 text-sm">
          The interactive graph canvas needs a larger screen. Here is the same evidence as
          a searchable list; use the search box above to narrow it.
        </p>
        <NodeList
          nodes={visibleNodes}
          relations={relIndex}
          linkIds={visible.linkIds}
          nodeIds={visible.nodeIds}
          query={search}
          selectedId={selectedId}
          openAll={false}
        />
      </section>

      {/* Desktop screen-reader / keyboard alternative */}
      <section aria-label="Text alternative to the graph" className="hidden md:block">
        <details className="rounded-lg border">
          <summary className="min-h-[44px] cursor-pointer px-4 py-3 text-sm font-medium">
            Text view: every node with its relations
          </summary>
          <div className="p-3">
            <NodeList
              nodes={visibleNodes}
              relations={relIndex}
              linkIds={visible.linkIds}
              nodeIds={visible.nodeIds}
              query={search}
              onSelect={selectAndCenter}
              selectedId={selectedId}
              openAll={false}
            />
          </div>
        </details>
      </section>
    </div>
  );
}
