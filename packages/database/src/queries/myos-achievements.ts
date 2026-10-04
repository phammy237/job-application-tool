import {
  myosAchievementInputSchema,
  type MyosAchievement,
  type MyosAchievementInput,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';
import { rowToAchievement } from './myos-mappers';

export async function listOwnAchievements(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<MyosAchievement[]> {
  const { data, error } = await supabase
    .from('myos_achievements')
    .select('*')
    .eq('user_id', userId)
    .order('occurred_on', { ascending: false, nullsFirst: false });
  assertNoError(error, 'listOwnAchievements');
  return (data ?? []).map(rowToAchievement);
}

export async function getOwnAchievement(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<MyosAchievement | null> {
  const { data, error } = await supabase
    .from('myos_achievements')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnAchievement');
  return data ? rowToAchievement(data) : null;
}

/**
 * True when an EVIDENCE→ACHIEVEMENT SUPPORTS edge exists whose evidence row is VERIFIED or
 * USER_PROVIDED (INFERRED / AI_GENERATED evidence never substantiates a metric).
 */
async function hasSupportingEvidence(
  supabase: CareerOsSupabaseClient,
  userId: string,
  achievementId: string,
): Promise<boolean> {
  const { data: edges, error } = await supabase
    .from('myos_edges')
    .select('from_id')
    .eq('user_id', userId)
    .eq('from_type', 'EVIDENCE')
    .eq('to_type', 'ACHIEVEMENT')
    .eq('to_id', achievementId)
    .eq('relation', 'SUPPORTS');
  assertNoError(error, 'hasSupportingEvidence.edges');
  const evidenceIds = (edges ?? []).map((e) => e.from_id);
  if (evidenceIds.length === 0) return false;

  const { data: evidence, error: evError } = await supabase
    .from('myos_evidence')
    .select('id')
    .eq('user_id', userId)
    .in('id', evidenceIds)
    .in('verification_state', ['VERIFIED', 'USER_PROVIDED']);
  assertNoError(evError, 'hasSupportingEvidence.evidence');
  return (evidence ?? []).length > 0;
}

/**
 * A new achievement can never be born VERIFIED when it carries a metric: no evidence edge can
 * exist yet, so a caller-supplied VERIFIED is forced down to USER_PROVIDED.
 */
export async function createOwnAchievement(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: MyosAchievementInput,
): Promise<MyosAchievement> {
  const parsed = myosAchievementInputSchema.parse(input);
  const metricText = parsed.metricText?.trim() ? parsed.metricText.trim() : null;
  const verificationState =
    metricText && parsed.verificationState === 'VERIFIED'
      ? 'USER_PROVIDED'
      : parsed.verificationState;
  const { data, error } = await supabase
    .from('myos_achievements')
    .insert({
      user_id: userId,
      title: parsed.title,
      description: parsed.description ?? null,
      kind: parsed.kind,
      occurred_on: parsed.occurredOn ?? null,
      metric_text: metricText,
      project_id: parsed.projectId ?? null,
      experience_id: parsed.experienceId ?? null,
      verification_state: verificationState,
      user_approved: parsed.userApproved,
      visibility: parsed.visibility,
    })
    .select('*')
    .single();
  return rowToAchievement(unwrapRow(data, error, 'createOwnAchievement'));
}

export async function updateOwnAchievement(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  update: Partial<MyosAchievementInput>,
): Promise<MyosAchievement> {
  const parsed = myosAchievementInputSchema.partial().parse(update);

  let verificationState = parsed.verificationState;
  if (verificationState === 'VERIFIED' || parsed.metricText !== undefined) {
    // Same rule as create: VERIFIED needs real supporting evidence when a metric is involved.
    // It also applies when the metric text of an already-VERIFIED achievement is edited: the
    // evidence substantiated the OLD claim, so the new wording is downgraded unless an
    // evidence edge still supports the achievement.
    const existing = await getOwnAchievement(supabase, userId, id);
    const nextMetric =
      parsed.metricText !== undefined
        ? parsed.metricText?.trim() || null
        : existing?.metricText;
    const effectiveState = verificationState ?? existing?.verificationState;
    const metricChanged =
      parsed.metricText !== undefined &&
      nextMetric !== (existing?.metricText?.trim() || null);
    if (
      effectiveState === 'VERIFIED' &&
      nextMetric &&
      (parsed.verificationState === 'VERIFIED' || metricChanged) &&
      !(await hasSupportingEvidence(supabase, userId, id))
    ) {
      verificationState = 'USER_PROVIDED';
    }
  }

  const { data, error } = await supabase
    .from('myos_achievements')
    .update({
      title: parsed.title,
      description: parsed.description,
      kind: parsed.kind,
      occurred_on: parsed.occurredOn,
      metric_text:
        parsed.metricText === undefined ? undefined : parsed.metricText?.trim() || null,
      project_id: parsed.projectId,
      experience_id: parsed.experienceId,
      verification_state: verificationState,
      user_approved: parsed.userApproved,
      visibility: parsed.visibility,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToAchievement(unwrapRow(data, error, 'updateOwnAchievement'));
}

/**
 * Promotes an achievement to VERIFIED only if a SUPPORTS evidence edge backs it (see
 * hasSupportingEvidence). Returns null — and changes nothing — when no such evidence exists.
 */
export async function markAchievementVerifiedIfSupported(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<MyosAchievement | null> {
  if (!(await hasSupportingEvidence(supabase, userId, id))) return null;
  const { data, error } = await supabase
    .from('myos_achievements')
    .update({ verification_state: 'VERIFIED' })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();
  assertNoError(error, 'markAchievementVerifiedIfSupported');
  return data ? rowToAchievement(data) : null;
}

export async function deleteOwnAchievement(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('myos_achievements')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'deleteOwnAchievement');
}
