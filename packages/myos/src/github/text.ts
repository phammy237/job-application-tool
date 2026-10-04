/**
 * Text coming from GitHub is untrusted: Postgres text rejects NUL, and lone surrogates break JSON
 * encoding. Slicing by UTF-16 units can also split a surrogate pair. These helpers make every
 * string safe before it reaches the database.
 */

/** Strips NUL bytes and drops lone surrogates (valid surrogate pairs are kept). */
export function sanitizeText(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c === 0) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i]! + input[i + 1]!;
        i++;
      }
      continue; // lone high surrogate dropped
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue; // lone low surrogate dropped
    out += input[i]!;
  }
  return out;
}

/** Slices to at most `max` Unicode code points (never splits a surrogate pair). */
export function truncateCodePoints(input: string, max: number): string {
  if (max <= 0) return '';
  let count = 0;
  let i = 0;
  while (i < input.length && count < max) {
    const c = input.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < input.length ? 2 : 1;
    count++;
  }
  return input.slice(0, i);
}

/** sanitize then truncate; null/undefined pass through as null. */
export function cleanText(input: string | null | undefined, max: number): string | null {
  if (input === null || input === undefined) return null;
  return truncateCodePoints(sanitizeText(input), max);
}
