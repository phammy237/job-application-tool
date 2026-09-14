'use client';

import {
  buildResumeFileName,
  getLatexForResumeVersion,
  type ResumeVersion,
} from '@career-os/shared';
import { Button } from '@career-os/ui';
import { useState } from 'react';

/**
 * A read-only expandable LaTeX view for one immutable version — never an editor (Studio is the
 * only place that edits, and it always produces a *new* version, docs/IMPLEMENTATION_PLAN.md
 * "Phase 7C" §33: "Do not allow editing in-place"). Honest for a `METADATA_ONLY` (legacy, Phase
 * 7A) version: there is no LaTeX to show for one, and this component says so rather than
 * fabricating a placeholder render.
 */
export function VersionLatexPreview({ version }: { version: ResumeVersion }) {
  const [expanded, setExpanded] = useState(false);

  if (version.snapshotFormat !== 'STRUCTURED_V1') {
    return (
      <p className="text-muted-foreground mt-1 text-xs">
        This version predates structured résumé content.
      </p>
    );
  }

  const latex = getLatexForResumeVersion(version.snapshotPayload);

  function handleDownload() {
    const filename = buildResumeFileName(version.displayName, 'tex');
    const blob = new Blob([latex], { type: 'text/x-tex' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide LaTeX' : 'View LaTeX'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={handleDownload}>
          Download .tex
        </Button>
      </div>
      {expanded ? (
        <pre className="border-border bg-muted max-h-64 overflow-auto rounded-md border p-3 text-xs">
          {latex}
        </pre>
      ) : null}
    </div>
  );
}
