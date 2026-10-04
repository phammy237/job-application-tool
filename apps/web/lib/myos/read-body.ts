/**
 * Reads a request body as text with a hard size cap: rejects early on a declared content-length,
 * then streams the body and stops as soon as the cap is exceeded (content-length can be absent or
 * wrong, e.g. chunked). Returns null when the body is too large.
 */
export async function readCappedText(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) return null;
  }
  if (!request.body) {
    const text = await request.text();
    return new TextEncoder().encode(text).length > maxBytes ? null : text;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}
