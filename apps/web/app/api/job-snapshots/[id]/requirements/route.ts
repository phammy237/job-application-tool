import { NextResponse } from 'next/server';
import { generateRequirementMapping } from '@career-os/ai';
import {
  getCurrentOwnRequirementMappingRun,
  getOwnJobSnapshot,
  listCurrentOwnRequirementMappings,
} from '@career-os/database';
import { getCurrentUser } from '../../../../../lib/auth';
import { createAdminClient } from '../../../../../lib/supabase/admin';

/**
 * Called from the web dashboard's application detail page (docs/IMPLEMENTATION_PLAN.md Phase
 * 5A) — a cookie-session-authenticated caller, unlike every other route under app/api which the
 * extension calls via bearer token. Auth is still never trusted from client input: getCurrentUser
 * derives the id from the verified Supabase session. DB access still goes through the admin
 * client, not the session-scoped one — the RPCs generateRequirementMapping ultimately calls are
 * granted to service_role only (migration 0010's server-only pattern), so the session-scoped
 * client could never call them regardless; every query is still explicitly scoped by the derived
 * userId, not by RLS alone (CLAUDE.md: "RLS is the backstop, not the only check").
 */
async function requireCurrentUserId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

/**
 * Triggers one requirement-mapping generation run for this snapshot — explicit, user-triggered
 * only, never called automatically from the save flow (docs/IMPLEMENTATION_PLAN.md's round-4
 * addendum §6/§9). No request body: the snapshot id in the URL, re-verified for ownership inside
 * generateRequirementMapping itself, is the only input.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: jobSnapshotId } = await params;
  const supabase = createAdminClient();

  const result = await generateRequirementMapping(supabase, userId, { jobSnapshotId });

  switch (result.status) {
    case 'promoted':
      return NextResponse.json({ status: 'promoted', runId: result.runId, mappingCount: result.mappingCount });
    case 'snapshot_not_found':
      return NextResponse.json({ error: 'Job snapshot not found' }, { status: 404 });
    case 'rate_limited':
      return NextResponse.json(
        { error: 'AI request limit reached', usage: result.usage },
        { status: 429 },
      );
    case 'provider_error':
      return NextResponse.json({ error: 'AI provider error' }, { status: 502 });
    case 'insufficient_facts':
      return NextResponse.json({ status: 'insufficient_facts' });
    case 'validation_failed':
      return NextResponse.json({ status: 'validation_failed' }, { status: 502 });
    default:
      return result satisfies never;
  }
}

/**
 * Returns the CURRENT run (if any) for this snapshot and its mappings, each with matchedFacts
 * re-resolved against live fact data right now (docs/IMPLEMENTATION_PLAN.md round-4 addendum
 * §4) — never the raw, potentially-stale provenance captured at generation time.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: jobSnapshotId } = await params;
  const supabase = createAdminClient();

  const snapshot = await getOwnJobSnapshot(supabase, userId, jobSnapshotId);
  if (!snapshot) {
    return NextResponse.json({ error: 'Job snapshot not found' }, { status: 404 });
  }

  const run = await getCurrentOwnRequirementMappingRun(supabase, userId, jobSnapshotId);
  if (!run) {
    return NextResponse.json({ run: null, mappings: [] });
  }

  const mappings = await listCurrentOwnRequirementMappings(supabase, userId, run.id);
  return NextResponse.json({ run, mappings });
}
