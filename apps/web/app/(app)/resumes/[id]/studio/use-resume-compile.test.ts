// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useResumeCompile } from './use-resume-compile';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function pdfResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/pdf' }),
    blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }),
  } as unknown as Response;
}

function notConfiguredResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ status: 'not_configured' }),
  } as unknown as Response;
}

describe('useResumeCompile', () => {
  it('starts idle and debounces before compiling', async () => {
    const fetchMock = vi.fn().mockResolvedValue(notConfiguredResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useResumeCompile('\\documentclass{article}'));
    expect(result.current.state.kind).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await waitFor(() => expect(result.current.state.kind).toBe('not_configured'));
  });

  it('a successful compile response becomes a "ready" state with the PDF blob, never stale', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse()));

    const { result } = renderHook(() => useResumeCompile('\\documentclass{article}'));
    await waitFor(() => expect(result.current.state.kind).toBe('ready'), { timeout: 2000 });
    if (result.current.state.kind === 'ready') {
      expect(result.current.state.stale).toBe(false);
      expect(result.current.state.blob).toBeInstanceOf(Blob);
    }
  });

  it('editing the draft after a successful compile marks the existing preview stale immediately, before the next compile lands', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse()));

    const { result, rerender } = renderHook(({ latex }) => useResumeCompile(latex), {
      initialProps: { latex: 'v1' },
    });
    await waitFor(() => expect(result.current.state.kind).toBe('ready'), { timeout: 2000 });

    rerender({ latex: 'v2' });
    // Stale flips synchronously in the same effect that (re)starts the debounce — no need to
    // wait out the full debounce window to observe it.
    await waitFor(() => {
      expect(result.current.state.kind === 'ready' && result.current.state.stale).toBe(true);
    });
  });

  it('a 422 compiler response becomes an "error" state carrying the line number', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ status: 'compile_error', error: 'Undefined control sequence', line: 7 }),
      } as unknown as Response),
    );

    const { result } = renderHook(() => useResumeCompile('\\bogus'));
    await waitFor(() => expect(result.current.state.kind).toBe('error'), { timeout: 2000 });
    if (result.current.state.kind === 'error') {
      expect(result.current.state.line).toBe(7);
    }
  });

  it('refresh() bypasses the debounce and compiles immediately', async () => {
    const fetchMock = vi.fn().mockResolvedValue(pdfResponse());
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useResumeCompile('\\documentclass{article}'));
    await waitFor(() => expect(result.current.state.kind).toBe('ready'), { timeout: 2000 });
    const callsAfterFirstCompile = fetchMock.mock.calls.length;

    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirstCompile));
  });
});
