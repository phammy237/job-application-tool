import {
  getCurrentOwnRequirementMappingRun,
  listCurrentOwnRequirementMappings,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import { buildSupportIndex, type JobSnapshot } from '@career-os/shared';
import { resolveApplicationRequirements } from '../../../../lib/myos/application-requirements';
import { loadEvidenceGraphForRequest } from '../../../../lib/myos/load-graph';
import { MyosEvidenceMatch } from './myos-evidence-match';
import { MyosInterviewPrep } from './myos-interview-prep';

/**
 * Mounts the two deterministic myOS panels on the application page. The evidence graph is loaded
 * once per request (request-cached) and shared, together with one support index. Strictly read-only and AI-free; every query is filtered by the session user id.
 * If myOS data cannot be read (e.g. an unmigrated environment) this renders nothing rather than
 * breaking the application page.
 */
export async function MyosApplicationSections({
  supabase,
  userId,
  company,
  title,
  jobSnapshot,
}: {
  supabase: CareerOsSupabaseClient;
  userId: string;
  company: string;
  title: string;
  jobSnapshot: JobSnapshot;
}) {
  let graph;
  let resolved;
  try {
    const run = await getCurrentOwnRequirementMappingRun(
      supabase,
      userId,
      jobSnapshot.id,
    );
    const [loadedGraph, mappings] = await Promise.all([
      loadEvidenceGraphForRequest(userId),
      run
        ? listCurrentOwnRequirementMappings(supabase, userId, run.id)
        : Promise.resolve(null),
    ]);
    graph = loadedGraph;
    resolved = resolveApplicationRequirements({ mappings, snapshot: jobSnapshot });
  } catch {
    console.warn('[career-os] myOS application panels could not be loaded');
    return null;
  }

  const requirementTexts = resolved.requirements.map((r) => r.text);
  // Both panels match against the same support index (built once instead of three times).
  const supportIndex = buildSupportIndex(graph);
  return (
    <>
      <MyosEvidenceMatch
        graph={graph}
        supportIndex={supportIndex}
        requirements={resolved.requirements}
        source={resolved.source}
      />
      <MyosInterviewPrep
        graph={graph}
        supportIndex={supportIndex}
        job={{
          title,
          company,
          description: jobSnapshot.description ?? '',
          ...(requirementTexts.length > 0 ? { requirements: requirementTexts } : {}),
        }}
      />
    </>
  );
}
