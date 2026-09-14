import {
  getOwnContact,
  listOwnApplications,
  listOwnApplicationsForContact,
  listOwnContactTags,
} from '@career-os/database';
import { deriveNetworkingNextAction } from '@career-os/shared';
import { StatusBadge } from '@career-os/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { ContactForm } from '../contact-form';
import { ContactTagBadges, formatEnumLabel } from '../contact-tag-badges';
import { DeleteContactButton } from '../delete-contact-button';
import { UnlinkButton } from '../unlink-button';
import { FollowUpReminderControls } from './follow-up-reminder-controls';
import { InteractionTimeline } from './interaction-timeline';
import { LinkApplicationForm } from './link-application-form';

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const contact = await getOwnContact(supabase, user.id, id);
  if (!contact) {
    notFound();
  }

  const [tags, linkedApplications, allApplications] = await Promise.all([
    listOwnContactTags(supabase, user.id, id),
    listOwnApplicationsForContact(supabase, user.id, id),
    listOwnApplications(supabase, user.id),
  ]);

  // Phase 6C: derived, never persisted — the same read-time posture as the Phase 5C application
  // next-action engine, for the same synchronization reasons (docs/IMPLEMENTATION_PLAN.md
  // "Phase 6C" §6).
  const now = new Date().toISOString();
  const networkingNextAction = deriveNetworkingNextAction({ followUpAt: contact.followUpAt, now });

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{contact.displayName}</h1>
          <p className="text-muted-foreground mt-1">
            {[contact.currentTitle, contact.currentCompany]
              .filter(Boolean)
              .join(' at ') || null}
            {contact.location ? ` · ${contact.location}` : ''}
          </p>
        </div>
      </div>

      <section className="space-y-2">
        {contact.followUpAt ? (
          <p className="text-sm">
            {networkingNextAction.type === 'FOLLOW_UP_WITH_CONTACT'
              ? 'Follow-up reminder due: '
              : 'Follow up on '}
            {new Date(contact.followUpAt).toLocaleString()}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">No follow-up reminder set.</p>
        )}
        <FollowUpReminderControls
          contactId={contact.id}
          followUpAt={contact.followUpAt}
          isDue={networkingNextAction.type === 'FOLLOW_UP_WITH_CONTACT'}
        />
      </section>

      <ContactTagBadges tags={tags} />

      <section className="space-y-2">
        <h2 className="text-muted-foreground text-sm font-medium">Contact info</h2>
        <div className="space-y-1 text-sm">
          {contact.email ? <p>Email: {contact.email}</p> : null}
          {contact.phone ? <p>Phone: {contact.phone}</p> : null}
          {contact.linkedinUrl ? (
            <p>
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary underline"
              >
                LinkedIn
              </a>
            </p>
          ) : null}
          {!contact.email && !contact.phone && !contact.linkedinUrl ? (
            <p className="text-muted-foreground">No contact info on file.</p>
          ) : null}
        </div>
      </section>

      {contact.notes ? (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium">Notes</h2>
          <p className="whitespace-pre-wrap text-sm">{contact.notes}</p>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">Linked applications</h2>
        <ul className="space-y-2">
          {linkedApplications.map(({ application, role }) => (
            <li
              key={`${application.id}-${role}`}
              className="border-border flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <Link
                  href={`/applications/${application.id}`}
                  className="hover:text-primary font-medium hover:underline"
                >
                  {application.company} — {application.title}
                </Link>
                <StatusBadge status={application.status} />
                <span className="text-muted-foreground text-xs">
                  {formatEnumLabel(role)}
                </span>
              </span>
              <UnlinkButton
                applicationId={application.id}
                contactId={contact.id}
                role={role}
              />
            </li>
          ))}
          {linkedApplications.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Not linked to any applications yet.
            </p>
          ) : null}
        </ul>
        <LinkApplicationForm
          contactId={contact.id}
          applications={allApplications.map((a) => ({
            id: a.id,
            company: a.company,
            title: a.title,
            status: a.status,
          }))}
        />
      </section>

      <InteractionTimeline
        supabase={supabase}
        userId={user.id}
        contactId={contact.id}
        linkedApplications={linkedApplications.map(({ application }) => ({
          id: application.id,
          company: application.company,
          title: application.title,
        }))}
      />

      <details className="border-border rounded-lg border border-dashed p-4">
        <summary className="cursor-pointer text-sm font-medium">Edit contact</summary>
        <div className="mt-4">
          <ContactForm
            mode="edit"
            contactId={contact.id}
            initialValues={{
              displayName: contact.displayName,
              firstName: contact.firstName,
              lastName: contact.lastName,
              email: contact.email,
              phone: contact.phone,
              linkedinUrl: contact.linkedinUrl,
              currentCompany: contact.currentCompany,
              currentTitle: contact.currentTitle,
              location: contact.location,
              notes: contact.notes,
            }}
            initialTags={tags}
          />
        </div>
      </details>

      <section className="border-border border-t pt-6">
        <DeleteContactButton id={contact.id} displayName={contact.displayName} />
      </section>
    </div>
  );
}
