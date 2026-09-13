'use server';

import {
  createOwnContact,
  deleteOwnContact,
  findOwnPossibleDuplicateContacts,
  linkOwnContactToApplication,
  listOwnContacts,
  unlinkOwnContactFromApplication,
  updateOwnContact,
} from '@career-os/database';
import {
  applicationContactRoleSchema,
  createContactInputSchema,
  updateContactInputSchema,
  type ApplicationContactRole,
  type Contact,
  type PossibleDuplicateContact,
} from '@career-os/shared';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../../lib/auth';
import { createClient } from '../../../lib/supabase/server';

export type ContactFormResult =
  | { status: 'ok'; contactId: string }
  | { status: 'possible_duplicates'; duplicates: PossibleDuplicateContact[] }
  | { status: 'error'; message: string };

/**
 * Backs both the /network "Add contact" form and the application People section's "Add new
 * contact" panel (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §12/§15) — a single duplicate-check-
 * then-create action, mirroring the shape of `markApplicationApplied`'s
 * check-then-confirm/`MarkAppliedPanel` pattern in ../applications/actions.ts. Duplicate
 * detection is advisory only: passing `force: true` (the UI's "Create anyway") always creates,
 * never blocks.
 *
 * `linkToApplication` optionally links the newly-created contact to one application in the same
 * action — used by the People section's "Add new contact" flow so a brand-new contact never
 * exists disconnected from the application context it was added from.
 */
export async function createContactAction(
  rawInput: unknown,
  options?: {
    force?: boolean;
    linkToApplication?: { applicationId: string; role: ApplicationContactRole };
  },
): Promise<ContactFormResult> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = createContactInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { status: 'error', message: 'Please check the form for errors.' };
  }
  const input = parsed.data;

  if (!options?.force) {
    const duplicates = await findOwnPossibleDuplicateContacts(supabase, user.id, {
      displayName: input.displayName,
      email: input.email,
      linkedinUrl: input.linkedinUrl,
      currentCompany: input.currentCompany,
    });
    if (duplicates.length > 0) {
      return { status: 'possible_duplicates', duplicates };
    }
  }

  const contact = await createOwnContact(supabase, user.id, input);

  if (options?.linkToApplication) {
    await linkOwnContactToApplication(supabase, user.id, {
      applicationId: options.linkToApplication.applicationId,
      contactId: contact.id,
      role: options.linkToApplication.role,
    });
    revalidatePath(`/applications/${options.linkToApplication.applicationId}`);
  }

  revalidatePath('/network');
  return { status: 'ok', contactId: contact.id };
}

/** Same duplicate-check-then-save shape as `createContactAction`, scoped to editing one existing
 * contact — `excludeContactId` keeps the contact from flagging itself as its own duplicate
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §17). */
export async function updateContactAction(
  contactId: string,
  rawInput: unknown,
  options?: { force?: boolean },
): Promise<ContactFormResult> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = updateContactInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { status: 'error', message: 'Please check the form for errors.' };
  }
  const input = parsed.data;

  if (!options?.force) {
    const duplicates = await findOwnPossibleDuplicateContacts(
      supabase,
      user.id,
      {
        displayName: input.displayName ?? '',
        email: input.email ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        currentCompany: input.currentCompany ?? null,
      },
      contactId,
    );
    if (duplicates.length > 0) {
      return { status: 'possible_duplicates', duplicates };
    }
  }

  await updateOwnContact(supabase, user.id, contactId, input);
  revalidatePath('/network');
  revalidatePath(`/network/${contactId}`);
  return { status: 'ok', contactId };
}

export async function deleteContactAction(contactId: string): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  await deleteOwnContact(supabase, user.id, contactId);
  revalidatePath('/network');
  redirect('/network');
}

/** Simple in-memory search over the caller's own contacts, for the "link existing contact"
 * picker on an application's People section (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §20) — reuses
 * `listOwnContacts`' own search filter rather than a second search implementation. */
export async function searchOwnContactsAction(query: string): Promise<Contact[]> {
  const user = await requireUser();
  const supabase = await createClient();
  return listOwnContacts(supabase, user.id, { search: query || undefined });
}

export async function linkContactToApplicationAction(
  applicationId: string,
  contactId: string,
  role: string,
): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  const user = await requireUser();
  const supabase = await createClient();
  const parsedRole = applicationContactRoleSchema.safeParse(role);
  if (!parsedRole.success) {
    return { status: 'error', message: 'Choose a valid role.' };
  }
  try {
    await linkOwnContactToApplication(supabase, user.id, {
      applicationId,
      contactId,
      role: parsedRole.data,
    });
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Could not link this contact.',
    };
  }
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/network/${contactId}`);
  return { status: 'ok' };
}

export async function unlinkContactFromApplicationAction(
  applicationId: string,
  contactId: string,
  role: string,
): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const parsedRole = applicationContactRoleSchema.parse(role);
  await unlinkOwnContactFromApplication(supabase, user.id, {
    applicationId,
    contactId,
    role: parsedRole,
  });
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/network/${contactId}`);
}
