import { listOwnApplicationContacts, type CareerOsSupabaseClient } from '@career-os/database';
import Link from 'next/link';
import { formatEnumLabel } from '../network/contact-tag-badges';
import { ContactForm } from '../network/contact-form';
import { UnlinkButton } from '../network/unlink-button';
import { LinkExistingContactForm } from './link-existing-contact-form';

/**
 * The application detail page's "People" section (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §19) —
 * server component reading directly off the already-available session-scoped client, same
 * pattern as SubmissionPacketSection. Deliberately shows only what Phase 6A actually has:
 * linked contacts and their role on this application — no interaction timeline, coffee-chat
 * prep, or outreach drafting (those are later Phase 6 slices).
 */
export async function PeopleSection({
  supabase,
  userId,
  applicationId,
  company,
}: {
  supabase: CareerOsSupabaseClient;
  userId: string;
  applicationId: string;
  company: string;
}) {
  const contacts = await listOwnApplicationContacts(supabase, userId, applicationId);

  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-sm font-medium">People</h2>

      <ul className="space-y-2">
        {contacts.map(({ contact, role }) => (
          <li
            key={`${contact.id}-${role}`}
            className="border-border flex items-center justify-between rounded-md border px-3 py-2 text-sm"
          >
            <span className="flex items-center gap-2">
              <Link
                href={`/network/${contact.id}`}
                className="hover:text-primary font-medium hover:underline"
              >
                {contact.displayName}
              </Link>
              {contact.currentTitle || contact.currentCompany ? (
                <span className="text-muted-foreground">
                  {[contact.currentTitle, contact.currentCompany].filter(Boolean).join(' at ')}
                </span>
              ) : null}
              <span className="text-muted-foreground text-xs">{formatEnumLabel(role)}</span>
            </span>
            <UnlinkButton applicationId={applicationId} contactId={contact.id} role={role} />
          </li>
        ))}
        {contacts.length === 0 ? (
          <p className="text-muted-foreground text-sm">No people linked to this application yet.</p>
        ) : null}
      </ul>

      <details className="border-border rounded-lg border border-dashed p-3">
        <summary className="cursor-pointer text-sm font-medium">Link existing contact</summary>
        <div className="mt-3">
          <LinkExistingContactForm applicationId={applicationId} />
        </div>
      </details>

      <details className="border-border rounded-lg border border-dashed p-3">
        <summary className="cursor-pointer text-sm font-medium">Add new contact</summary>
        <div className="mt-3">
          <ContactForm
            mode="create"
            source="APPLICATION_CONTEXT"
            linkToApplicationId={applicationId}
            initialValues={{
              displayName: '',
              firstName: null,
              lastName: null,
              email: null,
              phone: null,
              linkedinUrl: null,
              currentCompany: company,
              currentTitle: null,
              location: null,
              notes: null,
            }}
          />
        </div>
      </details>
    </section>
  );
}
