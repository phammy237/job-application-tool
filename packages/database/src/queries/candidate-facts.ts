import {
  candidateFactSchema,
  type CandidateFact,
  type CandidateFactInput,
  type CandidateFactUpdate,
} from '@career-os/shared';
import { unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['candidate_facts']['Row'];

function rowToFact(row: Row): CandidateFact {
  return candidateFactSchema.parse({
    id: row.id,
    userId: row.user_id,
    category: row.category,
    title: row.title,
    normalizedValue: row.normalized_value,
    sourceText: row.source_text,
    sourceResumeId: row.source_resume_id,
    userApproved: row.user_approved,
    approvedForApplications: row.approved_for_applications,
    visibleOnPublicProfile: row.visible_on_public_profile,
    tags: row.tags ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function listOwnCandidateFacts(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<CandidateFact[]> {
  const { data, error } = await supabase
    .from('candidate_facts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToFact);
}

export async function createOwnCandidateFact(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: CandidateFactInput,
): Promise<CandidateFact> {
  const { data, error } = await supabase
    .from('candidate_facts')
    .insert({
      user_id: userId,
      category: input.category,
      title: input.title,
      normalized_value: input.normalizedValue,
      source_text: input.sourceText ?? null,
      source_resume_id: input.sourceResumeId ?? null,
      user_approved: input.userApproved ?? false,
      approved_for_applications: input.approvedForApplications ?? false,
      visible_on_public_profile: input.visibleOnPublicProfile ?? false,
      tags: input.tags ?? [],
    })
    .select('*')
    .single();
  return rowToFact(unwrapRow(data, error, 'createOwnCandidateFact'));
}

export async function updateOwnCandidateFact(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  update: CandidateFactUpdate,
): Promise<CandidateFact> {
  const { data, error } = await supabase
    .from('candidate_facts')
    .update({
      category: update.category,
      title: update.title,
      normalized_value: update.normalizedValue,
      source_text: update.sourceText,
      user_approved: update.userApproved,
      approved_for_applications: update.approvedForApplications,
      visible_on_public_profile: update.visibleOnPublicProfile,
      tags: update.tags,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToFact(unwrapRow(data, error, 'updateOwnCandidateFact'));
}

export async function deleteOwnCandidateFact(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('candidate_facts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}
