import {
  countOwnApplicationLinksForContacts,
  listOwnContactTagsForContacts,
  listOwnContacts,
  listOwnContactsWithDueFollowUp,
} from '@career-os/database';
import { Input, Label, buttonVariants } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../lib/auth';
import { attachNetworkingNextActions } from '../../../lib/networking';
import { createClient } from '../../../lib/supabase/server';
import { ContactForm } from './contact-form';
import { ContactTagBadges } from './contact-tag-badges';

/** "Follow up today" when the reminder falls on today's calendar date, otherwise "Follow up
 * <month> <day>" (docs/IMPLEMENTATION_PLAN.md "Phase 6C" §18) — purely cosmetic date formatting,
 * done here (a server component) rather than in packages/shared, same posture as every other
 * displayed timestamp in this product. */
function formatFollowUpLabel(followUpAt: string, now: Date): string {
  const date = new Date(followUpAt);
  if (date.toDateString() === now.toDateString()) {
    return 'Follow up today';
  }
  return `Follow up ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export default async function NetworkPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const [contacts, dueContacts] = await Promise.all([
    listOwnContacts(supabase, user.id, { search: q || undefined }),
    // One bounded, server-filtered query (docs/IMPLEMENTATION_PLAN.md "Phase 6C" §17/§25/§39) —
    // never every contact loaded and filtered client-side.
    listOwnContactsWithDueFollowUp(supabase, user.id, nowIso),
  ]);
  const contactIds = contacts.map((c) => c.id);

  // Phase 6A §32 N+1 review: both of these are single batched queries across every contact on
  // this page, not one query per row.
  const [tagsByContact, applicationCountByContact] = await Promise.all([
    listOwnContactTagsForContacts(supabase, user.id, contactIds),
    countOwnApplicationLinksForContacts(supabase, user.id, contactIds),
  ]);

  // Derived, never persisted (docs/IMPLEMENTATION_PLAN.md "Phase 6C" §6) — computed in-memory
  // over the already-fetched list, not a second query.
  const contactsWithNextAction = attachNetworkingNextActions(contacts, nowIso);
  const nextActionByContact = new Map(
    contactsWithNextAction.map(({ contact, nextAction }) => [contact.id, nextAction]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Network</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {contacts.length} contact{contacts.length === 1 ? '' : 's'}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Follow-ups due</h2>
        {dueContacts.length === 0 ? (
          <p className="text-muted-foreground text-sm">No follow-ups due right now.</p>
        ) : (
          <ul className="space-y-2">
            {dueContacts.map((contact) => (
              <li
                key={contact.id}
                className="border-border flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <Link
                  href={`/network/${contact.id}`}
                  className="hover:text-primary font-medium hover:underline"
                >
                  {contact.displayName}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {formatFollowUpLabel(contact.followUpAt as string, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="space-y-1.5">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" defaultValue={q ?? ''} placeholder="Name, company, title, or email" />
        </div>
      </form>

      {contacts.length === 0 ? (
        <div className="border-border rounded-lg border border-dashed p-8 text-center">
          {q ? (
            <>
              <p className="font-medium">No contacts match your search.</p>
              <p className="text-muted-foreground mt-1 text-sm">Try a different search term.</p>
            </>
          ) : (
            <>
              <p className="font-medium">No contacts yet</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Track recruiters, referrals, and people related to your applications.
              </p>
              <details className="mt-4 inline-block text-left">
                <summary className={`${buttonVariants({ size: 'sm' })} cursor-pointer list-none`}>
                  Add contact
                </summary>
                <div className="mt-4">
                  <ContactForm mode="create" />
                </div>
              </details>
            </>
          )}
        </div>
      ) : (
        <>
          <details className="border-border rounded-lg border border-dashed p-4">
            <summary className="cursor-pointer text-sm font-medium">Add contact</summary>
            <div className="mt-4">
              <ContactForm mode="create" />
            </div>
          </details>

          <div className="border-border overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-border bg-muted/50 text-muted-foreground border-b text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Company / Title</th>
                  <th className="px-4 py-2 font-medium">Tags</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Applications</th>
                  <th className="px-4 py-2 font-medium">Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => {
                  const nextAction = nextActionByContact.get(contact.id);
                  return (
                    <tr key={contact.id} className="border-border border-b last:border-0">
                      <td className="px-4 py-3">
                        <Link
                          href={`/network/${contact.id}`}
                          className="hover:text-primary font-medium hover:underline"
                        >
                          {contact.displayName}
                        </Link>
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {[contact.currentTitle, contact.currentCompany].filter(Boolean).join(' at ') ||
                          '—'}
                      </td>
                      <td className="px-4 py-3">
                        <ContactTagBadges tags={tagsByContact.get(contact.id) ?? []} />
                      </td>
                      <td className="text-muted-foreground px-4 py-3">{contact.email ?? '—'}</td>
                      <td className="text-muted-foreground px-4 py-3">
                        {applicationCountByContact.get(contact.id) ?? 0}
                      </td>
                      <td className="px-4 py-3">
                        {contact.followUpAt ? (
                          <span
                            className={
                              nextAction?.type === 'FOLLOW_UP_WITH_CONTACT'
                                ? 'font-medium'
                                : 'text-muted-foreground'
                            }
                          >
                            {formatFollowUpLabel(contact.followUpAt, now)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No reminder</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
