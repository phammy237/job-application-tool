import { useCallback, useEffect, useRef, useState } from 'react';

export type ResumeCompileState =
  | { kind: 'idle' }
  | { kind: 'compiling'; stale: boolean }
  | { kind: 'ready'; blob: Blob; stale: boolean }
  | { kind: 'error'; message: string; line?: number; stale: boolean }
  | { kind: 'not_configured' };

const DEBOUNCE_MS = 1200;

/**
 * Drives Resume Studio's PDF preview: debounces auto-compile on every LaTeX change, exposes a
 * manual `refresh()` for the "Refresh preview" button, and tracks staleness (the draft changed
 * since the last successful compile) separately from the compile-in-flight state so the UI can
 * keep showing the last good PDF while marking it "Unsaved changes" rather than blanking it.
 * Only one compile is ever in flight — a new request supersedes whatever's still running
 * (latest-wins via an `AbortController` per attempt).
 */
export function useResumeCompile(latex: string): {
  state: ResumeCompileState;
  refresh: () => void;
} {
  const [state, setState] = useState<ResumeCompileState>({ kind: 'idle' });
  const lastCompiledLatexRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const compile = useCallback(async (source: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({
      kind: 'compiling',
      stale: prev.kind === 'ready' || prev.kind === 'error' ? prev.stale : false,
    }));

    try {
      const res = await fetch('/api/resumes/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex: source }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const contentType = res.headers.get('content-type') ?? '';
      if (res.ok && contentType.includes('application/pdf')) {
        const blob = await res.blob();
        lastCompiledLatexRef.current = source;
        setState({ kind: 'ready', blob, stale: false });
        return;
      }

      const body = (await res.json().catch(() => null)) as
        | { status?: string; error?: string; line?: number }
        | null;
      if (body?.status === 'not_configured') {
        setState({ kind: 'not_configured' });
        return;
      }
      setState({
        kind: 'error',
        message: body?.error ?? 'Could not generate a preview.',
        line: body?.line,
        stale: false,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not generate a preview.',
        stale: false,
      });
    }
  }, []);

  useEffect(() => {
    // Mark whatever we're currently showing as stale the instant the draft diverges from what
    // was last actually compiled — independent of the debounce timer below, so the "Unsaved
    // changes" label appears immediately, not after the debounce delay.
    if (lastCompiledLatexRef.current !== null && lastCompiledLatexRef.current !== latex) {
      setState((prev) =>
        prev.kind === 'ready' || prev.kind === 'error' ? { ...prev, stale: true } : prev,
      );
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void compile(latex);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [latex, compile]);

  const refresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void compile(latex);
  }, [latex, compile]);

  return { state, refresh };
}
