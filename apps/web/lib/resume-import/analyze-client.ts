import type { ResumeExtractionResult } from '@career-os/shared';

export type AnalyzeResumeResult =
  | { ok: true; result: ResumeExtractionResult }
  | { ok: false; error: string };

/**
 * Calls the one shared analyze endpoint for both Resume Import entry points — an uploaded PDF
 * file or pasted résumé text, never a fake File wrapping the pasted text (the API route itself
 * branches on which form field is present; see apps/web/app/api/profile/resume-import/analyze/
 * route.ts). Both paths return the identical `ResumeExtractionResult` shape, so every downstream
 * review/autofill/confirm step is unaware of which one was used.
 */
export async function analyzeResume(
  input: { kind: 'file'; file: File } | { kind: 'text'; text: string },
): Promise<AnalyzeResumeResult> {
  const formData = new FormData();
  if (input.kind === 'file') {
    formData.set('file', input.file);
  } else {
    formData.set('text', input.text);
  }

  try {
    const res = await fetch('/api/profile/resume-import/analyze', {
      method: 'POST',
      body: formData,
    });
    const body = (await res.json().catch(() => null)) as ResumeExtractionResult | { error: string } | null;
    if (!res.ok || !body || 'error' in body) {
      return {
        ok: false,
        error:
          body && 'error' in body && typeof body.error === 'string'
            ? body.error
            : 'Could not analyze this résumé — please try again.',
      };
    }
    return { ok: true, result: body };
  } catch {
    return { ok: false, error: 'Could not analyze this résumé — please try again.' };
  }
}
