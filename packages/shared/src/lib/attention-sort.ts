import type { NextActionPriority } from '../schemas/next-action';

/**
 * Deterministic ordering for "what needs attention first" (docs/IMPLEMENTATION_PLAN.md
 * "Phase 5C.2B"). Pure — no I/O, no randomness, no reliance on object insertion order — so the
 * same input always produces the same output, and this is independently testable the same way
 * next-action-rules.ts is.
 */
export interface AttentionSortable {
  id: string;
  priority: NextActionPriority;
  /** The real appliedAt fact, if known — never a deadline. */
  appliedAt: string | null;
  updatedAt: string;
}

const PRIORITY_RANK: Record<NextActionPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
};

/**
 * 1. Priority first — URGENT before HIGH before MEDIUM before LOW before NONE.
 * 2. Within the same priority, if both items have a real `appliedAt`, the one that has been
 *    waiting longer (older `appliedAt`) sorts first — the longer something has sat in a state
 *    like ACTION_REQUIRED or OFFER, the more it deserves attention over a same-priority item
 *    that just arrived.
 * 3. If either lacks `appliedAt` (never yet applied, so there is no "how long has this been
 *    waiting" fact to use), fall back to `updatedAt` descending — most recently touched first,
 *    a stable, always-available signal.
 * 4. Final tie-break on `id` — guarantees a total order so the sort is never accidentally
 *    unstable across re-renders/re-fetches for two items that are otherwise identical.
 */
export function compareByAttention(a: AttentionSortable, b: AttentionSortable): number {
  const priorityDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (priorityDiff !== 0) return priorityDiff;

  if (a.appliedAt && b.appliedAt) {
    const appliedDiff = new Date(a.appliedAt).getTime() - new Date(b.appliedAt).getTime();
    if (appliedDiff !== 0) return appliedDiff;
  } else {
    const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (updatedDiff !== 0) return updatedDiff;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortByAttention<T extends AttentionSortable>(items: T[]): T[] {
  return [...items].sort(compareByAttention);
}
