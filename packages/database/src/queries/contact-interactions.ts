import {
  contactInteractionSchema,
  type ContactInteraction,
  type CreateContactInteractionInput,
  type UpdateContactInteractionInput,
} from '@career-os/shared';
import { DatabaseError, assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['contact_interactions']['Row'];

function rowToContactInteraction(row: Row): ContactInteraction {
  return contactInteractionSchema.parse({
    id: row.id,
    userId: row.user_id,
    contactId: row.contact_id,
    interactionType: row.interaction_type,
    direction: row.direction,
    occurredAt: row.occurred_at,
    subject: row.subject,
    notes: row.notes,
    applicationId: row.application_id,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/**
 * One contact's interaction history, most recent first (docs/IMPLEMENTATION_PLAN.md
 * "Phase 6B" §11) — `occurred_at desc` (when it actually happened, user-editable), then
 * `created_at desc` as a deterministic tie-break for same-instant entries, matching the index
 * `contact_interactions_user_id_contact_id_occurred_at_idx` migration 0018 adds for exactly this
 * query shape.
 */
export async function listOwnContactInteractions(
  supabase: CareerOsSupabaseClient,
  userId: string,
  contactId: string,
): Promise<ContactInteraction[]> {
  const { data, error } = await supabase
    .from('contact_interactions')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false });
  assertNoError(error, 'listOwnContactInteractions');
  return (data ?? []).map(rowToContactInteraction);
}

export async function getOwnContactInteraction(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<ContactInteraction | null> {
  const { data, error } = await supabase
    .from('contact_interactions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnContactInteraction');
  return data ? rowToContactInteraction(data) : null;
}

/**
 * Enforces the Phase 6B v1 product rule that an interaction's optional `applicationId` must be
 * one of *this contact's* already-linked applications (docs/IMPLEMENTATION_PLAN.md "Phase 6B"
 * §12) — "coffee chat with Jane about the Microsoft PM internship" should correspond to an
 * application Jane is actually linked to, not an arbitrary unrelated one. This is a business-
 * rule check, not a cross-user ownership boundary (the composite FK on `contact_interactions.
 * application_id` already makes a *cross-user* attachment structurally impossible) — a CHECK
 * constraint can't reference another table, so this lives here, the same way
 * `createOwnApplication` guards against `status: 'APPLIED'` in TypeScript rather than SQL.
 */
async function assertApplicationLinkedToContact(
  supabase: CareerOsSupabaseClient,
  userId: string,
  contactId: string,
  applicationId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('application_contacts')
    .select('application_id')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('application_id', applicationId)
    .limit(1)
    .maybeSingle();
  assertNoError(error, 'assertApplicationLinkedToContact');
  if (!data) {
    throw new DatabaseError(
      'This application is not linked to this contact — link it from the contact or ' +
        'application People section first.',
    );
  }
}

/** Always creates a `source: 'MANUAL'` row — Phase 6B has no other writer. */
export async function createOwnContactInteraction(
  supabase: CareerOsSupabaseClient,
  userId: string,
  contactId: string,
  input: CreateContactInteractionInput,
): Promise<ContactInteraction> {
  if (input.applicationId) {
    await assertApplicationLinkedToContact(
      supabase,
      userId,
      contactId,
      input.applicationId,
    );
  }

  const { data, error } = await supabase
    .from('contact_interactions')
    .insert({
      user_id: userId,
      contact_id: contactId,
      interaction_type: input.interactionType,
      direction: input.direction ?? null,
      occurred_at: input.occurredAt,
      subject: input.subject ?? null,
      notes: input.notes ?? null,
      application_id: input.applicationId ?? null,
      source: 'MANUAL',
    })
    .select('*')
    .single();
  return rowToContactInteraction(unwrapRow(data, error, 'createOwnContactInteraction'));
}

export async function updateOwnContactInteraction(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  input: UpdateContactInteractionInput,
): Promise<ContactInteraction> {
  // Needed for two things: the contactId to validate a new applicationId against, and to fail
  // with a clear not-found error rather than a confusing zero-row update.
  const current = await getOwnContactInteraction(supabase, userId, id);
  if (!current) {
    throw new DatabaseError(
      'updateOwnContactInteraction: interaction not found or not owned by this user.',
    );
  }

  if (input.applicationId) {
    await assertApplicationLinkedToContact(
      supabase,
      userId,
      current.contactId,
      input.applicationId,
    );
  }

  const { data, error } = await supabase
    .from('contact_interactions')
    .update({
      interaction_type: input.interactionType,
      direction: input.direction,
      occurred_at: input.occurredAt,
      subject: input.subject,
      notes: input.notes,
      application_id: input.applicationId,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToContactInteraction(unwrapRow(data, error, 'updateOwnContactInteraction'));
}

/** Removes only the interaction row — never the contact, the application, contact_tags, or
 * application_contacts (docs/IMPLEMENTATION_PLAN.md "Phase 6B" §17). */
export async function deleteOwnContactInteraction(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('contact_interactions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  assertNoError(error, 'deleteOwnContactInteraction');
}
