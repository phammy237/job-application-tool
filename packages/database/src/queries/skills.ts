import {
  skillSchema,
  type Skill,
  type SkillInput,
  type SkillUpdate,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['skills']['Row'];

function rowToSkill(row: Row): Skill {
  return skillSchema.parse({
    id: row.id,
    userId: row.user_id,
    sourceFactId: row.source_fact_id,
    name: row.name,
    category: row.category,
    proficiency: row.proficiency,
    userApproved: row.user_approved,
    approvedForApplications: row.approved_for_applications,
    visibleOnPublicProfile: row.visible_on_public_profile,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function listOwnSkills(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<Skill[]> {
  const { data, error } = await supabase
    .from('skills')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });
  assertNoError(error, 'listOwnSkills');
  return (data ?? []).map(rowToSkill);
}

export async function createOwnSkill(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: SkillInput,
): Promise<Skill> {
  const { data, error } = await supabase
    .from('skills')
    .insert({
      user_id: userId,
      source_fact_id: input.sourceFactId ?? null,
      name: input.name,
      category: input.category ?? null,
      proficiency: input.proficiency ?? null,
      user_approved: input.userApproved ?? false,
      approved_for_applications: input.approvedForApplications ?? false,
      visible_on_public_profile: input.visibleOnPublicProfile ?? false,
    })
    .select('*')
    .single();
  return rowToSkill(unwrapRow(data, error, 'createOwnSkill'));
}

export async function updateOwnSkill(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  update: SkillUpdate,
): Promise<Skill> {
  const { data, error } = await supabase
    .from('skills')
    .update({
      name: update.name,
      category: update.category,
      proficiency: update.proficiency,
      user_approved: update.userApproved,
      approved_for_applications: update.approvedForApplications,
      visible_on_public_profile: update.visibleOnPublicProfile,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToSkill(unwrapRow(data, error, 'updateOwnSkill'));
}

export async function deleteOwnSkill(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('skills')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'deleteOwnSkill');
}
