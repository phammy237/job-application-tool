import {
  companyResearchSnapshotSchema,
  companyResearchSourceSchema,
  type CompanyResearchFinding,
  type CompanyResearchSnapshot,
  type CompanyResearchSnapshotSummary,
  type CompanyResearchSource,
  type CompanyResearchSourceType,
  type CompanyResearchFindingCategory,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database, Json } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type SnapshotRow = Database['public']['Tables']['company_research_snapshots']['Row'];
type SourceRow = Database['public']['Tables']['company_research_sources']['Row'];
type FindingRow = Database['public']['Tables']['company_research_findings']['Row'];
type FindingSourceRow =
  Database['public']['Tables']['company_research_finding_sources']['Row'];

function rowToSource(row: SourceRow): CompanyResearchSource {
  return companyResearchSourceSchema.parse({
    id: row.id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    publisher: row.publisher,
    sourceType: row.source_type,
    publishedAt: row.published_at,
    retrievedAt: row.retrieved_at,
    evidenceExcerpt: row.evidence_excerpt,
    contentHash: row.content_hash,
  });
}

/**
 * Phase 7G — company research reads. `company_research_snapshots`/`_sources`/`_findings`/
 * `_finding_sources` are all immutable once written (migration 0025); the only write path in this
 * file is `createCompanyResearchSnapshot`, a thin wrapper around the atomic, service-role-only
 * `create_company_research_snapshot` RPC — everything else here is a plain RLS-scoped read.
 */
export async function listOwnCompanyResearchSnapshotsForApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<CompanyResearchSnapshotSummary[]> {
  const { data: snapshots, error } = await supabase
    .from('company_research_snapshots')
    .select('id, company_name, role_title, researched_at')
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .order('researched_at', { ascending: false });
  assertNoError(error, 'listOwnCompanyResearchSnapshotsForApplication');
  const rows = snapshots ?? [];
  if (rows.length === 0) return [];

  const snapshotIds = rows.map((r) => r.id);
  const [
    { data: sourceCounts, error: sourceError },
    { data: findingCounts, error: findingError },
  ] = await Promise.all([
    supabase
      .from('company_research_sources')
      .select('snapshot_id')
      .eq('user_id', userId)
      .in('snapshot_id', snapshotIds),
    supabase
      .from('company_research_findings')
      .select('snapshot_id')
      .eq('user_id', userId)
      .in('snapshot_id', snapshotIds),
  ]);
  assertNoError(sourceError, 'listOwnCompanyResearchSnapshotsForApplication (sources)');
  assertNoError(findingError, 'listOwnCompanyResearchSnapshotsForApplication (findings)');

  const sourceCountBySnapshot = new Map<string, number>();
  for (const row of sourceCounts ?? []) {
    sourceCountBySnapshot.set(
      row.snapshot_id,
      (sourceCountBySnapshot.get(row.snapshot_id) ?? 0) + 1,
    );
  }
  const findingCountBySnapshot = new Map<string, number>();
  for (const row of findingCounts ?? []) {
    findingCountBySnapshot.set(
      row.snapshot_id,
      (findingCountBySnapshot.get(row.snapshot_id) ?? 0) + 1,
    );
  }

  return rows.map((row) => ({
    id: row.id,
    companyName: row.company_name,
    roleTitle: row.role_title,
    researchedAt: row.researched_at,
    sourceCount: sourceCountBySnapshot.get(row.id) ?? 0,
    findingCount: findingCountBySnapshot.get(row.id) ?? 0,
  }));
}

/** The full, resolved snapshot (findings with their sources already embedded) — one round trip
 * per child table, assembled here rather than a single deep PostgREST embed, matching this
 * codebase's existing preference for explicit, easy-to-reason-about queries over relationship
 * embedding syntax. */
export async function getOwnCompanyResearchSnapshot(
  supabase: CareerOsSupabaseClient,
  userId: string,
  snapshotId: string,
): Promise<CompanyResearchSnapshot | null> {
  const { data: snapshotRow, error: snapshotError } = await supabase
    .from('company_research_snapshots')
    .select('*')
    .eq('id', snapshotId)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(snapshotError, 'getOwnCompanyResearchSnapshot');
  if (!snapshotRow) return null;

  const [
    { data: sourceRows, error: sourcesError },
    { data: findingRows, error: findingsError },
    { data: linkRows, error: linksError },
  ] = await Promise.all([
    supabase
      .from('company_research_sources')
      .select('*')
      .eq('user_id', userId)
      .eq('snapshot_id', snapshotId),
    supabase
      .from('company_research_findings')
      .select('*')
      .eq('user_id', userId)
      .eq('snapshot_id', snapshotId)
      .order('created_at', { ascending: true }),
    supabase
      .from('company_research_finding_sources')
      .select('finding_id, source_id')
      .eq('user_id', userId)
      .eq('snapshot_id', snapshotId),
  ]);
  assertNoError(sourcesError, 'getOwnCompanyResearchSnapshot (sources)');
  assertNoError(findingsError, 'getOwnCompanyResearchSnapshot (findings)');
  assertNoError(linksError, 'getOwnCompanyResearchSnapshot (finding_sources)');

  return assembleSnapshot(
    snapshotRow,
    sourceRows ?? [],
    findingRows ?? [],
    linkRows ?? [],
  );
}

