/**
 * Standalone concurrency smoke test for increment_ai_request_usage
 * (supabase/migrations/0004_increment_ai_request_usage.sql) — the RPC's whole purpose is
 * closing a read-then-write race under real concurrency, which single-connection pgTAP tests
 * (supabase/tests/database/0015_increment_ai_request_usage.test.sql) cannot exercise. This
 * script fires many parallel requests against a real Supabase instance and asserts exactly
 * `min(concurrency, limit)` succeed with no double-counting.
 *
 * Not part of the Vitest or pgTAP suites — run manually against a local or a disposable
 * project, never against production data (it mutates the target user's user_settings row).
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx vite-node supabase/scripts/check-ai-request-usage-concurrency.ts \
 *     --user-id <existing-auth-users-id> [--limit 5] [--concurrency 20]
 */
import { createClient } from '@supabase/supabase-js';

interface CliArgs {
  userId: string;
  limit: number;
  concurrency: number;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  const userId = get('--user-id');
  if (!userId) {
    throw new Error('Missing required --user-id <existing auth.users id>');
  }

  return {
    userId,
    limit: Number(get('--limit') ?? 5),
    concurrency: Number(get('--concurrency') ?? 20),
  };
}

async function main() {
  const { userId, limit, concurrency } = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.',
    );
  }

  const supabase = createClient(url, serviceRoleKey);

  console.log(`Resetting user_settings for ${userId}: limit=${limit}, counter=0`);
  const { error: resetError } = await supabase
    .from('user_settings')
    .update({
      ai_request_limit: limit,
      ai_requests_this_period: 0,
      ai_request_period_started_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (resetError) {
    throw new Error(`Failed to reset user_settings: ${resetError.message}`);
  }

  interface UsageRpcRow {
    allowed: boolean;
    ai_requests_this_period: number;
  }

  console.log(`Firing ${concurrency} concurrent increment_ai_request_usage calls...`);
  const results = await Promise.all(
    Array.from({ length: concurrency }, () =>
      supabase
        .rpc('increment_ai_request_usage', { p_user_id: userId })
        .single<UsageRpcRow>(),
    ),
  );

  const errors = results.filter((r) => r.error);
  if (errors.length > 0) {
    throw new Error(`${errors.length} RPC calls errored: ${errors[0]?.error?.message}`);
  }

  const allowedCount = results.filter((r) => r.data?.allowed === true).length;
  const expectedAllowed = Math.min(concurrency, limit);

  const { data: finalRow, error: finalError } = await supabase
    .from('user_settings')
    .select('ai_requests_this_period')
    .eq('user_id', userId)
    .single();
  if (finalError || !finalRow) {
    throw new Error(`Failed to read final counter: ${finalError?.message}`);
  }

  console.log(
    `Allowed: ${allowedCount} (expected ${expectedAllowed}). Final counter: ` +
      `${finalRow.ai_requests_this_period} (expected ${expectedAllowed}).`,
  );

  if (allowedCount !== expectedAllowed) {
    throw new Error(
      `FAIL: expected exactly ${expectedAllowed} allowed calls, got ${allowedCount} — ` +
        'the row lock is not preventing over-admission under concurrency.',
    );
  }
  if (finalRow.ai_requests_this_period !== expectedAllowed) {
    throw new Error(
      `FAIL: expected final counter ${expectedAllowed}, got ${finalRow.ai_requests_this_period} ` +
        '— a blocked call incremented the counter (double-counting).',
    );
  }

  console.log('PASS: no over-admission and no double-counting under concurrency.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
