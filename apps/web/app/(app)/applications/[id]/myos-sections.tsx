import {
  getCurrentOwnRequirementMappingRun,
  listCurrentOwnRequirementMappings,
  loadOwnEvidenceGraph,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import type { JobSnapshot } from '@career-os/shared';
import { resolveApplicationRequirements } from '../../../../lib/myos/application-requirements';
import { MyosEvidenceMatch } from './myos-evidence-match';
import { MyosInterviewPrep } from './myos-interview-prep';

/**
 * Mounts the two deterministic myOS panels on the application page. The evidence graph is loaded
 * once and shared. Strictly read-only and AI-free; every query is filtered by the session user id.
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
    const run = await getCurrentOwnRequirementMappingRun(supabase, userId, jobSnapshot.id);
    const [loadedGraph, mappings] = await Promise.all([
      loadOwnEvidenceGraph(supabase, userId),
      run ? listCurrentOwnRequirementMappings(supabase, userId, run.id) : Promise.resolve(null),
    ]);
    graph = loadedGraph;
    resolved = resolveApplicationRequirements({ mappings, snapshot: jobSnapshot });
  } catch {
    console.warn('[career-os] myOS application panels could not be loaded');
    return null;
  }

  const requirementTexts = resolved.requirements.map((r) => r.text);
  return (
    <>
      <MyosEvidenceMatch graph={graph} requirements={resolved.requirements} source={resolved.source} />
      <MyosInterviewPrep
        graph={graph}
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
