import {
  listOwnContactInteractions,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import Link from 'next/link';
import { DeleteInteractionButton } from '../delete-interaction-button';
import { formatEnumLabel } from '../contact-tag-badges';
import { InteractionForm, type InteractionApplicationOption } from '../interaction-form';

/**
 * "What history do I have with this person?" (docs/IMPLEMENTATION_PLAN.md "Phase 6B") — a
 * reverse-chronological, factual record of manual interactions. Server component reading
 * directly off the already-available session-scoped client, same pattern as `PeopleSection`.
 * Deliberately shows only what Phase 6B actually has: type, date/time, direction, subject,
 * notes, and related application — no follow-up suggestion, reminder, priority, or AI summary
 * (those are later Phase 6 slices).
 */
export async function InteractionTimeline({
  supabase,
  userId,
  contactId,
  linkedApplications,
}: {
  supabase: CareerOsSupabaseClient;
  userId: string;
  contactId: string;
  linkedApplications: InteractionApplicationOption[];
}) {
  const interactions = await listOwnContactInteractions(supabase, userId, contactId);
  const applicationById = new Map(linkedApplications.map((a) => [a.id, a]));

  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-sm font-medium">Interaction history</h2>

      <ul className="space-y-2">
        {interactions.map((interaction) => {
          const relatedApp = interaction.applicationId
            ? (applicationById.get(interaction.applicationId) ?? null)
            : null;
          return (
            <li
              key={interaction.id}
              className="border-border space-y-2 rounded-md border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {formatEnumLabel(interaction.interactionType)}
                </span>
                {interaction.direction ? (
                  <span className="text-muted-foreground text-xs">
                    {formatEnumLabel(interaction.direction)}
                  </span>
                ) : null}
                <span className="text-muted-foreground text-xs">
                  {new Date(interaction.occurredAt).toLocaleString()}
                </span>
              </div>

              {interaction.subject ? (
                <p className="font-medium">{interaction.subject}</p>
              ) : null}
              {interaction.notes ? (
                <p className="text-muted-foreground whitespace-pre-wrap">
                  {interaction.notes}
                </p>
              ) : null}
              {relatedApp ? (
                <p>
                  Related application:{' '}
                  <Link
                    href={`/applications/${relatedApp.id}`}
                    className="hover:text-primary font-medium hover:underline"
                  >
                    {relatedApp.title} — {relatedApp.company}
                  </Link>
                </p>
              ) : null}

              <div className="flex items-center gap-3">
                <details>
                  <summary className="text-muted-foreground cursor-pointer text-xs">
                    Edit
                  </summary>
                  <div className="mt-2">
                    <InteractionForm
                      mode="edit"
                      contactId={contactId}
                      interactionId={interaction.id}
                      linkedApplications={linkedApplications}
                      initialValues={{
                        interactionType: interaction.interactionType,
                        occurredAt: interaction.occurredAt,
                        direction: interaction.direction,
                        subject: interaction.subject,
                        notes: interaction.notes,
                        applicationId: interaction.applicationId,
                      }}
                    />
                  </div>
                </details>
                <DeleteInteractionButton
                  contactId={contactId}
                  interactionId={interaction.id}
                />
              </div>
            </li>
          );
        })}
        {interactions.length === 0 ? (
          <li className="text-muted-foreground space-y-1 text-sm">
            <p>No interactions logged yet.</p>
            <p className="text-xs">
              Record calls, coffee chats, LinkedIn messages, meetings, and more.
            </p>
          </li>
        ) : null}
      </ul>

      <details className="border-border rounded-lg border border-dashed p-4">
        <summary className="cursor-pointer text-sm font-medium">Log interaction</summary>
        <div className="mt-4">
          <InteractionForm
            mode="create"
            contactId={contactId}
            linkedApplications={linkedApplications}
          />
        </div>
      </details>
    </section>
  );
}
