'use client';

import {
  APPLICATION_CONTACT_ROLES,
  CONTACT_TAGS,
  type ApplicationContactRole,
  type ContactSource,
  type ContactTag,
  type PossibleDuplicateContact,
} from '@career-os/shared';
import { Button, Input, Label, Select, Textarea } from '@career-os/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import { type ContactFormResult, createContactAction, updateContactAction } from './actions';
import { formatEnumLabel } from './contact-tag-badges';

export interface ContactFormInitialValues {
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  currentCompany: string | null;
  currentTitle: string | null;
  location: string | null;
  notes: string | null;
}

type FormState =
  | { kind: 'editing' }
  | { kind: 'submitting' }
  | {
      kind: 'possible_duplicates';
      duplicates: PossibleDuplicateContact[];
      pendingInput: Record<string, unknown>;
    }
  | { kind: 'error'; message: string };

interface ContactFormProps {
  mode: 'create' | 'edit';
  /** Required for mode "edit". */
  contactId?: string;
  initialValues?: ContactFormInitialValues;
  initialTags?: ContactTag[];
  /** Only meaningful for mode "create" — defaults to MANUAL (the /network "Add contact" form).
   * The application People section's "Add new contact" panel passes APPLICATION_CONTEXT. */
  source?: ContactSource;
  /** When set (mode "create" only), the new contact is linked to this application immediately
   * after creation, with a role the form itself lets the user choose
   * (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §19). */
  linkToApplicationId?: string;
  submitLabel?: string;
  onSuccess?: () => void;
}

/**
 * Shared create/edit form for /network's "Add contact", the application People section's
 * "Add new contact", and /network/[id]'s edit panel. Duplicate detection runs before every
 * save (docs/IMPLEMENTATION_PLAN.md "Phase 6A" §12/§15/§17): the server action checks first and
 * this component shows the results, letting the user cancel or "Create/Save anyway" — never
 * auto-merging or silently reusing an existing contact.
 */
