'use client';

import { Button } from '@career-os/ui';
import { useState } from 'react';

type Mode = 'upload' | 'paste';

export const MIN_PASTE_TEXT_LENGTH = 100;
export const MAX_PASTE_TEXT_LENGTH = 20_000;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * The one shared "Upload resume" / "Paste resume text" entry point for both Resume Import
 * surfaces (/settings/resume-import and the /profile inline panel) — client-side validation here
 * mirrors (never replaces) the server-side checks in
 * apps/web/app/api/profile/resume-import/analyze/route.ts, so a bad input never even reaches the
 * network call; a duplicate Analyze click is guarded by disabling the button while `analyzing`.
 */
export function ResumeUploadOrPaste({
  analyzing,
  errorMessage,
  onAnalyze,
  heading,
  description,
}: {
  analyzing: boolean;
  errorMessage: string | null;
  onAnalyze: (input: { kind: 'file'; file: File } | { kind: 'text'; text: string }) => void | Promise<void>;
  heading?: string;
  description?: string;
}) {
  const [mode, setMode] = useState<Mode>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  function handleFileChange(selected: File | null) {
    setLocalError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (selected.type !== 'application/pdf') {
      setLocalError('Only PDF résumés are supported right now. Please choose a .pdf file.');
      setFile(null);
      return;
    }
    if (selected.size === 0) {
      setLocalError('That file is empty. Please choose a different PDF.');
      setFile(null);
      return;
    }
    if (selected.size > MAX_FILE_SIZE_BYTES) {
      setLocalError('This file is larger than the 5 MB limit. Please choose a smaller PDF.');
      setFile(null);
      return;
    }
    setFile(selected);
  }

  function handleAnalyzeClick() {
    if (analyzing) return; // duplicate-click guard
    if (mode === 'upload') {
      if (!file) {
        setLocalError('Please choose a PDF file first.');
        return;
      }
      setLocalError(null);
      void onAnalyze({ kind: 'file', file });
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      setLocalError('Please paste your résumé text first.');
      return;
    }
    if (trimmed.length < MIN_PASTE_TEXT_LENGTH) {
      setLocalError(
        `This doesn't look like enough résumé text yet (at least ${MIN_PASTE_TEXT_LENGTH} characters) — please paste more.`,
      );
      return;
    }
    if (trimmed.length > MAX_PASTE_TEXT_LENGTH) {
      setLocalError(
        `This text is too long (max ${MAX_PASTE_TEXT_LENGTH.toLocaleString()} characters) — please paste a shorter excerpt.`,
      );
      return;
    }
    setLocalError(null);
    void onAnalyze({ kind: 'text', text: trimmed });
  }

  const shownError = localError ?? errorMessage;

  return (
    <div className="border-border space-y-4 rounded-lg border border-dashed p-6">
      {heading ? <p className="font-medium">{heading}</p> : null}
      {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}

      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === 'upload' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('upload')}
          disabled={analyzing}
        >
          Upload resume
        </Button>
        <Button
          type="button"
          variant={mode === 'paste' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('paste')}
          disabled={analyzing}
        >
          Paste resume text
        </Button>
      </div>

      {mode === 'upload' ? (
        <div className="space-y-2">
          <input
            type="file"
            accept="application/pdf"
            disabled={analyzing}
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <p className="text-muted-foreground text-xs">PDF only, up to 5 MB.</p>
          {file ? <p className="text-sm">Selected: {file.name}</p> : null}
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={text}
            disabled={analyzing}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the text from your resume here."
            rows={10}
            className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          />
          <p className="text-muted-foreground text-xs">{text.length.toLocaleString()} characters</p>
        </div>
      )}

      {shownError ? <p className="text-destructive text-sm">{shownError}</p> : null}

      <Button type="button" onClick={handleAnalyzeClick} disabled={analyzing}>
        {analyzing ? 'Analyzing…' : 'Analyze'}
      </Button>
    </div>
  );
}
