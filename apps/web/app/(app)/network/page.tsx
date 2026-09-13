import {
  countOwnApplicationLinksForContacts,
  listOwnContactTagsForContacts,
  listOwnContacts,
} from '@career-os/database';
import { Input, Label } from '@career-os/ui';
import Link from 'next/link';
import { requireUser } from '../../../lib/auth';
import { createClient } from '../../../lib/supabase/server';
import { ContactForm } from './contact-form';
import { ContactTagBadges } from './contact-tag-badges';

export default async function NetworkPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();

  const contacts = await listOwnContacts(supabase, user.id, { search: q || undefined });
  const contactIds = contacts.map((c) => c.id);

  // Phase 6A §32 N+1 review: both of these are single batched queries across every contact on
  // this page, not one query per row.
  const [tagsByContact, applicationCountByContact] = await Promise.all([
    listOwnContactTagsForContacts(supabase, user.id, contactIds),
    countOwnApplicationLinksForContacts(supabase, user.id, contactIds),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Network</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {contacts.length} contact{contacts.length === 1 ? '' : 's'}
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="space-y-1.5">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" defaultValue={q ?? ''} placeholder="Name, company, title, or email" />
        </div>
      </form>

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
            </tr>
          </thead>
          <tbody>
            {contacts.map((contact) => (
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
              </tr>
            ))}
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-4 py-8 text-center">
                  {q
                    ? 'No contacts match your search.'
                    : "No contacts yet. Add the first person you're networking with."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
