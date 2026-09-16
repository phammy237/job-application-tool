import { decodeHtmlEntities } from './decode-html-entities';

/**
 * Deterministic HTML → plain text for job-posting descriptions (Job Discovery Track D4,
 * docs/JOB_DISCOVERY.md). Live data confirms every provider's `job_catalog.description` is
 * HTML (docs/JOB_DISCOVERY.md §6 "Description structure") — this is the one normalization step
 * every requirement/competency/sponsorship extractor runs on, never the raw HTML.
 *
 * No DOM/browser dependency (regex-based) — this package runs in both Node (CLI/server) and the
 * extension's content-script/service-worker contexts, neither of which is guaranteed to have
 * `DOMParser` available server-side. Server-safe, synchronous, deterministic: identical input
 * always produces identical output.
 *
 * Behavior:
 * - `<script>`/`<style>` (and their content) are removed entirely, never left as stray text.
 * - Block-level tags (`p`, `div`, `br`, `li`, headings, etc.) become line breaks so list items and
 *   paragraphs don't run together into one unreadable line.
 * - Every other tag is stripped without a replacement (inline tags like `<strong>`/`<a>` — their
 *   text content is kept).
 * - HTML entities are decoded (reuses `decodeHtmlEntities`).
 * - Whitespace is collapsed within a line, and more than two consecutive blank lines collapse to
 *   one, but paragraph/list boundaries are preserved rather than flattened into a single line.
 * - The original raw `description` column is never modified by this function — callers always
 *   pass a copy/read of it and store the result separately (`job_catalog_features.plain_text_description`).
 */
const SCRIPT_OR_STYLE_BLOCK = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
// Only a block's CLOSING tag (and <br>, which has no meaningful closing tag) introduces a line
// break — the matching opening tag is stripped silently below. Two adjacent blocks then produce
// exactly one line break between them, not two.
const BLOCK_CLOSE_OR_BREAK = /<\/(p|div|li|ul|ol|h[1-6]|tr|table|blockquote)>|<br\s*\/?>/gi;
const BLOCK_OPEN_TAG = /<(p|div|li|ul|ol|h[1-6]|tr|table|blockquote)\b[^>]*>/gi;
const ANY_TAG = /<[^>]+>/g;

export function htmlToPlainText(html: string): string {
  // Removed with nothing (not a line break) — a script/style block is not a real content
  // boundary, and inserting a break here would add a spurious blank line between two otherwise-
  // adjacent paragraphs.
  const withoutScriptsAndStyles = html.replace(SCRIPT_OR_STYLE_BLOCK, '');
  const withLineBreaks = withoutScriptsAndStyles.replace(BLOCK_CLOSE_OR_BREAK, '\n');
  const withoutOpenTags = withLineBreaks.replace(BLOCK_OPEN_TAG, '');
  const withoutTags = withoutOpenTags.replace(ANY_TAG, '');
  const decoded = decodeHtmlEntities(withoutTags);

  const lines = decoded
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''));

  return lines.join('\n').trim();
}
