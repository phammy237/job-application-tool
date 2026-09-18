import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  createOwnResumeUpload: vi.fn(),
  getOwnResumeUploadByContentHash: vi.fn(),
  updateOwnResumeUploadExtractionStatus: vi.fn(),
  extractPdfText: vi.fn(),
  generateResumeExtraction: vi.fn(),
  storageUpload: vi.fn(),
}));

vi.mock('@career-os/database', () => ({
  createOwnResumeUpload: mocks.createOwnResumeUpload,
  getOwnResumeUploadByContentHash: mocks.getOwnResumeUploadByContentHash,
  updateOwnResumeUploadExtractionStatus: mocks.updateOwnResumeUploadExtractionStatus,
}));
vi.mock('@career-os/ai', () => ({ generateResumeExtraction: mocks.generateResumeExtraction }));
vi.mock('../../../../../lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('../../../../../lib/pdf-text-extraction', () => ({ extractPdfText: mocks.extractPdfText }));
vi.mock('../../../../../lib/supabase/server', () => ({ createClient: mocks.createClient }));

const { POST } = await import('./route');

const USER_ID = '22222222-2222-4222-8222-222222222222';

function requestWithFile(file: File | null): Request {
  const formData = new FormData();
  if (file) formData.set('file', file);
  return new Request('http://localhost/api/profile/resume-import/analyze', {
    method: 'POST',
    body: formData,
  });
}

function pdfFile(bytes: number, name = 'resume.pdf'): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
}

function requestWithText(text: string | null): Request {
  const formData = new FormData();
  if (text !== null) formData.set('text', text);
  return new Request('http://localhost/api/profile/resume-import/analyze', {
    method: 'POST',
    body: formData,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: USER_ID });
  mocks.createClient.mockResolvedValue({
    storage: { from: () => ({ upload: mocks.storageUpload }) },
  });
  mocks.storageUpload.mockResolvedValue({ error: null });
  mocks.getOwnResumeUploadByContentHash.mockResolvedValue(null);
  mocks.createOwnResumeUpload.mockResolvedValue({ id: 'upload-1' });
  mocks.updateOwnResumeUploadExtractionStatus.mockResolvedValue(undefined);
});

