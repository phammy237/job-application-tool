import { myosStoryInputSchema, type MyosStory, type MyosStoryInput } from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';
import { rowToStory } from './myos-mappers';

export async function listOwnStories(
  supabase: CareerOsSupabaseClient,
  userId: string,
): Promise<MyosStory[]> {
  const { data, error } = await supabase
    .from('myos_stories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  assertNoError(error, 'listOwnStories');
  return (data ?? []).map(rowToStory);
}

export async function getOwnStory(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<MyosStory | null> {
  const { data, error } = await supabase
    .from('myos_stories')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnStory');
  return data ? rowToStory(data) : null;
}

export async function createOwnStory(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: MyosStoryInput,
): Promise<MyosStory> {
  const parsed = myosStoryInputSchema.parse(input);
  const { data, error } = await supabase
    .from('myos_stories')
    .insert({
      user_id: userId,
      title: parsed.title,
      situation: parsed.situation ?? null,
      task: parsed.task ?? null,
      action: parsed.action ?? null,
      result: parsed.result ?? null,
      competencies: parsed.competencies,
      themes: parsed.themes,
      verification_state: parsed.verificationState,
      user_approved: parsed.userApproved,
      visibility: parsed.visibility,
    })
    .select('*')
    .single();
  return rowToStory(unwrapRow(data, error, 'createOwnStory'));
}

export async function updateOwnStory(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  update: Partial<MyosStoryInput>,
): Promise<MyosStory> {
  const parsed = myosStoryInputSchema.partial().parse(update);
  const { data, error } = await supabase
    .from('myos_stories')
    .update({
      title: parsed.title,
      situation: parsed.situation,
      task: parsed.task,
      action: parsed.action,
      result: parsed.result,
      competencies: parsed.competencies,
      themes: parsed.themes,
      verification_state: parsed.verificationState,
      user_approved: parsed.userApproved,
      visibility: parsed.visibility,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToStory(unwrapRow(data, error, 'updateOwnStory'));
}

export async function deleteOwnStory(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('myos_stories')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'deleteOwnStory');
}
