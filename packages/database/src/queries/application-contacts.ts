import {
  applicationContactRoleSchema,
  applicationStatusSchema,
  type ApplicationContactRole,
  type ApplicationStatus,
  type Contact,
} from '@career-os/shared';
import { DatabaseError, assertNoError } from '../errors';
import type { CareerOsSupabaseClient } from '../types/client';
import { getOwnContact, rowToContact } from './contacts';

/**
 * A minimal, display-only projection of an application — deliberately not the full
 * `Application` domain type (`applicationSchema` requires many fields no caller of this module
 * needs; a full parse here would be validating data this module never uses).
 */
export interface LinkedApplicationSummary {
  id: string;
  company: string;
  title: string;
  status: ApplicationStatus;
}

export interface ContactWithApplicationRole {
  contact: Contact;
  role: ApplicationContactRole;
  createdAt: string;
}

export interface ApplicationWithContactRole {
  application: LinkedApplicationSummary;
  role: ApplicationContactRole;
  createdAt: string;
}

/**
 * Contacts linked to one application — the application detail page's "People" section
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §19). Two queries, not a join: fetch the link rows,
 * then fetch the (typically few) distinct contacts they reference in one `in(...)` call — never
 * one contact query per link row.
 */
export async function listOwnApplicationContacts(
  supabase: CareerOsSupabaseClient,
  userId: string,
  applicationId: string,
): Promise<ContactWithApplicationRole[]> {
  const { data: links, error } = await supabase
    .from('application_contacts')
    .select('contact_id, role, created_at')
    .eq('user_id', userId)
    .eq('application_id', applicationId)
    .order('created_at', { ascending: true });
  assertNoError(error, 'listOwnApplicationContacts');
  if (!links || links.length === 0) return [];

  const contactIds = [...new Set(links.map((l) => l.contact_id))];
  const { data: contactRows, error: contactError } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .in('id', contactIds);
  assertNoError(contactError, 'listOwnApplicationContacts (contacts)');

  const contactsById = new Map<string, Contact>();
  for (const row of contactRows ?? []) {
    contactsById.set(row.id, rowToContact(row));
  }

  return links
    .map((link) => {
      const contact = contactsById.get(link.contact_id);
      if (!contact) return null;
      return {
        contact,
        role: applicationContactRoleSchema.parse(link.role),
        createdAt: link.created_at,
      };
    })
    .filter((v): v is ContactWithApplicationRole => v !== null);
}

/**
 * Applications linked to one contact — the contact detail page's "linked applications" section
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §16). Same two-query shape as
 * `listOwnApplicationContacts`, reversed.
 */
export async function listOwnApplicationsForContact(
  supabase: CareerOsSupabaseClient,
  userId: string,
  contactId: string,
): Promise<ApplicationWithContactRole[]> {
  const { data: links, error } = await supabase
    .from('application_contacts')
    .select('application_id, role, created_at')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true });
  assertNoError(error, 'listOwnApplicationsForContact');
  if (!links || links.length === 0) return [];

  const applicationIds = [...new Set(links.map((l) => l.application_id))];
  const { data: appRows, error: appError } = await supabase
    .from('applications')
    .select('id, company, title, status')
    .eq('user_id', userId)
    .in('id', applicationIds);
  assertNoError(appError, 'listOwnApplicationsForContact (applications)');

  const appsById = new Map<string, LinkedApplicationSummary>();
  for (const row of appRows ?? []) {
    appsById.set(row.id, {
      id: row.id,
      company: row.company,
      title: row.title,
      status: applicationStatusSchema.parse(row.status),
    });
  }

  return links
    .map((link) => {
      const application = appsById.get(link.application_id);
      if (!application) return null;
      return {
        application,
        role: applicationContactRoleSchema.parse(link.role),
        createdAt: link.created_at,
      };
    })
    .filter((v): v is ApplicationWithContactRole => v !== null);
}

/**
 * Batched linked-application counts for a list of contacts in one query — the /network list
 * page's "linked-application count" column (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §13/§32);
 * never one count query per row. A contact with zero links is absent from the map.
 */
export async function countOwnApplicationLinksForContacts(
  supabase: CareerOsSupabaseClient,
  userId: string,
  contactIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (contactIds.length === 0) return result;

  const { data, error } = await supabase
    .from('application_contacts')
    .select('contact_id, application_id')
    .eq('user_id', userId)
    .in('contact_id', contactIds);
  assertNoError(error, 'countOwnApplicationLinksForContacts');

  // Grouped by distinct application per contact, not by link row — a contact can hold more than
  // one role on the same application (see the table's primary key), which must still count as
  // one linked application, not two.
  const distinctApplicationsByContact = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const set = distinctApplicationsByContact.get(row.contact_id) ?? new Set<string>();
    set.add(row.application_id);
    distinctApplicationsByContact.set(row.contact_id, set);
  }
  for (const [contactId, applicationIds] of distinctApplicationsByContact) {
    result.set(contactId, applicationIds.size);
  }
  return result;
}

export interface LinkContactToApplicationInput {
  applicationId: string;
  contactId: string;
  role: ApplicationContactRole;
}

/**
 * Links an existing contact to an application with a given role. Ownership of both sides is
 * enforced structurally by the composite FKs added in migration 0017 — a cross-user
 * application/contact pairing fails at the database level even if this function's own
 * `userId` scoping were somehow bypassed. The exact same (application, contact, role) link is
 * rejected by the table's primary key; this surfaces as a friendly `DatabaseError` rather than a
 * raw Postgres unique-violation message.
 */
export async function linkOwnContactToApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: LinkContactToApplicationInput,
): Promise<void> {
  const { error } = await supabase.from('application_contacts').insert({
    user_id: userId,
    application_id: input.applicationId,
    contact_id: input.contactId,
    role: input.role,
  });
  if (error) {
    if (error.code === '23505') {
      throw new DatabaseError(
        'This contact already has that role on this application.',
        error,
      );
    }
    throw new DatabaseError(`linkOwnContactToApplication: ${error.message}`, error);
  }
}

export async function unlinkOwnContactFromApplication(
  supabase: CareerOsSupabaseClient,
  userId: string,
  input: LinkContactToApplicationInput,
): Promise<void> {
  const { error } = await supabase
    .from('application_contacts')
    .delete()
    .eq('user_id', userId)
    .eq('application_id', input.applicationId)
    .eq('contact_id', input.contactId)
    .eq('role', input.role);
  assertNoError(error, 'unlinkOwnContactFromApplication');
}

/** Re-exported for callers that only have a contactId and need to confirm it exists/is owned
 * before linking (e.g. the "link existing contact" UI's search step). */
export { getOwnContact };
