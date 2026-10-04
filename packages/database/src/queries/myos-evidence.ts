import {
  myosEvidenceInputSchema,
  type MyosEvidence,
  type MyosEvidenceInput,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';
import { rowToEvidence, VERIFICATION_RANK } from './myos-mappers';

type ParsedInput = ReturnType<typeof myosEvidenceInputSchema.parse>;

function toColumns(input: ParsedInput) {
  return {
    source_type: input.sourceType,
    source_ref: input.sourceRef ?? null,
    source_url: input.sourceUrl ?? null,
    title: input.title,
    excerpt: input.excerpt ?? null,
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
 * index with onConflict, so this is select-then-update/insert. Re-sync never lowers a stronger
 * verification_state (VERIFIED stays VERIFIED) and leaves an existing visibility untouched
 * (the user's choice is never reset by a sync).
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
  const { data: existing, error: findError } = await supabase
    .from('myos_evidence')
    .select('*')
    .eq('user_id', userId)
    .eq('source_type', parsed.sourceType)
    .eq('source_ref', parsed.sourceRef)
    .maybeSingle();
  assertNoError(findError, 'upsertOwnEvidenceBySource.find');

  if (!existing) {
    return createOwnEvidence(supabase, userId, input);
  }

  const current = rowToEvidence(existing);
  const keepCurrentState =
    VERIFICATION_RANK[current.verificationState] > VERIFICATION_RANK[parsed.verificationState];
  const { visibility: _keepVisibility, ...updatable } = toColumns(parsed);
  void _keepVisibility;
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

export async function updateOwnEvidence(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  update: Partial<MyosEvidenceInput>,
): Promise<MyosEvidence> {
  const parsed = myosEvidenceInputSchema.partial().parse(update);
  const { data, error } = await supabase
    .from('myos_evidence')
    .update({
      source_type: parsed.sourceType,
      source_ref: parsed.sourceRef,
      source_url: parsed.sourceUrl,
      title: parsed.title,
      excerpt: parsed.excerpt,
      occurred_at: parsed.occurredAt,
      confidence: parsed.confidence,
      verification_state: parsed.verificationState,
      visibility: parsed.visibility,
      metadata: parsed.metadata as Json | undefined,
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
