/**
 * Deterministic source-registry importer (docs/JOB_DISCOVERY.md "Source registry management").
 * Reads a JSON file of source entries, validates every one with Zod, and idempotently upserts
 * each into `job_sources` keyed on `(sourceType, sourceIdentifier)` — never inferred/fabricated
 * identifiers (CLAUDE.md "never invent a fact"), never a live scrape of a careers page.
 *
 * File shape:
 *   [{ "companyName": "Example", "sourceType": "GREENHOUSE", "sourceIdentifier": "example",
 *      "careersUrl": "https://...", "enabled": true, "crawlIntervalHours": 24 }, ...]
 * Only companyName/sourceType/sourceIdentifier are required; the rest are optional and, on an
 * update, left untouched when omitted (see packages/database's upsertJobSource doc comment).
 * Source files carry only public ATS identifiers/URLs and are safe to commit — never a secret.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx vite-node scripts/discovery/import-sources.ts <path-to-sources.json> [--dry-run]
 */
import { readFileSync } from 'node:fs';
import { createSupabaseAdminClient, upsertJobSource } from '@career-os/database';
import { jobSourceImportFileSchema, type JobSourceImportEntry } from '@career-os/shared';

interface CliArgs {
  filePath: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const filePath = positional[0];
  if (!filePath) {
    throw new Error('Usage: import-sources.ts <path-to-sources.json> [--dry-run]');
  }
  return { filePath, dryRun: argv.includes('--dry-run') };
}

function assertNoDuplicates(entries: JobSourceImportEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.sourceType}:${entry.sourceIdentifier}`;
    if (seen.has(key)) {
      throw new Error(
        `Duplicate source in file: ${key} (${entry.companyName}) — each (sourceType, ` +
          'sourceIdentifier) pair may appear at most once per import file.',
      );
    }
    seen.add(key);
  }
}

async function main(): Promise<void> {
  const { filePath, dryRun } = parseArgs(process.argv.slice(2));

  const raw = readFileSync(filePath, 'utf-8');
  const parsedJson: unknown = JSON.parse(raw);
  const entries = jobSourceImportFileSchema.parse(parsedJson);
  assertNoDuplicates(entries);

  console.log(`Loaded ${entries.length} source(s) from ${filePath}.`);

  if (dryRun) {
    for (const entry of entries) {
      console.log(
        `[dry-run] would upsert ${entry.sourceType}:${entry.sourceIdentifier} (${entry.companyName})`,
      );
    }
    console.log('Dry run — no changes written.');
    return;
  }

  const supabase = createSupabaseAdminClient();
  let count = 0;
  for (const entry of entries) {
    const source = await upsertJobSource(supabase, entry);
    count += 1;
    console.log(
      `Upserted ${source.sourceType}:${source.sourceIdentifier} (${source.companyName}) -> ${source.id}`,
    );
  }
  console.log(`Done. ${count} source(s) upserted.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
