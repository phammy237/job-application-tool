import {
  myosProjectDetailSchema,
  myosProjectDetailUpdateSchema,
  type MyosProjectDetail,
  type MyosProjectDetailUpdate,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['projects']['Row'];

function rowToDetail(row: Row): MyosProjectDetail {
  return myosProjectDetailSchema.parse({
    projectId: row.id,
    status: row.status ?? null,
    summary: row.summary ?? null,
    collaborators: row.collaborators ?? [],
    talkingPoints: row.talking_points ?? [],
    origin: row.origin ?? 'MANUAL',
    visibility: row.visibility ?? 'PRIVATE',
  });
}

export async function getOwnProjectDetail(
  supabase: CareerOsSupabaseClient,
  userId: string,
  projectId: string,
): Promise<MyosProjectDetail | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnProjectDetail');
  return data ? rowToDetail(data) : null;
}

export async function updateOwnProjectDetail(
  supabase: CareerOsSupabaseClient,
  userId: string,
  projectId: string,
  update: MyosProjectDetailUpdate,
): Promise<MyosProjectDetail> {
  const parsed = myosProjectDetailUpdateSchema.parse(update);
  const { data, error } = await supabase
    .from('projects')
    .update({
      status: parsed.status,
      summary: parsed.summary,
      collaborators: parsed.collaborators,
      talking_points: parsed.talkingPoints,
      visibility: parsed.visibility,
    })
    .eq('id', projectId)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToDetail(unwrapRow(data, error, 'updateOwnProjectDetail'));
}
