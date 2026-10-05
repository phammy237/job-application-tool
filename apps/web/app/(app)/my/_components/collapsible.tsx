'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Accessible disclosure used across myOS. The toggle is a real <button> (keyboard operable via
 * Enter/Space) inside an optional heading, with aria-expanded + aria-controls. Collapsed content
 * stays in the DOM (`hidden`) so server-rendered children, forms and anchors keep working.
 *
 * `storageKey` remembers the open state per viewer in localStorage. Storage can be missing or
 * throw (private mode, blocked site data); every access is wrapped so the component still works.
 */

const STORAGE_PREFIX = 'myos:open:';

export function readStoredOpen(key: string): boolean | null {
  try {
    const v = window.localStorage.getItem(STORAGE_PREFIX + key);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

export function writeStoredOpen(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, open ? '1' : '0');
  } catch {
    // Storage unavailable: the open state simply is not remembered.
  }
}

// ---- Group: "Expand all / Collapse all" -----------------------------------------------------

interface GroupSignal {
  open: boolean;
  /** Increments on every request so repeating the same command still applies. */
  seq: number;
}

interface GroupContextValue {
  signal: GroupSignal | null;
  setAll: (open: boolean) => void;
}

const GroupContext = createContext<GroupContextValue | null>(null);

/** Wrap a list of Collapsibles so <CollapsibleGroupControls /> can open or close them all. */
export function CollapsibleGroup({ children }: { children: ReactNode }) {
  const [signal, setSignal] = useState<GroupSignal | null>(null);
  const setAll = useCallback(
    (open: boolean) => setSignal((s) => ({ open, seq: (s?.seq ?? 0) + 1 })),
    [],
  );
  return (
    <GroupContext.Provider value={{ signal, setAll }}>{children}</GroupContext.Provider>
  );
}

const controlCls =
  'text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex min-h-10 items-center rounded-md px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2';

/** "Expand all" / "Collapse all" buttons for the nearest CollapsibleGroup. */
export function CollapsibleGroupControls({
  label,
  className,
}: {
  /** What is being expanded, for screen readers, e.g. "skills". */
  label?: string;
  className?: string;
}) {
  const ctx = useContext(GroupContext);
  if (!ctx) return null;
  const suffix = label ? <span className="sr-only"> {label}</span> : null;
  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      <button type="button" className={controlCls} onClick={() => ctx.setAll(true)}>
        Expand all{suffix}
      </button>
      <span aria-hidden="true" className="text-border">
        |
      </span>
      <button type="button" className={controlCls} onClick={() => ctx.setAll(false)}>
        Collapse all{suffix}
      </button>
    </div>
  );
}

// ---- Collapsible ----------------------------------------------------------------------------

type Variant = 'card' | 'row' | 'plain';
type HeadingLevel = 2 | 3 | 4 | null;

export interface CollapsibleProps {
  title: ReactNode;
  children: ReactNode;
  /** Small summary under the title (visible when collapsed too). */
  summary?: ReactNode;
  /** Item count shown as a pill next to the title. */
  count?: number;
  /** Extra header content (badges, links, buttons) rendered OUTSIDE the toggle button. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  /** Persist open/closed per viewer under this key (localStorage, failure-tolerant). */
  storageKey?: string;
  /** Wrap the toggle in this heading level; null renders no heading. */
  headingLevel?: HeadingLevel;
  variant?: Variant;
  /** DOM id for the outer element (e.g. anchor targets like #suggestions). */
  id?: string;
  className?: string;
  /** Extra classes for the content area. */
  contentClassName?: string;
  /** Accessible name for the toggle when `title` is not plain text. */
  toggleLabel?: string;
}

const OUTER: Record<Variant, string> = {
  card: 'border-border bg-card rounded-lg border',
  row: 'border-border bg-card rounded-md border',
  plain: '',
};
const HEADER: Record<Variant, string> = {
  card: 'px-4 py-1.5',
  row: 'px-3 py-1',
  plain: 'py-0.5',
};
const CONTENT: Record<Variant, string> = {
  card: 'border-border border-t px-4 py-4',
  row: 'border-border border-t px-3 py-3',
  plain: 'pt-2',
};
const TITLE: Record<Variant, string> = {
  card: 'text-sm font-semibold',
  row: 'text-sm font-medium',
  plain: 'text-sm font-medium',
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${
        open ? 'rotate-90' : ''
      }`}
    >
      <path d="M7.5 5l5 5-5 5" />
    </svg>
  );
}

export function CountPill({ count }: { count: number }) {
  return (
    <span className="bg-secondary text-secondary-foreground inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums">
      {count}
    </span>
  );
}

export function Collapsible({
  title,
  children,
  summary,
  count,
  meta,
  defaultOpen = false,
  storageKey,
  headingLevel = 3,
  variant = 'card',
  id,
  className,
  contentClassName,
  toggleLabel,
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const reactId = useId();
  const contentId = `${reactId}-content`;
  const group = useContext(GroupContext);
  const lastSeq = useRef(group?.signal?.seq ?? 0);

  // Restore the remembered state after mount (never during render: avoids hydration mismatch).
  useEffect(() => {
    if (!storageKey) return;
    const stored = readStoredOpen(storageKey);
    if (stored !== null) setOpen(stored);
  }, [storageKey]);

  // Open a collapsed section when the URL hash targets it or something inside it.
  useEffect(() => {
    if (!id) return;
    const check = () => {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const el = document.getElementById(id);
      const target = document.getElementById(decodeURIComponent(hash));
      if (el && target && el.contains(target)) setOpen(true);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [id]);

  // Respond to "Expand all / Collapse all".
  const signal = group?.signal;
  useEffect(() => {
    if (!signal || signal.seq === lastSeq.current) return;
    lastSeq.current = signal.seq;
    setOpen(signal.open);
    if (storageKey) writeStoredOpen(storageKey, signal.open);
  }, [signal, storageKey]);

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      if (storageKey) writeStoredOpen(storageKey, next);
      return next;
    });
  };

  const button = (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={contentId}
      aria-label={toggleLabel}
      onClick={toggle}
      className="focus-visible:ring-ring group flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2"
    >
      <Chevron open={open} />
      <span className={`min-w-0 break-words ${TITLE[variant]}`}>{title}</span>
      {typeof count === 'number' ? <CountPill count={count} /> : null}
    </button>
  );
  const Heading = headingLevel ? (`h${headingLevel}` as 'h2' | 'h3' | 'h4') : null;

  return (
    <div id={id} className={`scroll-mt-24 ${OUTER[variant]} ${className ?? ''}`}>
      <div
        className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 ${HEADER[variant]}`}
      >
        <div className="min-w-0 flex-1">
          {Heading ? <Heading className="m-0">{button}</Heading> : button}
        </div>
        {meta ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">{meta}</div>
        ) : null}
        {summary ? (
          <div className="text-muted-foreground -mt-2 w-full pb-2 pl-6 text-xs">
            {summary}
          </div>
        ) : null}
      </div>
      {/* `hidden` lives on a wrapper with no display utility, so contentClassName may use
          flex/grid without overriding it. */}
      <div id={contentId} hidden={!open}>
        <div className={`${CONTENT[variant]} ${contentClassName ?? ''}`}>{children}</div>
      </div>
    </div>
  );
}
