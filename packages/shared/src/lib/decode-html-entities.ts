/**
 * Deterministic decoding of a small, fixed set of HTML entities — no AI, no DOM parser (this
 * package runs in both Node and the extension's content-script/service-worker contexts, neither
 * of which is guaranteed to have `DOMParser`). Used by the Greenhouse adapter
 * (docs/JOB_DISCOVERY.md "Greenhouse"), whose `content` field is HTML that has itself been
 * entity-encoded once more (e.g. `&lt;h2&gt;` instead of `<h2>`) by the provider's API.
 *
 * Covers the named entities that actually appear in ATS-provided job description HTML, plus
 * numeric character references (`&#39;`, `&#x27;`). An unrecognized named entity is left as-is
 * rather than guessed.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}
