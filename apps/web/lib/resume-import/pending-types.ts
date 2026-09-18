import type { ReviewedEducation, ReviewedExperience, ReviewedProject, ReviewedSkill } from './build-reviewed-payload';

/** A reviewed, staged-but-not-yet-persisted résumé-import row on /profile — `key` is a stable
 * client-only id (never sent to the server) used purely for React list identity and removal. */
export type PendingExperience = ReviewedExperience & { key: string };
export type PendingEducation = ReviewedEducation & { key: string };
export type PendingProject = ReviewedProject & { key: string };
export type PendingSkill = ReviewedSkill & { key: string };

let counter = 0;
/** Monotonic, collision-free within a page session — good enough for React keys that only ever
 * live in memory and are discarded on save/discard/reload. */
export function nextPendingKey(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}
