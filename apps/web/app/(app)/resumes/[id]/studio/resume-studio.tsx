'use client';

import {
  buildResumeFileName,
  createResumeEntryId,
  getLatexForResumeVersion,
  type ResumeVersion,
  type StructuredResumeV1,
} from '@career-os/shared';
import { Button, Input, Label } from '@career-os/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { saveNewStructuredResumeVersion } from './actions';
import { BulletsEditor } from './bullets-editor';
import { DateRangeFields } from './date-range-fields';
import { EntrySectionEditor } from './entry-section-editor';
import { HeaderEditor } from './header-editor';
import { SkillsEditor } from './skills-editor';

const EMPTY_DATE_RANGE = { start: null, end: null, isPresent: false };

/**
 * The Resume Studio (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §21/§22) — manual structured editing,
 * an Advanced LaTeX override mode, a live deterministic LaTeX preview, and "Save New Version."
 * All state here is a local, unsaved draft (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §16): loading
 * a version never mutates it, and saving always creates a brand new immutable
 * `resume_versions` row — there is no in-place edit path anywhere in this component.
 */
export function ResumeStudio({
  resumeId,
  resumeName,
  baseVersionLabel,
  initialContent,
  profileImportContent,
}: {
  resumeId: string;
  resumeName: string;
  baseVersionLabel: string | null;
  initialContent: StructuredResumeV1;
  profileImportContent: StructuredResumeV1;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<StructuredResumeV1>(initialContent);
  const [displayName, setDisplayName] = useState(resumeName);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<'structured' | 'advanced'>('structured');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState<ResumeVersion | null>(null);

  const latex = useMemo(() => getLatexForResumeVersion(draft), [draft]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function update(updater: (prev: StructuredResumeV1) => StructuredResumeV1) {
    setDraft(updater);
    setDirty(true);
    setSavedVersion(null);
  }

  function handleImportFromProfile() {
    const hasContent =
      draft.education.length > 0 ||
      draft.experience.length > 0 ||
      draft.projects.length > 0 ||
      draft.leadership.length > 0 ||
      draft.skills.length > 0;
    if (
      hasContent &&
      !window.confirm(
        'Import from profile replaces Education, Experience, Projects, and Skills below with your approved profile data. Continue?',
      )
    ) {
      return;
    }
    update((prev) => ({
      ...profileImportContent,
      header: prev.header,
      renderOverride: prev.renderOverride,
    }));
  }

  function handleResetOverride() {
    if (
      !window.confirm('Discard the custom LaTeX override and go back to generated LaTeX?')
    ) {
      return;
    }
    update((prev) => ({ ...prev, renderOverride: null }));
  }

  function handleCustomizeLatex() {
    update((prev) => ({ ...prev, renderOverride: { latex } }));
    setMode('advanced');
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await saveNewStructuredResumeVersion(resumeId, {
      displayName,
      content: draft,
    });
    setSaving(false);
    if (result.status === 'error') {
      setError(result.message);
      return;
    }
    setSavedVersion(result.version);
    setDirty(false);
    router.refresh();
  }

  function handleDownloadTex() {
    const filename = buildResumeFileName(displayName, 'tex');
    const blob = new Blob([latex], { type: 'text/x-tex' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="studio-display-name" className="text-xs">
            Version label
          </Label>
          <Input
            id="studio-display-name"
            className="w-80"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div className="flex items-center gap-3 text-sm">
          {baseVersionLabel ? (
            <span className="text-muted-foreground">Based on {baseVersionLabel}</span>
          ) : (
            <span className="text-muted-foreground">Starting blank</span>
          )}
          {dirty ? (
            <span className="text-amber-600">Unsaved changes</span>
          ) : (
            <span className="text-muted-foreground">No unsaved changes</span>
          )}
        </div>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {savedVersion ? (
        <p className="text-sm text-green-700">
          Saved as version {savedVersion.versionNumber}.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === 'structured' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('structured')}
        >
          Structured
        </Button>
        <Button
          type="button"
          variant={mode === 'advanced' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('advanced')}
        >
          Advanced: LaTeX
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleImportFromProfile}
        >
          Import from profile
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          {mode === 'structured' ? (
            <>
              <HeaderEditor
                header={draft.header}
                onChange={(header) => update((prev) => ({ ...prev, header }))}
              />

              <EntrySectionEditor
                title="Education"
                entryLabel="education entry"
                entries={draft.education}
                onChange={(education) => update((prev) => ({ ...prev, education }))}
                createBlankEntry={() => ({
                  id: createResumeEntryId(),
                  institution: '',
                  degree: null,
                  fieldOfStudy: null,
                  location: null,
                  dateRange: EMPTY_DATE_RANGE,
                  gpa: null,
                  honors: [],
                  bullets: [],
                })}
                renderFields={(entry, updateEntry) => (
                  <>
                    <Input
                      placeholder="Institution *"
                      value={entry.institution}
                      onChange={(e) =>
                        updateEntry((x) => ({ ...x, institution: e.target.value }))
                      }
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        placeholder="Degree"
                        value={entry.degree ?? ''}
                        onChange={(e) =>
                          updateEntry((x) => ({ ...x, degree: e.target.value || null }))
                        }
                      />
                      <Input
                        placeholder="Field of study"
                        value={entry.fieldOfStudy ?? ''}
                        onChange={(e) =>
                          updateEntry((x) => ({
                            ...x,
                            fieldOfStudy: e.target.value || null,
                          }))
                        }
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        placeholder="Location"
                        value={entry.location ?? ''}
                        onChange={(e) =>
                          updateEntry((x) => ({ ...x, location: e.target.value || null }))
                        }
                      />
                      <Input
                        placeholder="GPA"
                        value={entry.gpa ?? ''}
                        onChange={(e) =>
                          updateEntry((x) => ({ ...x, gpa: e.target.value || null }))
                        }
                      />
                    </div>
                    <Input
                      placeholder="Honors (comma-separated)"
                      value={entry.honors.join(', ')}
                      onChange={(e) =>
                        updateEntry((x) => ({
                          ...x,
                          honors: e.target.value
                            .split(',')
                            .map((h) => h.trim())
                            .filter(Boolean),
                        }))
                      }
                    />
                    <DateRangeFields
                      idPrefix={`edu-${entry.id}`}
                      value={entry.dateRange}
                      onChange={(dateRange) => updateEntry((x) => ({ ...x, dateRange }))}
                    />
                    <BulletsEditor
                      bullets={entry.bullets}
                      onChange={(bullets) => updateEntry((x) => ({ ...x, bullets }))}
                    />
                  </>
                )}
              />

              <EntrySectionEditor
                title="Experience"
                entryLabel="experience entry"
                entries={draft.experience}
                onChange={(experience) => update((prev) => ({ ...prev, experience }))}
                createBlankEntry={() => ({
                  id: createResumeEntryId(),
                  organization: '',
                  role: '',
                  location: null,
                  dateRange: EMPTY_DATE_RANGE,
                  bullets: [],
                })}
                renderFields={(entry, updateEntry) => (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        placeholder="Organization *"
                        value={entry.organization}
                        onChange={(e) =>
                          updateEntry((x) => ({ ...x, organization: e.target.value }))
                        }
                      />
                      <Input
                        placeholder="Role *"
                        value={entry.role}
                        onChange={(e) =>
                          updateEntry((x) => ({ ...x, role: e.target.value }))
                        }
                      />
                    </div>
                    <Input
                      placeholder="Location"
                      value={entry.location ?? ''}
                      onChange={(e) =>
                        updateEntry((x) => ({ ...x, location: e.target.value || null }))
                      }
                    />
                    <DateRangeFields
                      idPrefix={`exp-${entry.id}`}
                      value={entry.dateRange}
                      onChange={(dateRange) => updateEntry((x) => ({ ...x, dateRange }))}
                    />
                    <BulletsEditor
                      bullets={entry.bullets}
                      onChange={(bullets) => updateEntry((x) => ({ ...x, bullets }))}
                    />
                  </>
                )}
              />

              <EntrySectionEditor
                title="Projects"
                entryLabel="project entry"
                entries={draft.projects}
                onChange={(projects) => update((prev) => ({ ...prev, projects }))}
                createBlankEntry={() => ({
                  id: createResumeEntryId(),
                  name: '',
                  role: null,
                  url: null,
                  dateRange: EMPTY_DATE_RANGE,
                  bullets: [],
                })}
                renderFields={(entry, updateEntry) => (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        placeholder="Project name *"
                        value={entry.name}
                        onChange={(e) =>
                          updateEntry((x) => ({ ...x, name: e.target.value }))
                        }
                      />
                      <Input
                        placeholder="Role"
                        value={entry.role ?? ''}
                        onChange={(e) =>
                          updateEntry((x) => ({ ...x, role: e.target.value || null }))
                        }
                      />
                    </div>
                    <Input
                      placeholder="URL"
                      value={entry.url ?? ''}
                      onChange={(e) =>
                        updateEntry((x) => ({ ...x, url: e.target.value || null }))
                      }
                    />
                    <DateRangeFields
                      idPrefix={`proj-${entry.id}`}
                      value={entry.dateRange}
                      onChange={(dateRange) => updateEntry((x) => ({ ...x, dateRange }))}
                    />
                    <BulletsEditor
                      bullets={entry.bullets}
                      onChange={(bullets) => updateEntry((x) => ({ ...x, bullets }))}
                    />
                  </>
                )}
              />

              <EntrySectionEditor
                title="Leadership"
                entryLabel="leadership entry"
                entries={draft.leadership}
                onChange={(leadership) => update((prev) => ({ ...prev, leadership }))}
                createBlankEntry={() => ({
                  id: createResumeEntryId(),
                  organization: '',
                  role: null,
                  location: null,
                  dateRange: EMPTY_DATE_RANGE,
                  bullets: [],
                })}
                renderFields={(entry, updateEntry) => (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        placeholder="Organization *"
                        value={entry.organization}
                        onChange={(e) =>
                          updateEntry((x) => ({ ...x, organization: e.target.value }))
                        }
                      />
                      <Input
                        placeholder="Role"
                        value={entry.role ?? ''}
                        onChange={(e) =>
                          updateEntry((x) => ({ ...x, role: e.target.value || null }))
                        }
                      />
                    </div>
                    <Input
                      placeholder="Location"
                      value={entry.location ?? ''}
                      onChange={(e) =>
                        updateEntry((x) => ({ ...x, location: e.target.value || null }))
                      }
                    />
                    <DateRangeFields
                      idPrefix={`lead-${entry.id}`}
                      value={entry.dateRange}
                      onChange={(dateRange) => updateEntry((x) => ({ ...x, dateRange }))}
                    />
                    <BulletsEditor
                      bullets={entry.bullets}
                      onChange={(bullets) => updateEntry((x) => ({ ...x, bullets }))}
                    />
                  </>
                )}
              />

              <SkillsEditor
                groups={draft.skills}
                onChange={(skills) => update((prev) => ({ ...prev, skills }))}
              />
            </>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Advanced: custom LaTeX override</h3>
              {draft.renderOverride ? (
                <>
                  <p className="text-muted-foreground text-xs">
                    Custom LaTeX override active — structured content above is no longer
                    what renders below until you reset this.
                  </p>
                  <textarea
                    className="border-input bg-background h-96 w-full rounded-md border p-3 font-mono text-xs"
                    value={draft.renderOverride.latex}
                    onChange={(e) =>
                      update((prev) => ({
                        ...prev,
                        renderOverride: { latex: e.target.value },
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleResetOverride}
                  >
                    Reset to generated LaTeX
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground text-xs">
                    This document currently renders from structured content (below,
                    read-only). Click &quot;Customize&quot; to start editing the LaTeX
                    directly — structured content stays as the factual record either way,
                    but the rendered output will follow your custom LaTeX instead until
                    you reset it.
                  </p>
                  <pre className="border-border bg-muted max-h-96 overflow-auto rounded-md border p-3 text-xs">
                    {latex}
                  </pre>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCustomizeLatex}
                  >
                    Customize
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="border-border border-t pt-4">
            <Button type="button" disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save New Version'}
            </Button>
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">LaTeX preview</h3>
            <Button type="button" variant="outline" size="sm" onClick={handleDownloadTex}>
              Download .tex
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            PDF compilation isn&apos;t available yet — no sandboxed compilation service
            exists in this deployment. Download the .tex file and compile it yourself
            (e.g. paste it into Overleaf) until that lands.
          </p>
          <pre className="border-border bg-muted sticky top-4 max-h-[80vh] overflow-auto rounded-md border p-3 text-xs">
            {latex}
          </pre>
        </div>
      </div>
    </div>
  );
}
