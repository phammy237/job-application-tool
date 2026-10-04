import {
  myosEvidenceInputSchema,
  type MyosEvidence,
  type MyosEvidenceInput,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';
import { rowToEvidence, sanitizeDbText, VERIFICATION_RANK } from './myos-mappers';

type ParsedInput = ReturnType<typeof myosEvidenceInputSchema.parse>;

function toColumns(input: ParsedInput) {
  return {
    source_type: input.sourceType,
    source_ref: input.sourceRef ?? null,
    source_url: input.sourceUrl ?? null,
    title: sanitizeDbText(input.title),
    excerpt: sanitizeDbText(input.excerpt ?? null),
    occurred_at: input.occurredAt ?? null,
    confidence: input.confidence ?? null,
    verification_state: input.verificationState,
    visibility: input.visibility,
    metadata: input.metadata as Json,
  };
}

export async function listOwnEvidence(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<MyosEvidence[]> {
  const { data, error } = await supabase
    .from('myos_evidence')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  assertNoError(error, 'listOwnEvidence');
  return (data ?? []).map(rowToEvidence);
}

export async function getOwnEvidence(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<MyosEvidence | null> {
  const { data, error } = await supabase
    .from('myos_evidence')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnEvidence');
  return data ? rowToEvidence(data) : null;
}

export async function createOwnEvidence(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: MyosEvidenceInput,
): Promise<MyosEvidence> {
  const parsed = myosEvidenceInputSchema.parse(input);
  const { data, error } = await supabase
    .from('myos_evidence')
    .insert({ user_id: userId, ...toColumns(parsed) })
    .select('*')
    .single();
  return rowToEvidence(unwrapRow(data, error, 'createOwnEvidence'));
}

/**
 * Idempotent on (user_id, source_type, source_ref). PostgREST cannot target the partial unique
 * index with onConflict, so this is select-then-update/insert, retried once if a concurrent
 * writer wins the insert race (23505). Re-sync never lowers a stronger verification_state
 * (VERIFIED stays VERIFIED), leaves an existing visibility untouched (the user's choice is never
 * reset by a sync) and never overwrites a title/excerpt the user edited (metadata.userEdited).
 *
 * Writes VERIFIED / GITHUB_* rows, which the database only permits for the service role: call
 * with the admin client and an explicit, session-derived userId (CLAUDE.md).
 */
export async function upsertOwnEvidenceBySource(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: MyosEvidenceInput,
): Promise<MyosEvidence> {
  const parsed = myosEvidenceInputSchema.parse(input);
  if (!parsed.sourceRef) {
    return createOwnEvidence(supabase, userId, input);
  }
  const sourceRef = parsed.sourceRef;

  const find = async () => {
    const { data, error } = await supabase
      .from('myos_evidence')
      .select('*')
      .eq('user_id', userId)
      .eq('source_type', parsed.sourceType)
      .eq('source_ref', sourceRef)
      .maybeSingle();
    assertNoError(error, 'upsertOwnEvidenceBySource.find');
    return data;
  };

  let existing = await find();
  if (!existing) {
    try {
      return await createOwnEvidence(supabase, userId, input);
    } catch (err) {
      const code = (err as { cause?: { code?: string } }).cause?.code;
      if (code !== '23505') throw err;
      existing = await find();
      if (!existing) throw err;
    }
  }

  const current = rowToEvidence(existing);
  const keepCurrentState =
    VERIFICATION_RANK[current.verificationState] > VERIFICATION_RANK[parsed.verificationState];
  const columns = toColumns(parsed);
  const { visibility: _keepVisibility, ...rest } = columns;
  void _keepVisibility;
  const userEdited = current.metadata.userEdited === true;
  const { title, excerpt, ...sourceOnly } = rest;
  const updatable = userEdited
    ? { ...sourceOnly, metadata: { ...(columns.metadata as Record<string, Json>), userEdited: true } as Json }
    : { ...sourceOnly, title, excerpt };
  const { data, error } = await supabase
    .from('myos_evidence')
    .update({
      ...updatable,
      verification_state: keepCurrentState ? current.verificationState : parsed.verificationState,
    })
    .eq('id', current.id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToEvidence(unwrapRow(data, error, 'upsertOwnEvidenceBySource.update'));
}

/**
 * Editing title or excerpt by hand marks the row `metadata.userEdited = true` so a later
 * source re-sync does not clobber the user's wording.
 */
export async function updateOwnEvidence(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  update: Partial<MyosEvidenceInput>,
): Promise<MyosEvidence> {
  const parsed = myosEvidenceInputSchema.partial().parse(update);
  let metadata: Json | undefined = parsed.metadata as Json | undefined;
  if (parsed.title !== undefined || parsed.excerpt !== undefined) {
    const current = parsed.metadata ? null : await getOwnEvidence(supabase, userId, id);
    metadata = { ...((parsed.metadata ?? current?.metadata ?? {}) as Record<string, Json>), userEdited: true };
  }
  const { data, error } = await supabase
    .from('myos_evidence')
    .update({
      source_type: parsed.sourceType,
      source_ref: parsed.sourceRef,
      source_url: parsed.sourceUrl,
      title: parsed.title === undefined ? undefined : sanitizeDbText(parsed.title),
      excerpt: sanitizeDbText(parsed.excerpt),
      occurred_at: parsed.occurredAt,
      confidence: parsed.confidence,
      verification_state: parsed.verificationState,
      visibility: parsed.visibility,
      metadata,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToEvidence(unwrapRow(data, error, 'updateOwnEvidence'));
}

export async function deleteOwnEvidence(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('myos_evidence')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'deleteOwnEvidence');
}
