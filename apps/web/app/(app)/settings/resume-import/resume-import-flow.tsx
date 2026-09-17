'use client';

import type {
  ResumeExtractionEducation,
  ResumeExtractionExperience,
  ResumeExtractionProject,
  ResumeExtractionResult,
  ResumeExtractionSkill,
} from '@career-os/shared';
import { Button, Input } from '@career-os/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ConfirmImportResult } from '../../../api/profile/resume-import/confirm/route';

interface CurrentProfile {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin: string | null;
  portfolio: string | null;
  github: string | null;
  website: string | null;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'analyzing' }
  | { kind: 'analyze_error'; message: string }
  | { kind: 'reviewing'; extraction: ExtractionState }
  | { kind: 'confirming'; extraction: ExtractionState }
  | { kind: 'confirm_error'; extraction: ExtractionState; message: string }
  | { kind: 'done'; result: ConfirmImportResult };

/** A personal field's review state — carries both the extracted value and, when it conflicts
 * with the existing profile value, the user's explicit choice (never auto-resolved). */
interface PersonalFieldState {
  resumeValue: string | null;
  existingValue: string | null;
  choice: 'use_resume' | 'keep_existing' | 'exclude';
  editedValue: string;
}

interface ExtractionState {
  personal: Record<keyof CurrentProfile, PersonalFieldState>;
  experience: Array<{ item: ResumeExtractionExperience; included: boolean }>;
  education: Array<{ item: ResumeExtractionEducation; included: boolean }>;
  projects: Array<{ item: ResumeExtractionProject; included: boolean }>;
  skills: Array<{ item: ResumeExtractionSkill; included: boolean }>;
  droppedCount: number;
}

const PERSONAL_FIELD_LABELS: Record<keyof CurrentProfile, string> = {
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
  location: 'Location',
  linkedin: 'LinkedIn',
  portfolio: 'Portfolio',
  github: 'GitHub',
  website: 'Website',
};

function buildExtractionState(
  result: ResumeExtractionResult,
  currentProfile: CurrentProfile | null,
): ExtractionState {
  const personal = {} as ExtractionState['personal'];
  const keys: (keyof CurrentProfile)[] = [
    'fullName',
    'email',
    'phone',
    'location',
    'linkedin',
    'portfolio',
    'github',
    'website',
  ];
  for (const key of keys) {
    const resumeValue = result.personal[key];
    const existingValue = currentProfile?.[key] ?? null;
    // Default choice: if there's nothing to conflict with, use the resume value when one was
    // found; if the existing value already differs, default to keeping it — never silently
    // overwrite a real existing fact (the user must explicitly choose "Use resume value").
    const choice: PersonalFieldState['choice'] =
      !resumeValue ? 'exclude' : !existingValue ? 'use_resume' : 'keep_existing';
    personal[key] = {
      resumeValue,
      existingValue,
      choice,
      editedValue: resumeValue ?? '',
    };
  }

  return {
    personal,
    experience: result.experience.map((item) => ({ item, included: true })),
    education: result.education.map((item) => ({ item, included: true })),
    projects: result.projects.map((item) => ({ item, included: true })),
    skills: result.skills.map((item) => ({ item, included: true })),
    droppedCount: result.droppedCount,
  };
}

