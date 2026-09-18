'use client';

import { Button, Input } from '@career-os/ui';
import {
  PERSONAL_FIELD_LABELS,
  type CurrentProfile,
  type ExtractionState,
  type ReviewEntry,
} from './types';

export function ReviewScreen({
  extraction,
  pending,
  errorMessage,
  confirmLabel,
  pendingLabel,
  onChange,
  onConfirm,
  onCancel,
}: {
  extraction: ExtractionState;
  pending: boolean;
  errorMessage: string | null;
  confirmLabel: string;
  pendingLabel: string;
  onChange: (next: ExtractionState) => void;
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="space-y-8">
      {extraction.droppedCount > 0 ? (
        <p className="text-muted-foreground text-xs">
          {extraction.droppedCount} item(s) could not be confidently matched back to your
          résumé&apos;s actual text and were left out automatically.
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Personal</h2>
        {(Object.keys(extraction.personal) as (keyof CurrentProfile)[]).map((key) => {
          const field = extraction.personal[key];
          if (!field.resumeValue && !field.existingValue) return null;
          const hasConflict =
            !!field.resumeValue && !!field.existingValue && field.resumeValue !== field.existingValue;

          return (
            <div key={key} className="border-border rounded-lg border p-3">
              <p className="text-sm font-medium">{PERSONAL_FIELD_LABELS[key]}</p>
              {hasConflict ? (
                <div className="mt-2 space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    Existing value: <span className="text-foreground">{field.existingValue}</span>
                  </p>
                  <p className="text-muted-foreground">
                    Résumé value: <span className="text-foreground">{field.resumeValue}</span>
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={field.choice === 'keep_existing' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() =>
                        onChange({
                          ...extraction,
                          personal: {
                            ...extraction.personal,
                            [key]: { ...field, choice: 'keep_existing' },
                          },
                        })
                      }
                    >
                      Keep existing
                    </Button>
                    <Button
                      type="button"
                      variant={field.choice === 'use_resume' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() =>
                        onChange({
                          ...extraction,
                          personal: {
                            ...extraction.personal,
                            [key]: { ...field, choice: 'use_resume' },
                          },
                        })
                      }
                    >
                      Use résumé value
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    value={field.editedValue}
                    disabled={field.choice === 'exclude'}
                    onChange={(e) =>
                      onChange({
                        ...extraction,
                        personal: {
                          ...extraction.personal,
                          [key]: { ...field, editedValue: e.target.value },
                        },
                      })
                    }
                    className="max-w-sm"
                  />
                  <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={field.choice !== 'exclude'}
                      onChange={(e) =>
                        onChange({
                          ...extraction,
                          personal: {
                            ...extraction.personal,
                            [key]: { ...field, choice: e.target.checked ? 'use_resume' : 'exclude' },
                          },
                        })
                      }
                    />
                    Include
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <ReviewListSection
        title="Experience"
        entries={extraction.experience}
        onEntryChange={(index, entry) =>
          onChange({
            ...extraction,
            experience: extraction.experience.map((e, i) => (i === index ? entry : e)),
          })
        }
        renderView={(item) => (
          <>
            <p className="font-medium">
              {item.title} · {item.company}
            </p>
            <p className="text-muted-foreground text-xs">
              {[item.location, item.dateRangeText].filter(Boolean).join(' · ')}
              {item.uncertain ? ' · uncertain — please review' : ''}
            </p>
            {item.bullets.length > 0 ? (
              <ul className="mt-1 list-inside list-disc text-sm">
                {item.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        renderEdit={(item, onItemChange) => (
          <div className="grid gap-2 sm:grid-cols-2">
            <LabeledInput label="Company" value={item.company} onChange={(v) => onItemChange({ ...item, company: v })} />
            <LabeledInput label="Title" value={item.title} onChange={(v) => onItemChange({ ...item, title: v })} />
            <LabeledInput
              label="Location"
              value={item.location ?? ''}
              onChange={(v) => onItemChange({ ...item, location: v || null })}
            />
            <LabeledInput
              label="Dates"
              value={item.dateRangeText ?? ''}
              onChange={(v) => onItemChange({ ...item, dateRangeText: v || null })}
            />
            <LabeledTextarea
              label="Bullets (one per line)"
              className="sm:col-span-2"
              value={item.bullets.join('\n')}
              onChange={(v) => onItemChange({ ...item, bullets: v.split('\n').filter((b) => b.trim()) })}
            />
          </div>
        )}
      />

      <ReviewListSection
        title="Education"
        entries={extraction.education}
        onEntryChange={(index, entry) =>
          onChange({
            ...extraction,
            education: extraction.education.map((e, i) => (i === index ? entry : e)),
          })
        }
        renderView={(item) => (
          <>
            <p className="font-medium">{item.school}</p>
            <p className="text-muted-foreground text-xs">
              {[item.degree, item.fieldOfStudy, item.dateRangeText].filter(Boolean).join(' · ')}
              {item.uncertain ? ' · uncertain — please review' : ''}
            </p>
          </>
        )}
        renderEdit={(item, onItemChange) => (
          <div className="grid gap-2 sm:grid-cols-2">
            <LabeledInput label="School" value={item.school} onChange={(v) => onItemChange({ ...item, school: v })} />
            <LabeledInput
              label="Degree"
              value={item.degree ?? ''}
              onChange={(v) => onItemChange({ ...item, degree: v || null })}
            />
            <LabeledInput
              label="Field of study"
              value={item.fieldOfStudy ?? ''}
              onChange={(v) => onItemChange({ ...item, fieldOfStudy: v || null })}
            />
            <LabeledInput
              label="Dates"
              value={item.dateRangeText ?? ''}
              onChange={(v) => onItemChange({ ...item, dateRangeText: v || null })}
            />
            <LabeledInput label="GPA" value={item.gpa ?? ''} onChange={(v) => onItemChange({ ...item, gpa: v || null })} />
          </div>
        )}
      />

      <ReviewListSection
        title="Projects"
        entries={extraction.projects}
        onEntryChange={(index, entry) =>
          onChange({
            ...extraction,
            projects: extraction.projects.map((e, i) => (i === index ? entry : e)),
          })
        }
        renderView={(item) => (
          <>
            <p className="font-medium">{item.name}</p>
            <p className="text-muted-foreground text-xs">
              {[item.role, item.dateRangeText].filter(Boolean).join(' · ')}
              {item.uncertain ? ' · uncertain — please review' : ''}
            </p>
            {item.bullets.length > 0 ? (
              <ul className="mt-1 list-inside list-disc text-sm">
                {item.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        renderEdit={(item, onItemChange) => (
          <div className="grid gap-2 sm:grid-cols-2">
            <LabeledInput label="Name" value={item.name} onChange={(v) => onItemChange({ ...item, name: v })} />
            <LabeledInput
              label="Role"
              value={item.role ?? ''}
              onChange={(v) => onItemChange({ ...item, role: v || null })}
            />
            <LabeledInput label="URL" value={item.url ?? ''} onChange={(v) => onItemChange({ ...item, url: v || null })} />
            <LabeledInput
              label="Dates"
              value={item.dateRangeText ?? ''}
              onChange={(v) => onItemChange({ ...item, dateRangeText: v || null })}
            />
            <LabeledTextarea
              label="Bullets (one per line)"
              className="sm:col-span-2"
              value={item.bullets.join('\n')}
              onChange={(v) => onItemChange({ ...item, bullets: v.split('\n').filter((b) => b.trim()) })}
            />
          </div>
        )}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Skills</h2>
        <div className="flex flex-wrap gap-2">
          {extraction.skills.map((entry, index) => (
            <label
              key={`${entry.item.name}-${index}`}
              className="border-border flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
              title={entry.isDuplicate ? 'Already in your profile' : undefined}
            >
              <input
                type="checkbox"
                checked={entry.included}
                onChange={(e) =>
                  onChange({
                    ...extraction,
                    skills: extraction.skills.map((s, i) =>
                      i === index ? { ...s, included: e.target.checked } : s,
                    ),
                  })
                }
              />
              {entry.item.name}
              {entry.isDuplicate ? <span className="text-muted-foreground text-xs"> (already added)</span> : null}
            </label>
          ))}
          {extraction.skills.length === 0 ? (
            <p className="text-muted-foreground text-sm">No skills detected.</p>
          ) : null}
        </div>
      </section>

      {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="button" disabled={pending} onClick={onConfirm}>
          {pending ? pendingLabel : confirmLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ReviewListSection<T extends { uncertain?: boolean }>({
  title,
  entries,
  onEntryChange,
  renderView,
  renderEdit,
}: {
  title: string;
  entries: ReviewEntry<T>[];
  onEntryChange: (index: number, entry: ReviewEntry<T>) => void;
  renderView: (item: T) => React.ReactNode;
  renderEdit: (item: T, onItemChange: (next: T) => void) => React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">None detected.</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, index) => (
            <div key={index} className="border-border rounded-lg border p-3">
              {entry.isDuplicate ? (
                <p className="text-muted-foreground mb-1 text-xs">Already in your profile</p>
              ) : null}
              {entry.editing ? renderEdit(entry.item, (next) => onEntryChange(index, { ...entry, item: next })) : renderView(entry.item)}
              <div className="mt-2 flex items-center gap-4">
                <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={entry.included}
                    onChange={(e) => onEntryChange(index, { ...entry, included: e.target.checked })}
                  />
                  Include
                </label>
                <button
                  type="button"
                  className="text-primary text-xs underline underline-offset-2"
                  onClick={() => onEntryChange(index, { ...entry, editing: !entry.editing })}
                >
                  {entry.editing ? 'Done editing' : 'Edit'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <label className="text-muted-foreground text-xs">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <label className="text-muted-foreground text-xs">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm"
      />
    </div>
  );
}
