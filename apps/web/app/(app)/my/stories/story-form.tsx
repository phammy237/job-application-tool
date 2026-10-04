'use client';

import { COMPETENCIES, type MyosStory } from '@career-os/shared';
import { Input, Label, Select, Textarea } from '@career-os/ui';
import { ActionForm } from '../_components/action-form';
import { createStoryAction, updateStoryAction } from './actions';
import { competencyLabel, STAR_PROMPTS } from './helpers';

export interface LinkOption {
  id: string;
  label: string;
}

interface StoryFormProps {
  story?: MyosStory;
  projects: LinkOption[];
  experiences: LinkOption[];
  evidence: LinkOption[];
  selectedProjectIds?: string[];
  selectedExperienceIds?: string[];
  selectedEvidenceIds?: string[];
  idPrefix?: string;
}

function CheckboxGroup({
  legend,
  name,
  options,
  selected,
  idPrefix,
  emptyText,
}: {
  legend: string;
  name: string;
  options: LinkOption[];
  selected: string[];
  idPrefix: string;
  emptyText: string;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-muted-foreground text-xs">{emptyText}</p>
      ) : (
        <div className="border-border max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
          {options.map((o) => (
            <label key={o.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name={name}
                value={o.id}
                defaultChecked={selected.includes(o.id)}
                id={`${idPrefix}-${name}-${o.id}`}
                className="focus-visible:ring-ring mt-0.5 h-4 w-4 shrink-0 rounded focus-visible:outline-none focus-visible:ring-2"
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** Create/edit form for a STAR story. Submits to the server actions; no server packages here. */
export function StoryForm({
  story,
  projects,
  experiences,
  evidence,
  selectedProjectIds = [],
  selectedExperienceIds = [],
  selectedEvidenceIds = [],
  idPrefix = 'story',
}: StoryFormProps) {
  const fields = [
    { name: 'situation', value: story?.situation },
    { name: 'task', value: story?.task },
    { name: 'action', value: story?.action },
    { name: 'result', value: story?.result },
  ] as const;

  return (
    <ActionForm
      action={story ? updateStoryAction : createStoryAction}
      submitLabel={story ? 'Save changes' : 'Save story'}
      resetOnSuccess={!story}
    >
      {story ? <input type="hidden" name="id" value={story.id} /> : null}
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-title`}>Title</Label>
          <Input
            id={`${idPrefix}-title`}
            name="title"
            required
            maxLength={300}
            defaultValue={story?.title ?? ''}
          />
        </div>

        {fields.map((f, i) => (
          <div key={f.name} className="space-y-1">
            <Label htmlFor={`${idPrefix}-${f.name}`}>{STAR_PROMPTS[i]!.label}</Label>
            <Textarea
              id={`${idPrefix}-${f.name}`}
              name={f.name}
              rows={3}
              maxLength={4000}
              defaultValue={f.value ?? ''}
              aria-describedby={`${idPrefix}-${f.name}-hint`}
            />
            <p
              id={`${idPrefix}-${f.name}-hint`}
              className="text-muted-foreground text-xs"
            >
              {STAR_PROMPTS[i]!.prompt}
            </p>
          </div>
        ))}

        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Competencies this story shows</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {COMPETENCIES.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="competencies"
                  value={c}
                  defaultChecked={story?.competencies.includes(c) ?? false}
                  className="focus-visible:ring-ring h-4 w-4 rounded focus-visible:outline-none focus-visible:ring-2"
                />
                {competencyLabel(c)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-themes`}>Themes (comma-separated, optional)</Label>
          <Input
            id={`${idPrefix}-themes`}
            name="themes"
            defaultValue={story?.themes.join(', ') ?? ''}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <CheckboxGroup
            legend="Projects"
            name="projectIds"
            options={projects}
            selected={selectedProjectIds}
            idPrefix={idPrefix}
            emptyText="No projects yet."
          />
          <CheckboxGroup
            legend="Experience"
            name="experienceIds"
            options={experiences}
            selected={selectedExperienceIds}
            idPrefix={idPrefix}
            emptyText="No experience yet."
          />
          <CheckboxGroup
            legend="Evidence"
            name="evidenceIds"
            options={evidence}
            selected={selectedEvidenceIds}
            idPrefix={idPrefix}
            emptyText="No evidence yet."
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${idPrefix}-visibility`}>Visibility</Label>
            <Select
              id={`${idPrefix}-visibility`}
              name="visibility"
              defaultValue={story?.visibility ?? 'PRIVATE'}
            >
              <option value="PRIVATE">Private</option>
              <option value="CAREER_OS_ONLY">Career OS only</option>
              <option value="PUBLIC">Public</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              name="userApproved"
              defaultChecked={story?.userApproved ?? false}
              className="focus-visible:ring-ring h-4 w-4 rounded focus-visible:outline-none focus-visible:ring-2"
            />
            Ready for interviews (I confirm this is accurate)
          </label>
        </div>
      </div>
    </ActionForm>
  );
}