export function ResumeImportFlow({ currentProfile }: { currentProfile: CurrentProfile | null }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  async function handleFileSelected(file: File) {
    setStage({ kind: 'analyzing' });
    try {
      const formData = new FormData();
      formData.set('file', file);
      const res = await fetch('/api/profile/resume-import/analyze', {
        method: 'POST',
        body: formData,
      });
      const body = (await res.json().catch(() => null)) as
        | ResumeExtractionResult
        | { error: string }
        | null;
      if (!res.ok || !body || 'error' in body) {
        setStage({
          kind: 'analyze_error',
          message:
            body && 'error' in body && typeof body.error === 'string'
              ? body.error
              : 'Could not analyze this résumé — please try again.',
        });
        return;
      }
      setStage({ kind: 'reviewing', extraction: buildExtractionState(body, currentProfile) });
    } catch {
      setStage({ kind: 'analyze_error', message: 'Could not analyze this résumé — please try again.' });
    }
  }

  async function handleConfirm(extraction: ExtractionState) {
    setStage({ kind: 'confirming', extraction });

    const personal: Record<string, string | null> = {};
    for (const [key, field] of Object.entries(extraction.personal) as [
      keyof CurrentProfile,
      PersonalFieldState,
    ][]) {
      if (field.choice === 'exclude') continue;
      if (field.choice === 'keep_existing') continue; // omit — confirm route keeps existing value
      personal[key] = field.editedValue.trim() || null;
    }

    const payload = {
      personal: Object.keys(personal).length > 0 ? personal : undefined,
      experience: extraction.experience
        .filter((e) => e.included)
        .map((e) => ({
          company: e.item.company,
          title: e.item.title,
          location: e.item.location,
          dateRangeText: e.item.dateRangeText,
          startDate: null,
          endDate: null,
          description: e.item.bullets.join('\n') || null,
        })),
      education: extraction.education
        .filter((e) => e.included)
        .map((e) => ({
          school: e.item.school,
          degree: e.item.degree,
          fieldOfStudy: e.item.fieldOfStudy,
          startDate: null,
          graduationDate: null,
          gpa: e.item.gpa,
        })),
      projects: extraction.projects
        .filter((p) => p.included)
        .map((p) => ({
          name: p.item.name,
          role: p.item.role,
          url: p.item.url,
          startDate: null,
          endDate: null,
          description: p.item.bullets.join('\n') || null,
        })),
      skills: extraction.skills
        .filter((s) => s.included)
        .map((s) => ({ name: s.item.name, category: s.item.category })),
    };

    try {
      const res = await fetch('/api/profile/resume-import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as ConfirmImportResult | { error: unknown } | null;
      if (!res.ok || !body || 'error' in body) {
        setStage({
          kind: 'confirm_error',
          extraction,
          message: 'Could not save your approved items — please try again.',
        });
        return;
      }
      setStage({ kind: 'done', result: body });
      router.refresh();
    } catch {
      setStage({
        kind: 'confirm_error',
        extraction,
        message: 'Could not save your approved items — please try again.',
      });
    }
  }

  if (stage.kind === 'idle' || stage.kind === 'analyzing' || stage.kind === 'analyze_error') {
    return (
      <div className="border-border space-y-3 rounded-lg border border-dashed p-6">
        <input
          type="file"
          accept="application/pdf"
          disabled={stage.kind === 'analyzing'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFileSelected(file);
          }}
          className="text-sm"
        />
        <p className="text-muted-foreground text-xs">PDF only, up to 5 MB.</p>
        {stage.kind === 'analyzing' ? (
          <p className="text-muted-foreground text-sm">Analyzing your résumé…</p>
        ) : null}
        {stage.kind === 'analyze_error' ? (
          <p className="text-destructive text-sm">{stage.message}</p>
        ) : null}
      </div>
    );
  }

  if (stage.kind === 'done') {
    return (
      <div className="border-border space-y-2 rounded-lg border p-6 text-sm">
        <p className="font-medium">Import complete.</p>
        <ul className="text-muted-foreground list-inside list-disc">
          <li>
            {stage.result.experiencesCreated} experience item(s) added
            {stage.result.experiencesSkippedAsDuplicate > 0
              ? ` (${stage.result.experiencesSkippedAsDuplicate} already existed, skipped)`
              : ''}
          </li>
          <li>
            {stage.result.educationCreated} education item(s) added
            {stage.result.educationSkippedAsDuplicate > 0
              ? ` (${stage.result.educationSkippedAsDuplicate} already existed, skipped)`
              : ''}
          </li>
          <li>
            {stage.result.projectsCreated} project(s) added
            {stage.result.projectsSkippedAsDuplicate > 0
              ? ` (${stage.result.projectsSkippedAsDuplicate} already existed, skipped)`
              : ''}
          </li>
          <li>
            {stage.result.skillsCreated} skill(s) added
            {stage.result.skillsSkippedAsDuplicate > 0
              ? ` (${stage.result.skillsSkippedAsDuplicate} already existed, skipped)`
              : ''}
          </li>
        </ul>
        <a href="/profile" className="text-primary text-sm underline underline-offset-2">
          Go to your Candidate Profile
        </a>
      </div>
    );
  }

  // reviewing / confirming / confirm_error
  const extraction = stage.extraction;
  const pending = stage.kind === 'confirming';

  return (
    <ReviewScreen
      extraction={extraction}
      pending={pending}
      errorMessage={stage.kind === 'confirm_error' ? stage.message : null}
      onChange={(next) => setStage({ kind: 'reviewing', extraction: next })}
      onConfirm={() => void handleConfirm(extraction)}
    />
  );
}