describe('POST /api/profile/resume-import/analyze', () => {
  it('rejects an unauthenticated request', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await POST(requestWithFile(pdfFile(100)));
    expect(res.status).toBe(401);
  });

  it('rejects a missing file', async () => {
    const res = await POST(requestWithFile(null));
    expect(res.status).toBe(400);
  });

  it('rejects a non-PDF file type, never silently accepting it', async () => {
    const file = new File([new Uint8Array(100)], 'resume.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const res = await POST(requestWithFile(file));
    expect(res.status).toBe(415);
    expect(mocks.extractPdfText).not.toHaveBeenCalled();
  });

  it('rejects a file over the 5 MB limit', async () => {
    const res = await POST(requestWithFile(pdfFile(6 * 1024 * 1024)));
    expect(res.status).toBe(413);
  });

  it('rejects an empty file', async () => {
    const res = await POST(requestWithFile(pdfFile(0)));
    expect(res.status).toBe(400);
  });

  it('honestly reports a scanned/image-only PDF rather than treating empty text as a real résumé', async () => {
    mocks.extractPdfText.mockResolvedValue({ status: 'no_extractable_text' });

    const res = await POST(requestWithFile(pdfFile(1000)));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(422);
    expect(body.error).toMatch(/scanned/i);
    expect(mocks.generateResumeExtraction).not.toHaveBeenCalled();
    expect(mocks.updateOwnResumeUploadExtractionStatus).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      'upload-1',
      'FAILED',
    );
  });

  it('surfaces AI rate-limiting distinctly, with a clear message', async () => {
    mocks.extractPdfText.mockResolvedValue({ status: 'ok', text: 'Jane Doe\nEXPERIENCE' });
    mocks.generateResumeExtraction.mockResolvedValue({
      status: 'rate_limited',
      usage: { allowed: false, aiRequestsThisPeriod: 150, aiRequestLimit: 150, aiRequestPeriodStartedAt: '2026-01-01' },
    });

    const res = await POST(requestWithFile(pdfFile(1000)));
    expect(res.status).toBe(429);
  });

  it('returns the structured, reviewable result on success — never writing to profile tables itself', async () => {
    mocks.extractPdfText.mockResolvedValue({
      status: 'ok',
      text: 'Jane Doe\njane@example.com\nEXPERIENCE\nEngineer, Acme',
    });
    mocks.generateResumeExtraction.mockResolvedValue({
      status: 'ok',
      result: { experience: [], education: [], projects: [], skills: [] },
      droppedCount: 0,
    });

    const res = await POST(requestWithFile(pdfFile(1000)));
    const body = (await res.json()) as { personal: { email: string | null } };

    expect(res.status).toBe(200);
    expect(body.personal.email).toBe('jane@example.com');
    expect(mocks.updateOwnResumeUploadExtractionStatus).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      'upload-1',
      'COMPLETE',
    );
  });

  it('reuses an existing upload row for a repeat upload of the identical file (dedup), never re-uploading to storage', async () => {
    mocks.getOwnResumeUploadByContentHash.mockResolvedValue({ id: 'existing-upload' });
    mocks.extractPdfText.mockResolvedValue({ status: 'ok', text: 'Jane Doe' });
    mocks.generateResumeExtraction.mockResolvedValue({
      status: 'ok',
      result: { experience: [], education: [], projects: [], skills: [] },
      droppedCount: 0,
    });

    await POST(requestWithFile(pdfFile(1000)));

    expect(mocks.storageUpload).not.toHaveBeenCalled();
    expect(mocks.createOwnResumeUpload).not.toHaveBeenCalled();
  });

  it('10. no AI-grounded path can use an extracted item before confirmation — this route imports no Candidate Profile write function at all (structural, not just behavioral)', async () => {
    // Two independent guarantees: (a) the mock module above never provides
    // createOwnExperience/createOwnEducation/createOwnProject/createOwnSkill/upsertOwnProfile —
    // if route.ts imported any of them, the module import itself would throw undefined-is-not-a-
    // function the moment any test in this file ran, not just this one; (b) the route's actual
    // source text contains none of those identifiers, checked directly so this stays true even if
    // a future edit added a call site the existing tests happened not to exercise.
    const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
    for (const forbidden of [
      'createOwnExperience',
      'createOwnEducation',
      'createOwnProject',
      'createOwnSkill',
      'upsertOwnProfile',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

describe('POST /api/profile/resume-import/analyze — pasted resume text (shares the same pipeline as an uploaded file)', () => {
  it('4. rejects empty pasted text', async () => {
    const res = await POST(requestWithText(''));
    expect(res.status).toBe(400);
    expect(mocks.generateResumeExtraction).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only pasted text the same as empty', async () => {
    const res = await POST(requestWithText('   \n  '));
    expect(res.status).toBe(400);
  });

  it('rejects too-short pasted text with a distinct message from "empty"', async () => {
    const res = await POST(requestWithText('too short'));
    const body = (await res.json()) as { error: string };
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/enough résumé text/i);
  });

  it('rejects pasted text over the max length', async () => {
    const res = await POST(requestWithText('a'.repeat(20_001)));
    expect(res.status).toBe(400);
    expect(mocks.generateResumeExtraction).not.toHaveBeenCalled();
  });

  it('rejects a request with neither a file nor text', async () => {
    const res = await POST(requestWithText(null));
    expect(res.status).toBe(400);
  });

  it('runs the exact same extraction pipeline as an upload — parses contact info and calls generateResumeExtraction with the pasted text, never creating a resume_uploads row', async () => {
    const text = ('Jane Doe\njane@example.com\nEXPERIENCE\nEngineer, Acme\n').repeat(3);
    mocks.generateResumeExtraction.mockResolvedValue({
      status: 'ok',
      result: { experience: [], education: [], projects: [], skills: [] },
      droppedCount: 0,
    });

    const res = await POST(requestWithText(text));
    const body = (await res.json()) as { personal: { email: string | null } };

    expect(res.status).toBe(200);
    expect(body.personal.email).toBe('jane@example.com');
    expect(mocks.generateResumeExtraction).toHaveBeenCalledWith(expect.anything(), USER_ID, text.trim());
    expect(mocks.createOwnResumeUpload).not.toHaveBeenCalled();
    expect(mocks.updateOwnResumeUploadExtractionStatus).not.toHaveBeenCalled();
  });

  it('surfaces AI rate-limiting for pasted text the same as for an upload', async () => {
    const text = 'Jane Doe\nEXPERIENCE\nEngineer, Acme\n'.repeat(5);
    mocks.generateResumeExtraction.mockResolvedValue({
      status: 'rate_limited',
      usage: { allowed: false, aiRequestsThisPeriod: 150, aiRequestLimit: 150, aiRequestPeriodStartedAt: '2026-01-01' },
    });

    const res = await POST(requestWithText(text));
    expect(res.status).toBe(429);
  });

  it('never writes to profile tables for pasted text either (same structural guarantee as upload)', async () => {
    const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
    for (const forbidden of [
      'createOwnExperience',
      'createOwnEducation',
      'createOwnProject',
      'createOwnSkill',
      'upsertOwnProfile',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
