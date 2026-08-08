import type { JobExtractionPayload } from '@career-os/shared';
import type { JobPageAdapter } from './adapter';
import { GenericHtmlAdapter } from './generic-html-adapter';

/**
 * Tries platform-specific adapters first (by URL/DOM signature), falling back to
 * GenericHtmlAdapter — the only adapter that ships in Phase 2 (docs/IMPLEMENTATION_PLAN.md
 * Phase 2 explicitly excludes Greenhouse/Lever/Workday; they're added opportunistically later).
 * GenericHtmlAdapter.matches() always returns true, so it's listed last and is guaranteed to be
 * reached if nothing more specific claims the page first.
 */
const ADAPTERS: JobPageAdapter[] = [GenericHtmlAdapter];

export function extractJob(url: string, document: Document): JobExtractionPayload {
  const adapter = ADAPTERS.find((candidate) => candidate.matches(url, document));
  if (!adapter) {
    // Unreachable while GenericHtmlAdapter (matches() => true) is always in the list, but keeps
    // this function honest about its real return type if that ever changes.
    throw new Error('No adapter matched this page.');
  }
  return adapter.extract(document);
}
