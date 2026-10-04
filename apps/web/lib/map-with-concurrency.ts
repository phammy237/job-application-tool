/** Tiny bounded-concurrency mapper — no new dependency, mirrors
 * packages/discovery/src/official-posting-resolution.ts's mapWithConcurrency. Preserves input
 * order in the output. Shared by every cron route that fans work out across users
 * (/api/cron/gmail-background-sync, /api/cron/auto-queue, …) so each one isn't carrying its own
 * copy. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