function assembleSnapshot(
  snapshotRow: SnapshotRow,
  sourceRows: SourceRow[],
  findingRows: FindingRow[],
  linkRows: Pick<FindingSourceRow, 'finding_id' | 'source_id'>[],
): CompanyResearchSnapshot {
  const sourcesById = new Map(sourceRows.map((row) => [row.id, rowToSource(row)]));
  const sourceIdsByFinding = new Map<string, string[]>();
  for (const link of linkRows) {
    const list = sourceIdsByFinding.get(link.finding_id) ?? [];
    list.push(link.source_id);
    sourceIdsByFinding.set(link.finding_id, list);
  }

  const findings: CompanyResearchFinding[] = findingRows.map((row) => ({
    id: row.id,
    category: row.category as CompanyResearchFindingCategory,
    claim: row.claim,
    roleRelevance: row.role_relevance,
    requirementIds: row.requirement_ids ?? [],
    sources: (sourceIdsByFinding.get(row.id) ?? [])
      .map((id) => sourcesById.get(id))
      .filter((s): s is CompanyResearchSource => s !== undefined),
  }));

  return companyResearchSnapshotSchema.parse({
    id: snapshotRow.id,
    userId: snapshotRow.user_id,
    applicationId: snapshotRow.application_id,
    companyName: snapshotRow.company_name,
    roleTitle: snapshotRow.role_title,
    jobSnapshotId: snapshotRow.job_snapshot_id,
    researchedAt: snapshotRow.researched_at,
    createdAt: snapshotRow.created_at,
    findings,
    sources: [...sourcesById.values()],
  });
}

export interface CreateCompanyResearchSourceInput {
  id: string;
  url: string;
  canonicalUrl: string | null;
  title: string;
  publisher: string | null;
  sourceType: CompanyResearchSourceType;
  publishedAt: string | null;
  evidenceExcerpt: string | null;
  contentHash: string | null;
}

export interface CreateCompanyResearchFindingInput {
  id: string;
  category: CompanyResearchFindingCategory;
  claim: string;
  roleRelevance: string | null;
  requirementIds: string[];
  sourceIds: string[];
}

export interface CreateCompanyResearchSnapshotInput {
  applicationId: string | null;
  companyName: string;
  roleTitle: string;
  jobSnapshotId: string | null;
  sources: CreateCompanyResearchSourceInput[];
  findings: CreateCompanyResearchFindingInput[];
}

/**
 * Thin wrapper around the service-role-only `create_company_research_snapshot` RPC (migration
 * 0025) — the one atomic path for persisting a completed research pipeline run
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §32). Every source/finding id is generated by the
 * caller (`generate-company-research.ts`) *before* this call, exactly like Phase 7C's résumé
 * entry ids — the model only ever cites ids Career OS already assigned, never invents its own.
 * Callers must pass an admin (service-role) client, with `userId` derived from the verified
 * server-side session — never a client-supplied field.
 */
export async function createCompanyResearchSnapshot(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: CreateCompanyResearchSnapshotInput,
): Promise<{ snapshotId: string; sourceCount: number; findingCount: number }> {
  const { data, error } = await supabase
    .rpc('create_company_research_snapshot', {
      p_user_id: userId,
      p_application_id: input.applicationId,
      p_company_name: input.companyName,
      p_role_title: input.roleTitle,
      p_job_snapshot_id: input.jobSnapshotId,
      p_sources: input.sources.map((s) => ({
        id: s.id,
        url: s.url,
        canonicalUrl: s.canonicalUrl,
        title: s.title,
        publisher: s.publisher,
        sourceType: s.sourceType,
        publishedAt: s.publishedAt,
        evidenceExcerpt: s.evidenceExcerpt,
        contentHash: s.contentHash,
      })) as unknown as Json,
      p_findings: input.findings.map((f) => ({
        id: f.id,
        category: f.category,
        claim: f.claim,
        roleRelevance: f.roleRelevance,
        requirementIds: f.requirementIds,
        sourceIds: f.sourceIds,
      })) as unknown as Json,
    })
    .single();

  const row = unwrapRow(data, error, 'createCompanyResearchSnapshot');
  return {
    snapshotId: row.snapshot_id,
    sourceCount: row.source_count,
    findingCount: row.finding_count,
  };
}
