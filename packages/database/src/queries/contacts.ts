import {
  contactSchema,
  contactTagSchema,
  findPossibleDuplicateContacts,
  type Contact,
  type ContactTag,
  type CreateContactInput,
  type DuplicateCandidateInput,
  type PossibleDuplicateContact,
  type UpdateContactInput,
} from '@career-os/shared';
import { assertNoError, unwrapRow } from '../errors';
import type { Database } from '../types/database.types';
import type { CareerOsSupabaseClient } from '../types/client';

type Row = Database['public']['Tables']['contacts']['Row'];

/** Exported for `application-contacts.ts`, which needs to map raw `contacts` rows fetched via a
 * batched `in(...)` query into the same domain shape without a second per-row query. */
export function rowToContact(row: Row): Contact {
  return contactSchema.parse({
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    linkedinUrl: row.linkedin_url,
    currentCompany: row.current_company,
    currentTitle: row.current_title,
    location: row.location,
    notes: row.notes,
    source: row.source,
    followUpAt: row.follow_up_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export interface ContactFilters {
  /** Matches display_name, current_company, current_title, or email — the /network page's
   * search box (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §14), reusing the same simple
   * ilike-across-columns approach as `listOwnApplications`' search filter. */
  search?: string;
}

export async function listOwnContacts(
  supabase: CareerOsSupabaseClient,
  userId: string,
  filters: ContactFilters = {},
): Promise<Contact[]> {
  let query = supabase.from('contacts').select('*').eq('user_id', userId);
  if (filters.search) {
    const term = filters.search;
    query = query.or(
      `display_name.ilike.%${term}%,current_company.ilike.%${term}%,` +
        `current_title.ilike.%${term}%,email.ilike.%${term}%`,
    );
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  assertNoError(error, 'listOwnContacts');
  return (data ?? []).map(rowToContact);
}

export async function getOwnContact(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<Contact | null> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  assertNoError(error, 'getOwnContact');
  return data ? rowToContact(data) : null;
}

/** Creates a contact and, when `input.tags` is non-empty, its initial contact_tags rows. Not
 * wrapped in a database transaction — an ordinary session-scoped multi-step write, same posture
 * as `createOwnApplication`'s create-then-record-event (this package's other non-atomic multi-
 * step writes); a tag-insert failure after a successful contact insert leaves a taggable contact
 * behind rather than a corrupt one, which is an acceptable failure mode for ordinary editable CRM
 * data (docs/IMPLEMENTATION_PLAN.md "Phase 6A" — this is not immutable-history data). */
export async function createOwnContact(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: CreateContactInput,
): Promise<Contact> {
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      user_id: userId,
      display_name: input.displayName,
      first_name: input.firstName ?? null,
      last_name: input.lastName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      linkedin_url: input.linkedinUrl ?? null,
      current_company: input.currentCompany ?? null,
      current_title: input.currentTitle ?? null,
      location: input.location ?? null,
      notes: input.notes ?? null,
      source: input.source,
    })
    .select('*')
    .single();
  const contact = rowToContact(unwrapRow(data, error, 'createOwnContact'));

  if (input.tags.length > 0) {
    await replaceOwnContactTags(supabase, userId, contact.id, input.tags);
  }

  return contact;
}

export async function updateOwnContact(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  input: UpdateContactInput,
): Promise<Contact> {
  const { data, error } = await supabase
    .from('contacts')
    .update({
      display_name: input.displayName,
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
      phone: input.phone,
      linkedin_url: input.linkedinUrl,
      current_company: input.currentCompany,
      current_title: input.currentTitle,
      location: input.location,
      notes: input.notes,
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  const contact = rowToContact(unwrapRow(data, error, 'updateOwnContact'));

  if (input.tags) {
    await replaceOwnContactTags(supabase, userId, id, input.tags);
  }

  return contact;
}

/** Cascades to contact_tags and application_contacts at the database level (migration 0017) —
 * this function does not need to (and must not) delete either itself. */
export async function deleteOwnContact(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase.from('contacts').delete().eq('id', id).eq('user_id', userId);
  assertNoError(error, 'deleteOwnContact');
}

export async function listOwnContactTags(
  supabase: CareerOsSupabaseClient,
  userId: string,
  contactId: string,
): Promise<ContactTag[]> {
  const { data, error } = await supabase
    .from('contact_tags')
    .select('tag')
    .eq('user_id', userId)
    .eq('contact_id', contactId);
  assertNoError(error, 'listOwnContactTags');
  return (data ?? []).map((row) => contactTagSchema.parse(row.tag));
}

/**
 * Batched tag lookup for a list of contacts in one query — the /network list page's tag badges
 * would otherwise be one query per row (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §32 N+1 review).
 * Returns every contact id with at least one tag; a contact with none is simply absent from the
 * map (callers should default to an empty array).
 */
export async function listOwnContactTagsForContacts(
  supabase: CareerOsSupabaseClient,
  userId: string,
  contactIds: string[],
): Promise<Map<string, ContactTag[]>> {
  const result = new Map<string, ContactTag[]>();
  if (contactIds.length === 0) return result;

  const { data, error } = await supabase
    .from('contact_tags')
    .select('contact_id, tag')
    .eq('user_id', userId)
    .in('contact_id', contactIds);
  assertNoError(error, 'listOwnContactTagsForContacts');

  for (const row of data ?? []) {
    const tag = contactTagSchema.parse(row.tag);
    const existing = result.get(row.contact_id);
    if (existing) {
      existing.push(tag);
    } else {
      result.set(row.contact_id, [tag]);
    }
  }
  return result;
}

/**
 * Replaces a contact's full tag set with `tags` — delete-then-insert, not a diff/merge. Two
 * round trips, not one atomic statement (see createOwnContact's doc comment on why that's an
 * accepted tradeoff for this ordinary, user-editable data); an empty `tags` array is a valid
 * "clear all tags" call, distinct from omitting the field entirely (callers only invoke this when
 * they mean to set tags at all — see createOwnContact/updateOwnContact's own `tags.length > 0` /
 * `if (input.tags)` guards).
 */
export async function replaceOwnContactTags(
  supabase: CareerOsSupabaseClient,
  userId: string,
  contactId: string,
  tags: ContactTag[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('contact_tags')
    .delete()
    .eq('user_id', userId)
    .eq('contact_id', contactId);
  assertNoError(deleteError, 'replaceOwnContactTags (delete)');

  if (tags.length === 0) return;

  const { error: insertError } = await supabase.from('contact_tags').insert(
    tags.map((tag) => ({ user_id: userId, contact_id: contactId, tag })),
  );
  assertNoError(insertError, 'replaceOwnContactTags (insert)');
}

/**
 * Deterministic duplicate hints for a contact being created or edited (docs/IMPLEMENTATION_PLAN.md
 * "Phase 6A" §12) — fetches the user's own contacts (this dataset is expected to stay small,
 * per the same doc's §14) and runs the pure normalizers/matcher in `@career-os/shared` against
 * them. Advisory only: the caller decides whether to warn the user, and nothing here ever
 * merges or blocks contact creation.
 */
export async function findOwnPossibleDuplicateContacts(
  supabase: CareerOsSupabaseClient,
  userId: string,
  candidate: DuplicateCandidateInput,
  excludeContactId?: string,
): Promise<PossibleDuplicateContact[]> {
  const existing = await listOwnContacts(supabase, userId);
  return findPossibleDuplicateContacts(candidate, existing, excludeContactId);
}

/**
 * Sets or reschedules a contact's explicit follow-up reminder (docs/IMPLEMENTATION_PLAN.md
 * "Phase 6C" §4/§12) — a dedicated function, not folded into `updateOwnContact`, since this is
 * its own explicit action ("Set follow-up reminder"/"Reschedule"), not a general identity/detail
 * edit. `followUpAt` is always a real, user-chosen timestamp here — this function never invents
 * one; see `clearOwnContactFollowUp` for the "no reminder" case.
 */
export async function setOwnContactFollowUp(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
  followUpAt: string,
): Promise<Contact> {
  const { data, error } = await supabase
    .from('contacts')
    .update({ follow_up_at: followUpAt })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToContact(unwrapRow(data, error, 'setOwnContactFollowUp'));
}

/**
 * "Mark follow-up done" — clears `follow_up_at` back to null (docs/IMPLEMENTATION_PLAN.md
 * "Phase 6C" §11). Deliberately does nothing else: it does not log an interaction, does not
 * assume the user actually contacted the person, and does not write any completion record — see
 * that doc section's own reasoning for why inferring "followed up" from a dismissed reminder
 * would be a fabricated fact, not an observed one.
 */
export async function clearOwnContactFollowUp(
  supabase: CareerOsSupabaseClient,
  userId: string,
  id: string,
): Promise<Contact> {
  const { data, error } = await supabase
    .from('contacts')
    .update({ follow_up_at: null })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();
  return rowToContact(unwrapRow(data, error, 'clearOwnContactFollowUp'));
}

/**
 * Contacts with a due (non-null, `<= now`) follow-up reminder, earliest first — one bounded,
 * server-side-filtered query (docs/IMPLEMENTATION_PLAN.md "Phase 6C" §17/§25/§39), not "load
 * every contact and filter in memory." Backs the /network page's "Follow-ups due" section.
 * `now` is injected by the caller (never read internally via `new Date()`), the same
 * pure-function-friendly posture as `deriveNetworkingNextAction` itself — this query and that
 * pure engine must always agree on what "due" means, so both take the same `now` from the same
 * caller-computed value.
 */
export async function listOwnContactsWithDueFollowUp(
  supabase: CareerOsSupabaseClient,
  userId: string,
  now: string,
): Promise<Contact[]> {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .not('follow_up_at', 'is', null)
    .lte('follow_up_at', now)
    .order('follow_up_at', { ascending: true });
  assertNoError(error, 'listOwnContactsWithDueFollowUp');
  return (data ?? []).map(rowToContact);
}
