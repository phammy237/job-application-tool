import { Input, Label, Select, Textarea } from '@career-os/ui';
import { ActionForm } from '../_components/action-form';
import { Collapsible } from '../_components/collapsible';
import { Mutation } from '../_components/page-header';
import {
  addAchievementEvidenceAction,
  linkAchievementEvidenceAction,
  markAchievementVerifiedAction,
} from './actions';

export interface EvidenceOption {
  id: string;
  label: string;
}

/**
 * "Supporting evidence" control for one achievement. A metric or claim can only be marked
 * verified after at least one evidence item is linked; marking it records YOUR confirmation that
 * the linked evidence backs the claim. Nothing here checks the evidence externally.
 */
export function AchievementSupport({
  achievementId,
  evidenceCount,
  verified,
  options,
  readOnly,
}: {
  achievementId: string;
  evidenceCount: number;
  verified: boolean;
  /** Evidence not yet linked to this achievement. */
  options: EvidenceOption[];
  readOnly?: boolean;
}) {
  return (
    <Collapsible
      title="Supporting evidence"
      count={evidenceCount}
      headingLevel={null}
      variant="row"
      className="bg-background"
      summary={
        verified
          ? 'Marked verified'
          : evidenceCount === 0
            ? 'Needs evidence before it can be marked verified'
            : undefined
      }
    >
      <Mutation readOnly={readOnly} className="space-y-3">
        <p className="text-muted-foreground text-xs">
          Link a note, article, or document that backs this achievement. Verifying records
          your confirmation that the linked evidence supports it; it is not checked
          externally.
        </p>

        {options.length > 0 ? (
          <ActionForm
            action={linkAchievementEvidenceAction}
            submitLabel="Link evidence"
            size="sm"
            variant="outline"
          >
            <input type="hidden" name="id" value={achievementId} />
            <Label htmlFor={`ev-pick-${achievementId}`}>Existing evidence</Label>
            <Select
              id={`ev-pick-${achievementId}`}
              name="evidenceId"
              defaultValue=""
              required
            >
              <option value="" disabled>
                Choose evidence…
              </option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </ActionForm>
        ) : null}

        <ActionForm
          action={addAchievementEvidenceAction}
          submitLabel="Add and link evidence"
          size="sm"
          variant="outline"
          resetOnSuccess
        >
          <input type="hidden" name="id" value={achievementId} />
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor={`ev-title-${achievementId}`}>New evidence title</Label>
              <Input
                id={`ev-title-${achievementId}`}
                name="title"
                required
                maxLength={300}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ev-url-${achievementId}`}>Link</Label>
              <Input
                id={`ev-url-${achievementId}`}
                name="sourceUrl"
                type="url"
                maxLength={500}
                placeholder="https://"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`ev-note-${achievementId}`}>Note</Label>
              <Textarea
                id={`ev-note-${achievementId}`}
                name="excerpt"
                rows={2}
                maxLength={2000}
              />
            </div>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            Provide a note, a link, or both.
          </p>
        </ActionForm>

        {verified ? (
          <p className="text-xs">Marked verified.</p>
        ) : (
          <ActionForm
            action={markAchievementVerifiedAction}
            submitLabel="Mark verified"
            size="sm"
            confirmMessage="Mark this achievement verified? This records your confirmation that the linked evidence supports it."
          >
            <input type="hidden" name="id" value={achievementId} />
            {evidenceCount === 0 ? (
              <p className="text-muted-foreground text-xs">
                Needs at least one evidence item first.
              </p>
            ) : null}
          </ActionForm>
        )}
      </Mutation>
    </Collapsible>
  );
}