function ReviewScreen({
  extraction,
  pending,
  errorMessage,
  onChange,
  onConfirm,
}: {
  extraction: ExtractionState;
  pending: boolean;
  errorMessage: string | null;
  onChange: (next: ExtractionState) => void;
  onConfirm: () => void;
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
        onToggle={(index, included) =>
          onChange({
            ...extraction,
            experience: extraction.experience.map((e, i) => (i === index ? { ...e, included } : e)),
          })
        }
        renderItem={(entry) => (
          <>
            <p className="font-medium">
              {entry.item.title} · {entry.item.company}
            </p>
            <p className="text-muted-foreground text-xs">
              {[entry.item.location, entry.item.dateRangeText].filter(Boolean).join(' · ')}
              {entry.item.uncertain ? ' · uncertain — please review' : ''}
            </p>
            {entry.item.bullets.length > 0 ? (
              <ul className="mt-1 list-inside list-disc text-sm">
                {entry.item.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      />

      <ReviewListSection
        title="Education"
        entries={extraction.education}
        onToggle={(index, included) =>
          onChange({
            ...extraction,
            education: extraction.education.map((e, i) => (i === index ? { ...e, included } : e)),
          })
        }
        renderItem={(entry) => (
          <>
            <p className="font-medium">{entry.item.school}</p>
            <p className="text-muted-foreground text-xs">
              {[entry.item.degree, entry.item.fieldOfStudy, entry.item.dateRangeText]
                .filter(Boolean)
                .join(' · ')}
              {entry.item.uncertain ? ' · uncertain — please review' : ''}
            </p>
          </>
        )}
      />

      <ReviewListSection
        title="Projects"
        entries={extraction.projects}
        onToggle={(index, included) =>
          onChange({
            ...extraction,
            projects: extraction.projects.map((e, i) => (i === index ? { ...e, included } : e)),
          })
        }
        renderItem={(entry) => (
          <>
            <p className="font-medium">{entry.item.name}</p>
            <p className="text-muted-foreground text-xs">
              {[entry.item.role, entry.item.dateRangeText].filter(Boolean).join(' · ')}
              {entry.item.uncertain ? ' · uncertain — please review' : ''}
            </p>
            {entry.item.bullets.length > 0 ? (
              <ul className="mt-1 list-inside list-disc text-sm">
                {entry.item.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Skills</h2>
        <div className="flex flex-wrap gap-2">
          {extraction.skills.map((entry, index) => (
            <label
              key={`${entry.item.name}-${index}`}
              className="border-border flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
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
            </label>
          ))}
          {extraction.skills.length === 0 ? (
            <p className="text-muted-foreground text-sm">No skills detected.</p>
          ) : null}
        </div>
      </section>

      {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}

      <div>
        <Button type="button" disabled={pending} onClick={onConfirm}>
          {pending ? 'Saving…' : 'Confirm import'}
        </Button>
      </div>
    </div>
  );
}

function ReviewListSection<T>({
  title,
  entries,
  onToggle,
  renderItem,
}: {
  title: string;
  entries: Array<{ item: T; included: boolean }>;
  onToggle: (index: number, included: boolean) => void;
  renderItem: (entry: { item: T; included: boolean }) => React.ReactNode;
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
              {renderItem(entry)}
              <label className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={entry.included}
                  onChange={(e) => onToggle(index, e.target.checked)}
                />
                Include
              </label>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
