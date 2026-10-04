import {
  myosEdgeInputSchema,
  type EdgeRelation,
  type MyosEdge,
  type MyosEdgeInput,
  type NodeType,
  type VerificationState,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';
import { rowToEdge, VERIFICATION_RANK } from './myos-mappers';

export interface EdgeNodeFilter {
  nodeType: NodeType;
  nodeId: string;
}

export async function listOwnEdges(
  supabase: CareerOsSupabaseClient,
  userId: string,
  filter?: EdgeNodeFilter,
): Promise<MyosEdge[]> {
  let query = supabase.from('myos_edges').select('*').eq('user_id', userId);
  if (filter) {
    // Both ids/types are validated enums/uuids by the callers' schemas; still reject anything
    // that could break out of the PostgREST filter grammar.
    if (!/^[A-Z_]+$/.test(filter.nodeType) || !/^[0-9a-fA-F-]{36}$/.test(filter.nodeId)) {
      throw new Error('listOwnEdges: invalid node filter');
    }
    const { nodeType: t, nodeId: id } = filter;
    query = query.or(
      `and(from_type.eq.${t},from_id.eq.${id}),and(to_type.eq.${t},to_id.eq.${id})`,
    );
  }
  const { data, error } = await query.order('created_at', { ascending: true });
  assertNoError(error, 'listOwnEdges');
  return (data ?? []).map(rowToEdge);
}

export function listOwnEdgesForNode(
  supabase: CareerOsSupabaseClient,
  userId: string,
  nodeType: NodeType,
  nodeId: string,
): Promise<MyosEdge[]> {
  return listOwnEdges(supabase, userId, { nodeType, nodeId });
}

async function findExistingEdge(
  supabase: CareerOsSupabaseClient,
  userId: string,
  e: {
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    relation: string;
  },
): Promise<MyosEdge | null> {
  const { data, error } = await supabase
    .from('myos_edges')
    .select('*')
    .eq('user_id', userId)
    .eq('from_type', e.fromType)
    .eq('from_id', e.fromId)
    .eq('to_type', e.toType)
    .eq('to_id', e.toId)
    .eq('relation', e.relation)
    .maybeSingle();
  assertNoError(error, 'findExistingEdge');
  return data ? rowToEdge(data) : null;
}

/**
 * Idempotent: an existing edge (same endpoints + relation) is returned, upgraded in place only
 * if the new verification_state is strictly stronger (never downgraded). Endpoint ownership and
 * existence are enforced by the database trigger (a foreign/non-existent id raises 23503).
 */
export async function createOwnEdge(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: MyosEdgeInput,
): Promise<MyosEdge> {
  const parsed = myosEdgeInputSchema.parse(input);

  const upgradeIfStronger = async (existing: MyosEdge): Promise<MyosEdge> => {
    if (
      VERIFICATION_RANK[parsed.verificationState] <=
      VERIFICATION_RANK[existing.verificationState]
    ) {
      return existing;
    }
    const { data, error } = await supabase
      .from('myos_edges')
      .update({ verification_state: parsed.verificationState })
      .eq('id', existing.id)
      .eq('user_id', userId)
      .select('*')
      .single();
    return rowToEdge(unwrapRow(data, error, 'createOwnEdge.upgrade'));
  };

  const existing = await findExistingEdge(supabase, userId, parsed);
  if (existing) return upgradeIfStronger(existing);

  const { data, error } = await supabase
    .from('myos_edges')
    .insert({
      user_id: userId,
      from_type: parsed.fromType,
      from_id: parsed.fromId,
      to_type: parsed.toType,
      to_id: parsed.toId,
      relation: parsed.relation,
      verification_state: parsed.verificationState,
      confidence: parsed.confidence,
      note: parsed.note,
    })
    .select('*')
    .single();

  if (error && (error as { code?: string }).code === '23505') {
    // Lost a race with a concurrent insert of the same edge — return the winner.
    const raced = await findExistingEdge(supabase, userId, parsed);
    if (raced) return upgradeIfStronger(raced);
  }
  return rowToEdge(unwrapRow(data, error, 'createOwnEdge'));
}

export async function deleteOwnEdge(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('myos_edges')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'deleteOwnEdge');
}

export interface ReplaceEdgesFromInput {
  fromType: NodeType;
  fromId: string;
  relation: EdgeRelation;
  toType: NodeType;
  targets: { toId: string; verificationState: VerificationState }[];
}

/**
 * Makes the set of (from, relation, toType) edges equal `targets`: stale edges are deleted,
 * missing ones created, existing ones kept. Returns the resulting edges.
 */
export async function replaceOwnEdgesFrom(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: ReplaceEdgesFromInput,
): Promise<MyosEdge[]> {
  const { data, error } = await supabase
    .from('myos_edges')
    .select('*')
    .eq('user_id', userId)
    .eq('from_type', input.fromType)
    .eq('from_id', input.fromId)
    .eq('relation', input.relation)
    .eq('to_type', input.toType);
  assertNoError(error, 'replaceOwnEdgesFrom.list');

  const wanted = new Set(input.targets.map((t) => t.toId));
  const staleIds = (data ?? [])
    .filter((row) => !wanted.has(row.to_id))
    .map((row) => row.id);
  if (staleIds.length > 0) {
    const { error: delError } = await supabase
      .from('myos_edges')
      .delete()
      .eq('user_id', userId)
      .in('id', staleIds);
    assertNoError(delError, 'replaceOwnEdgesFrom.delete');
  }

  const result: MyosEdge[] = [];
  for (const target of input.targets) {
    result.push(
      await createOwnEdge(supabase, userId, {
        fromType: input.fromType,
        fromId: input.fromId,
        toType: input.toType,
        toId: target.toId,
        relation: input.relation,
        verificationState: target.verificationState,
      }),
    );
  }
  return result;
}
