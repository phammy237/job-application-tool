import {
  requirementEvidenceMappingSchema,
  requirementEvidenceMappingWithValiditySchema,
  type EvidenceFactValidity,
  type FactSourceTable,
  type RequirementEvidenceMapping,
  type RequirementEvidenceMappingWithValidity,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database, Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['requirement_evidence_mappings']['Row'];

function rowToMapping(row: Row): RequirementEvidenceMapping {
  return requirementEvidenceMappingSchema.parse({
    id: row.id,
    userId: row.user_id,
    runId: row.run_id,
    requirementText: row.requirement_text,
    requirementCategory: row.requirement_category,
    requiredOrPreferred: row.required_or_preferred,
    relationship: row.relationship,
    matchedFacts: row.matched_facts,
    explanation: row.explanation,
    confidence: row.confidence,
    requiresUserConfirmation: row.requires_user_confirmation,
    createdAt: row.created_at,
  });
}

const FACT_SOURCE_TABLES: FactSourceTable[] = [
  'candidate_facts',
  'experiences',
  'education',
  'projects',
  'skills',
];

interface LiveFactState {
  updatedAt: string;
  approved: boolean;
}

/**
 * Resolves exactly the (sourceTable, factId) pairs referenced by the given mappings against
 * live fact data — deliberately not the same query as listOwnApprovedFactsForGeneration, which
 * filters to approved-only and so cannot distinguish "unapproved" from "deleted"
 * (docs/IMPLEMENTATION_PLAN.md round-4 addendum §4). Only queries a source table at all if some
 * mapping actually references a fact from it.
 */
async function resolveLiveFactStates(
  supabase: CareerOsSupabaseClient,
  userId: string,
  mappings: RequirementEvidenceMapping[],
): Promise<Map<string, LiveFactState>> {
  const idsByTable = new Map<FactSourceTable, Set<string>>();
  for (const mapping of mappings) {
    for (const fact of mapping.matchedFacts) {
      const set = idsByTable.get(fact.sourceTable) ?? new Set<string>();
      set.add(fact.factId);
      idsByTable.set(fact.sourceTable, set);
    }
  }

  const results = await Promise.all(
    FACT_SOURCE_TABLES.map(async (table) => {
      const ids = idsByTable.get(table);
      if (!ids || ids.size === 0) return { table, rows: [] as { id: string; updated_at: string; user_approved: boolean; approved_for_applications: boolean }[] };
      const { data, error } = await supabase
        .from(table)
        .select('id, updated_at, user_approved, approved_for_applications')
        .eq('user_id', userId)
        .in('id', [...ids]);
      assertNoError(error, `resolveLiveFactStates (${table})`);
      return { table, rows: data ?? [] };
    }),
  );

  const state = new Map<string, LiveFactState>();
  for (const { table, rows } of results) {
    for (const row of rows) {
      state.set(`${table}:${row.id}`, {
        updatedAt: row.updated_at,
        approved: row.user_approved && row.approved_for_applications,
      });
    }
  }
  return state;
}

function resolveValidity(
  live: LiveFactState | undefined,
  capturedUpdatedAt: string,
): EvidenceFactValidity {
  if (!live) return 'deleted';
  if (!live.approved) return 'unapproved';
  if (live.updatedAt !== capturedUpdatedAt) return 'changed_since_analysis';
  return 'valid';
}

/**
 * GET /api/job-snapshots/:id/requirements' actual data source — the CURRENT run's mappings,
 * each with matchedFacts re-resolved against live fact data right now (four distinct states,
 * never collapsed into a single valid/invalid boolean). Fact *content* is never duplicated into
 * the response here — only id/table/validity; the UI resolves live content separately, scoped by
 * user_id, only for facts a user actually expands.
 */
export async function listCurrentOwnRequirementMappings(
  supabase: CareerOsSupabaseClient,
  userId: string,
  runId: string,
): Promise<RequirementEvidenceMappingWithValidity[]> {
  const { data, error } = await supabase
    .from('requirement_evidence_mappings')
    .select('*')
    .eq('user_id', userId)
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  assertNoError(error, 'listCurrentOwnRequirementMappings');

  const mappings = (data ?? []).map(rowToMapping);
  const liveState = await resolveLiveFactStates(supabase, userId, mappings);

  return mappings.map((mapping) =>
    requirementEvidenceMappingWithValiditySchema.parse({
      ...mapping,
      matchedFacts: mapping.matchedFacts.map((fact) => ({
        ...fact,
        validity: resolveValidity(liveState.get(`${fact.sourceTable}:${fact.factId}`), fact.factUpdatedAt),
      })),
    }),
  );
}

export interface PromoteRequirementMappingRunResult {
  runId: string;
  mappingCount: number;
}

/** Wraps the service-role-only promote_requirement_mapping_run RPC (migration 0010) — see that
 * function for the full atomic validate-insert-supersede-promote sequence. */
export async function promoteOwnRequirementMappingRun(
  supabase: CareerOsSupabaseClient,
  userId: string,
  runId: string,
  mappings: Json,
): Promise<PromoteRequirementMappingRunResult> {
  const { data, error } = await supabase
    .rpc('promote_requirement_mapping_run', {
      p_user_id: userId,
      p_run_id: runId,
      p_mappings: mappings,
    })
    .single();
  const row = unwrapRow(data, error, 'promoteOwnRequirementMappingRun');
  return { runId: row.run_id, mappingCount: row.mapping_count };
}
