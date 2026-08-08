import type { JobExtractionPayload } from '@career-os/shared';

/**
 * See docs/EXTENSION_DESIGN.md §5. Adapters only ever read the DOM — none of them write to it.
 * `matches` decides whether a platform-specific adapter recognizes the current page (by URL
 * pattern and/or DOM signature); GenericHtmlAdapter's `matches` always returns true, since it's
 * the guaranteed fallback.
 */
export interface JobPageAdapter {
  readonly name: string;
  matches(url: string, document: Document): boolean;
  extract(document: Document): JobExtractionPayload;
}
