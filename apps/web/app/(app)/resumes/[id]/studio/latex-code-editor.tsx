'use client';

import { useEffect, useRef } from 'react';

/**
 * A lightweight, dependency-free line-numbered code area for Advanced LaTeX mode — a synced-
 * scroll gutter `<div>` next to a plain `<textarea>`, not a CodeMirror/Monaco integration
 * (neither is a dependency anywhere in this repo, and pulling one in solely for this one
 * textarea would be a large addition for a UI-polish pass). `errorLine` (from a compile
 * error's best-effort line reference) gets a highlighted gutter row and an auto-scroll-into-
 * view on change.
 */
export function LatexCodeEditor({
  value,
  onChange,
  errorLine,
}: {
  value: string;
  onChange: (value: string) => void;
  errorLine?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = value.split('\n').length;

  function syncGutterScroll() {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }

  useEffect(() => {
    if (!errorLine || !textareaRef.current) return;
    const lineHeight = 20; // matches the font-mono text-xs / leading-5 pairing below
    textareaRef.current.scrollTop = Math.max(0, (errorLine - 3) * lineHeight);
    syncGutterScroll();
  }, [errorLine]);

  return (
    <div className="border-input bg-background flex h-96 overflow-hidden rounded-md border font-mono text-xs">
      <div
        ref={gutterRef}
        className="text-muted-foreground bg-muted select-none overflow-hidden px-2 py-3 text-right leading-5"
        aria-hidden
      >
        {Array.from({ length: lineCount }, (_, i) => i + 1).map((line) => (
          <div
            key={line}
            className={line === errorLine ? 'bg-destructive/20 text-destructive rounded-sm' : undefined}
          >
            {line}
          </div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncGutterScroll}
        spellCheck={false}
        className="flex-1 resize-none overflow-auto bg-transparent px-3 py-3 leading-5 outline-none"
      />
    </div>
  );
}