export function ContactForm({
  mode,
  contactId,
  initialValues,
  initialTags = [],
  source,
  linkToApplicationId,
  submitLabel,
  onSuccess,
}: ContactFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<FormState>({ kind: 'editing' });
  const [role, setRole] = useState<ApplicationContactRole>(APPLICATION_CONTACT_ROLES[0]);

  function readForm(): Record<string, unknown> {
    const form = formRef.current;
    if (!form) return {};
    const data = new FormData(form);
    return {
      displayName: data.get('displayName') ?? '',
      firstName: data.get('firstName') ?? '',
      lastName: data.get('lastName') ?? '',
      email: data.get('email') ?? '',
      phone: data.get('phone') ?? '',
      linkedinUrl: data.get('linkedinUrl') ?? '',
      currentCompany: data.get('currentCompany') ?? '',
      currentTitle: data.get('currentTitle') ?? '',
      location: data.get('location') ?? '',
      notes: data.get('notes') ?? '',
      tags: data.getAll('tags'),
      ...(mode === 'create' ? { source: source ?? 'MANUAL' } : {}),
    };
  }

  async function submit(input: Record<string, unknown>, force: boolean) {
    setState({ kind: 'submitting' });
    const result: ContactFormResult =
      mode === 'create'
        ? await createContactAction(input, {
            force,
            linkToApplication: linkToApplicationId
              ? { applicationId: linkToApplicationId, role }
              : undefined,
          })
        : await updateContactAction(contactId as string, input, { force });

    if (result.status === 'ok') {
      setState({ kind: 'editing' });
      formRef.current?.reset();
      router.refresh();
      onSuccess?.();
      if (mode === 'create' && !linkToApplicationId) {
        router.push(`/network/${result.contactId}`);
      }
      return;
    }
    if (result.status === 'possible_duplicates') {
      setState({
        kind: 'possible_duplicates',
        duplicates: result.duplicates,
        pendingInput: input,
      });
      return;
    }
    setState({ kind: 'error', message: result.message });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(readForm(), false);
  }

  const submitting = state.kind === 'submitting';

  if (state.kind === 'possible_duplicates') {
    return (
      <div className="border-border space-y-3 rounded-md border border-dashed p-4">
        <p className="text-sm font-medium">This may already exist</p>
        <ul className="space-y-2">
          {state.duplicates.map((d) => (
            <li key={`${d.contact.id}-${d.reason}`} className="text-sm">
              <Link
                href={`/network/${d.contact.id}`}
                className="font-medium hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {d.contact.displayName}
              </Link>
              {d.contact.currentCompany ? ` · ${d.contact.currentCompany}` : ''}
              <span className="text-muted-foreground ml-2 text-xs">
                {formatEnumLabel(d.reason)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={submitting}
            onClick={() => void submit(state.pendingInput, true)}
          >
            {submitting ? 'Saving…' : mode === 'create' ? 'Create anyway' : 'Save anyway'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={submitting}
            onClick={() => setState({ kind: 'editing' })}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${mode}-displayName`}>Name *</Label>
        <Input
          id={`${mode}-displayName`}
          name="displayName"
          required
          defaultValue={initialValues?.displayName}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-firstName`}>First name</Label>
        <Input
          id={`${mode}-firstName`}
          name="firstName"
          defaultValue={initialValues?.firstName ?? ''}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-lastName`}>Last name</Label>
        <Input
          id={`${mode}-lastName`}
          name="lastName"
          defaultValue={initialValues?.lastName ?? ''}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-email`}>Email</Label>
        <Input
          id={`${mode}-email`}
          name="email"
          type="email"
          defaultValue={initialValues?.email ?? ''}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-phone`}>Phone</Label>
        <Input id={`${mode}-phone`} name="phone" defaultValue={initialValues?.phone ?? ''} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-linkedinUrl`}>LinkedIn</Label>
        <Input
          id={`${mode}-linkedinUrl`}
          name="linkedinUrl"
          defaultValue={initialValues?.linkedinUrl ?? ''}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-currentCompany`}>Company</Label>
        <Input
          id={`${mode}-currentCompany`}
          name="currentCompany"
          defaultValue={initialValues?.currentCompany ?? ''}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-currentTitle`}>Title</Label>
        <Input
          id={`${mode}-currentTitle`}
          name="currentTitle"
          defaultValue={initialValues?.currentTitle ?? ''}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${mode}-location`}>Location</Label>
        <Input
          id={`${mode}-location`}
          name="location"
          defaultValue={initialValues?.location ?? ''}
        />
      </div>

      {linkToApplicationId ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${mode}-role`}>Role on this application</Label>
          <Select
            id={`${mode}-role`}
            value={role}
            onChange={(e) => setRole(e.target.value as ApplicationContactRole)}
          >
            {APPLICATION_CONTACT_ROLES.map((r) => (
              <option key={r} value={r}>
                {formatEnumLabel(r)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      <div className="space-y-1.5 sm:col-span-2">
        <Label>Tags</Label>
        <div className="flex flex-wrap gap-3">
          {CONTACT_TAGS.map((tag) => (
            <label key={tag} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="tags"
                value={tag}
                defaultChecked={initialTags.includes(tag)}
              />
              {formatEnumLabel(tag)}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${mode}-notes`}>Notes</Label>
        <Textarea
          id={`${mode}-notes`}
          name="notes"
          rows={3}
          defaultValue={initialValues?.notes ?? ''}
        />
      </div>

      {state.kind === 'error' ? (
        <p className="text-destructive text-sm sm:col-span-2">{state.message}</p>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={submitting}>
          {submitting
            ? 'Saving…'
            : (submitLabel ?? (mode === 'create' ? 'Add contact' : 'Save changes'))}
        </Button>
      </div>
    </form>
  );
}
