'use client';

import {
  APPLICATION_CONTACT_ROLES,
  type ApplicationContactRole,
  type Contact,
} from '@career-os/shared';
import { Button, Input, Select } from '@career-os/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatEnumLabel } from '../network/contact-tag-badges';
import { linkContactToApplicationAction, searchOwnContactsAction } from '../network/actions';

/**
 * The application People section's "link existing contact" picker
 * (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §20) — searches the user's own contacts (reusing
 * /network's own search action, not a second implementation) rather than listing every contact
 * up front.
 */
export function LinkExistingContactForm({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [role, setRole] = useState<ApplicationContactRole>(APPLICATION_CONTACT_ROLES[0]);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [linking, startLink] = useTransition();

  function search() {
    startSearch(async () => {
      const contacts = await searchOwnContactsAction(query);
      setResults(contacts);
      setSelectedContactId(contacts[0]?.id ?? null);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your contacts"
          className="max-w-xs"
        />
        <Button type="button" variant="outline" size="sm" disabled={searching} onClick={search}>
          {searching ? 'Searching…' : 'Search'}
        </Button>
      </div>

      {results.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <Select
            value={selectedContactId ?? ''}
            onChange={(e) => setSelectedContactId(e.target.value)}
          >
            {results.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
                {c.currentCompany ? ` — ${c.currentCompany}` : ''}
              </option>
            ))}
          </Select>
          <Select value={role} onChange={(e) => setRole(e.target.value as ApplicationContactRole)}>
            {APPLICATION_CONTACT_ROLES.map((r) => (
              <option key={r} value={r}>
                {formatEnumLabel(r)}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            size="sm"
            disabled={linking || !selectedContactId}
            onClick={() => {
              if (!selectedContactId) return;
              setError(null);
              startLink(async () => {
                const result = await linkContactToApplicationAction(
                  applicationId,
                  selectedContactId,
                  role,
                );
                if (result.status === 'error') {
                  setError(result.message);
                  return;
                }
                router.refresh();
              });
            }}
          >
            {linking ? 'Linking…' : 'Link'}
          </Button>
        </div>
      ) : null}

      {!searching && results.length === 0 && query ? (
        <p className="text-muted-foreground text-sm">No matching contacts.</p>
      ) : null}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
